import { db } from "./db";
import { addMonths, currentMonth, toDateString } from "./money";

/**
 * Forward-looking analysis: what is already committed, what is likely to land,
 * and what is genuinely free to spend.
 *
 * Everything else in this app reports the past. This module is the only part
 * that makes claims about the future, so it is deliberately conservative: it
 * only predicts charges it has actually seen repeat, it never invents a
 * category of spending, and every number it produces can be traced back to
 * specific transactions.
 */

/* ------------------------------------------------------------------ */
/* Recurrence detection                                                */
/* ------------------------------------------------------------------ */

export type Cadence = "monthly" | "biweekly" | "weekly";

export interface RecurringSeries {
  key: string;
  merchant: string;
  /** Positive for a bill, positive for income too — direction says which. */
  amount_cents: number;
  direction: "in" | "out";
  cadence: Cadence;
  /** Typical day of month (monthly) or interval anchor date (weekly/biweekly). */
  day_of_month: number;
  last_seen: string;
  next_due: string;
  occurrences: number;
  /**
   * Set when the most recent charge is meaningfully higher than what this
   * merchant used to charge — the quiet subscription price rise.
   */
  price_increase?: {
    from_cents: number;
    to_cents: number;
    since: string;
  };
}

interface Row {
  key: string;
  merchant: string;
  date: string;
  amount_cents: number;
}

/** Strip the noise that makes the same merchant look like many merchants. */
function normalizeKey(merchant: string, description: string): string {
  const source = (merchant || description).toLowerCase();
  return source
    .replace(/[^a-z ]/g, " ")
    .replace(/\b(inc|llc|co|com|the|payment|autopay|recurring|bill)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) /
      86_400_000,
  );
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return toDateString(next);
}

/** Clamp a day to a month that may not have it — the 31st in February. */
function dateOnDayOf(year: number, monthIndex: number, day: number): string {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return toDateString(new Date(year, monthIndex, Math.min(day, lastDay)));
}

/**
 * Find repeating charges and deposits over the last several months.
 *
 * A series has to repeat at a consistent interval *and* a consistent amount.
 * Requiring both is what keeps groceries — frequent but irregular in both — out
 * of a list that is supposed to mean "this will happen whether you act or not".
 */
export function detectRecurring(monthsBack = 6, asOf = toDateString(new Date())): RecurringSeries[] {
  const since = `${addMonths(currentMonth(), -monthsBack)}-01`;

  const rows = db
    .prepare(
      `SELECT t.merchant, t.description, t.date, t.amount_cents
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.date >= ? AND t.date <= ?
          AND t.is_transfer = 0
          AND (c.kind IS NULL OR c.kind != 'transfer')
        ORDER BY t.date ASC`,
    )
    .all(since, asOf) as Array<{
    merchant: string;
    description: string;
    date: string;
    amount_cents: number;
  }>;

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = normalizeKey(row.merchant, row.description);
    if (key.length < 3) continue;
    const list = groups.get(key) ?? [];
    list.push({
      key,
      merchant: row.merchant || row.description,
      date: row.date,
      amount_cents: row.amount_cents,
    });
    groups.set(key, list);
  }

  const series: RecurringSeries[] = [];

  for (const [key, entries] of groups) {
    // Income and expenses from the same merchant are separate series — a
    // refund from a shop is not part of that shop's spending rhythm.
    for (const direction of ["out", "in"] as const) {
      const matching = entries.filter((entry) =>
        direction === "out" ? entry.amount_cents < 0 : entry.amount_cents > 0,
      );
      if (matching.length < 3) continue;

      const amounts = matching.map((entry) => Math.abs(entry.amount_cents));
      const typical = median(amounts);
      if (typical === 0) continue;

      // Amounts must cluster, and *most* of them must — not merely three of
      // them. With enough visits, any frequent merchant will have three
      // purchases near its own median by chance, which is how variable
      // spending like groceries sneaks into a list of fixed commitments.
      const within = amounts.filter(
        (amount) => Math.abs(amount - typical) <= Math.max(typical * 0.25, 300),
      );
      if (within.length < 3 || within.length < amounts.length * 0.7) continue;

      // The decisive test, and it needs two ways to pass because commitments
      // come in two shapes.
      //
      //   Repetition — a subscription bills the *identical* amount over and
      //   over. This is what survives a step change: a pay rise splits the
      //   history into two exact values, which is still nothing like a shop.
      //
      //   Tightness — a utility bill is never twice the same but stays in a
      //   narrow band. Percentiles rather than min/max so one unusual month
      //   doesn't disqualify an otherwise steady bill.
      //
      // A supermarket fails both: every visit is a different amount, spread
      // across a wide range. That is the difference between "this will happen
      // whether I act or not" and "this is where I choose to spend".
      const counts = new Map<number, number>();
      for (const amount of amounts) counts.set(amount, (counts.get(amount) ?? 0) + 1);
      const modeShare = Math.max(...counts.values()) / amounts.length;

      const sorted = [...amounts].sort((a, b) => a - b);
      const at = (q: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      const spread = (at(0.9) - at(0.1)) / typical;

      if (modeShare < 0.4 && spread > 0.4) continue;

      const dates = matching.map((entry) => entry.date);
      const gaps: number[] = [];
      for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
      if (gaps.length === 0) continue;

      const typicalGap = median(gaps);
      let cadence: Cadence;
      if (typicalGap >= 24 && typicalGap <= 38) cadence = "monthly";
      else if (typicalGap >= 12 && typicalGap <= 17) cadence = "biweekly";
      else if (typicalGap >= 5 && typicalGap <= 9) cadence = "weekly";
      else continue;

      // The gaps themselves have to be consistent, or "every 30 days on
      // average" is just noise averaging out. This is the check that separates
      // a bill from a shop you happen to visit about twice a month: a
      // subscription's gaps are 30, 31, 30, 31, while a supermarket's are
      // 2, 33, 8, 37, 9 — the same *average*, nothing like the same rhythm.
      const steady = gaps.filter(
        (gap) => Math.abs(gap - typicalGap) <= Math.max(typicalGap * 0.25, 4),
      );
      if (steady.length < gaps.length * 0.7) continue;

      const lastSeen = dates[dates.length - 1];
      const dayOfMonth = Number(lastSeen.slice(8));

      // Next occurrence, rolled forward until it is actually in the future.
      let nextDue: string;
      if (cadence === "monthly") {
        const [year, month] = lastSeen.split("-").map(Number);
        nextDue = dateOnDayOf(year, month, dayOfMonth);
        while (nextDue <= asOf) {
          const [y, m] = nextDue.split("-").map(Number);
          nextDue = dateOnDayOf(y, m, dayOfMonth);
        }
      } else {
        const step = cadence === "biweekly" ? 14 : 7;
        nextDue = addDays(lastSeen, step);
        while (nextDue <= asOf) nextDue = addDays(nextDue, step);
      }

      // Price rise: compare the latest charge against what came before it.
      // Only meaningful for outgoings — income going up is a raise, not a
      // problem to flag.
      let priceIncrease: RecurringSeries["price_increase"];
      if (direction === "out" && matching.length >= 4) {
        const latest = Math.abs(matching[matching.length - 1].amount_cents);
        const earlier = median(
          matching.slice(0, -1).map((entry) => Math.abs(entry.amount_cents)),
        );
        if (earlier > 0 && latest > earlier * 1.05 && latest - earlier >= 100) {
          priceIncrease = {
            from_cents: earlier,
            to_cents: latest,
            since: matching[matching.length - 1].date,
          };
        }
      }

      series.push({
        key,
        merchant: matching[matching.length - 1].merchant,
        // Use the latest amount, not the median — a raise or a price rise
        // should be reflected in what you expect next.
        amount_cents: Math.abs(matching[matching.length - 1].amount_cents),
        direction,
        cadence,
        day_of_month: dayOfMonth,
        last_seen: lastSeen,
        next_due: nextDue,
        occurrences: matching.length,
        price_increase: priceIncrease,
      });
    }
  }

  return series.sort((a, b) => a.next_due.localeCompare(b.next_due));
}

/* ------------------------------------------------------------------ */
/* Balance projection                                                  */
/* ------------------------------------------------------------------ */

/**
 * Money available to spend right now.
 *
 * Savings is deliberately excluded. It is money you decided not to spend, and
 * counting it here would quietly tell you a bill is covered when covering it
 * actually means raiding the emergency fund.
 */
export function spendableBalanceCents(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(balance_cents), 0) AS total
         FROM accounts
        WHERE archived = 0 AND type IN ('checking','cash')`,
    )
    .get() as { total: number };
  return row.total;
}

/** Reported alongside, so the distinction is visible rather than hidden. */
export function savingsBalanceCents(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(balance_cents), 0) AS total
         FROM accounts
        WHERE archived = 0 AND type = 'savings'`,
    )
    .get() as { total: number };
  return row.total;
}

export interface ForecastDay {
  date: string;
  /** Committed events only — bills and income that repeat. */
  balance_cents: number;
  /** The same, with your typical day-to-day spending also applied. */
  balance_with_typical_cents: number;
  events: Array<{ merchant: string; amount_cents: number; direction: "in" | "out" }>;
}

export interface Forecast {
  starting_balance_cents: number;
  days: ForecastDay[];
  /** The worst point between now and the horizon — the number that matters. */
  low_point: { date: string; balance_cents: number };
  next_income: { date: string; amount_cents: number; merchant: string } | null;
  /** Committed outgoings between now and the next income event. */
  committed_before_income_cents: number;
  /**
   * Liquid balance minus everything already committed before money next
   * arrives. Spending beyond this means a bill bounces or a card gets used.
   */
  safe_to_spend_cents: number;
  /** Median day-to-day spending, excluding anything detected as recurring. */
  typical_daily_variable_cents: number;
  horizon_days: number;
}

/**
 * Average daily spending that is NOT a recurring commitment — groceries,
 * coffee, everything discretionary.
 *
 * Measured from the last 90 days rather than assumed. Without this the
 * projection only ever slopes upward, because income and bills are counted but
 * the spending that actually consumes a paycheck is not.
 */
function typicalDailyVariableCents(
  recurringKeys: Set<string>,
  asOf: string,
): number {
  const since = addDaysTo(asOf, -90);
  const rows = db
    .prepare(
      `SELECT t.merchant, t.description, t.amount_cents
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.date >= ? AND t.date <= ?
          AND t.amount_cents < 0
          AND t.is_transfer = 0
          AND (c.kind IS NULL OR c.kind != 'transfer')`,
    )
    .all(since, asOf) as Array<{
    merchant: string;
    description: string;
    amount_cents: number;
  }>;

  let total = 0;
  for (const row of rows) {
    if (recurringKeys.has(normalizeKey(row.merchant, row.description))) continue;
    total += -row.amount_cents;
  }
  return Math.round(total / 90);
}

/** Local alias so the helper above can sit before addDays is used elsewhere. */
function addDaysTo(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return toDateString(next);
}

/**
 * Project the liquid balance forward day by day.
 *
 * Only detected recurring events are applied. Everyday variable spending is
 * deliberately NOT extrapolated: guessing it would turn a factual "here is what
 * is already committed" into a speculative number, and a forecast you don't
 * trust is worse than none.
 */
export function buildForecast(horizonDays = 45, asOf = toDateString(new Date())): Forecast {
  const starting = spendableBalanceCents();
  const series = detectRecurring(6, asOf);

  const recurringKeys = new Set(series.map((item) => item.key));
  const dailyVariable = typicalDailyVariableCents(recurringKeys, asOf);

  const days: ForecastDay[] = [];
  let balance = starting;
  let balanceWithTypical = starting;
  let lowPoint = { date: asOf, balance_cents: starting };
  let nextIncome: Forecast["next_income"] = null;
  let committedBeforeIncome = 0;

  for (let offset = 1; offset <= horizonDays; offset++) {
    const date = addDays(asOf, offset);
    const events: ForecastDay["events"] = [];

    balanceWithTypical -= dailyVariable;

    for (const item of series) {
      // Walk each series forward across the horizon.
      const step =
        item.cadence === "monthly" ? null : item.cadence === "biweekly" ? 14 : 7;

      let occurs = false;
      if (step === null) {
        const [year, month] = date.split("-").map(Number);
        occurs = date === dateOnDayOf(year, month - 1, item.day_of_month) &&
          date >= item.next_due;
      } else {
        const delta = daysBetween(item.next_due, date);
        occurs = delta >= 0 && delta % step === 0;
      }

      if (!occurs) continue;

      const signed = item.direction === "out" ? -item.amount_cents : item.amount_cents;
      balance += signed;
      balanceWithTypical += signed;
      events.push({
        merchant: item.merchant,
        amount_cents: item.amount_cents,
        direction: item.direction,
      });

      if (item.direction === "in" && nextIncome === null) {
        nextIncome = {
          date,
          amount_cents: item.amount_cents,
          merchant: item.merchant,
        };
      }
      if (item.direction === "out" && nextIncome === null) {
        committedBeforeIncome += item.amount_cents;
      }
    }

    if (balance < lowPoint.balance_cents) {
      lowPoint = { date, balance_cents: balance };
    }
    days.push({
      date,
      balance_cents: balance,
      balance_with_typical_cents: balanceWithTypical,
      events,
    });
  }

  return {
    starting_balance_cents: starting,
    days,
    low_point: lowPoint,
    next_income: nextIncome,
    committed_before_income_cents: committedBeforeIncome,
    safe_to_spend_cents: starting - committedBeforeIncome,
    typical_daily_variable_cents: dailyVariable,
    horizon_days: horizonDays,
  };
}

/* ------------------------------------------------------------------ */
/* Income change / lifestyle creep                                     */
/* ------------------------------------------------------------------ */

export interface IncomeChange {
  detected: boolean;
  before: { months: number; avg_income_cents: number; avg_spending_cents: number };
  after: { months: number; avg_income_cents: number; avg_spending_cents: number };
  income_change_cents: number;
  spending_change_cents: number;
  /** Share of the raise that is being spent rather than kept, 0–1+. */
  absorbed_ratio: number;
  change_month: string | null;
}

/**
 * Detect a step change in income and measure how much of it is being absorbed
 * by higher spending.
 *
 * A raise that fully turns into spending leaves you exactly where you were,
 * which is easy to miss month to month and obvious across a boundary. This
 * looks for the largest jump in monthly income and compares the periods
 * either side.
 */
export function detectIncomeChange(monthsBack = 8): IncomeChange {
  const months: string[] = [];
  for (let i = monthsBack - 1; i >= 1; i--) months.push(addMonths(currentMonth(), -i));

  const stats = months.map((month) => {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END), 0) AS spending
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE substr(t.date, 1, 7) = ?
          AND t.is_transfer = 0
          AND (c.kind IS NULL OR c.kind != 'transfer')`,
      )
      .get(month) as { income: number; spending: number };
    return { month, ...row };
  });

  const withIncome = stats.filter((entry) => entry.income > 0);
  const empty: IncomeChange = {
    detected: false,
    before: { months: 0, avg_income_cents: 0, avg_spending_cents: 0 },
    after: { months: 0, avg_income_cents: 0, avg_spending_cents: 0 },
    income_change_cents: 0,
    spending_change_cents: 0,
    absorbed_ratio: 0,
    change_month: null,
  };

  if (withIncome.length < 4) return empty;

  // Find the split point with the biggest difference in mean income, keeping
  // at least two months on each side so one odd month cannot define a "raise".
  let best = { index: -1, delta: 0 };
  for (let i = 2; i <= withIncome.length - 2; i++) {
    const before = withIncome.slice(0, i);
    const after = withIncome.slice(i);
    const beforeAvg =
      before.reduce((sum, entry) => sum + entry.income, 0) / before.length;
    const afterAvg = after.reduce((sum, entry) => sum + entry.income, 0) / after.length;
    const delta = afterAvg - beforeAvg;
    if (delta > best.delta) best = { index: i, delta };
  }

  // Below 10% it is ordinary variation — overtime, a bonus, a five-week month.
  if (best.index === -1) return empty;

  const before = withIncome.slice(0, best.index);
  const after = withIncome.slice(best.index);
  const mean = (list: typeof withIncome, field: "income" | "spending") =>
    Math.round(list.reduce((sum, entry) => sum + entry[field], 0) / list.length);

  const beforeIncome = mean(before, "income");
  const afterIncome = mean(after, "income");
  if (beforeIncome === 0 || afterIncome < beforeIncome * 1.1) return empty;

  const beforeSpending = mean(before, "spending");
  const afterSpending = mean(after, "spending");
  const incomeChange = afterIncome - beforeIncome;
  const spendingChange = afterSpending - beforeSpending;

  return {
    detected: true,
    before: {
      months: before.length,
      avg_income_cents: beforeIncome,
      avg_spending_cents: beforeSpending,
    },
    after: {
      months: after.length,
      avg_income_cents: afterIncome,
      avg_spending_cents: afterSpending,
    },
    income_change_cents: incomeChange,
    spending_change_cents: spendingChange,
    absorbed_ratio: incomeChange > 0 ? spendingChange / incomeChange : 0,
    change_month: after[0].month,
  };
}
