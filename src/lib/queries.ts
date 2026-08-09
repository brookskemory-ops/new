import { db } from "./db";
import { addMonths, monthRange } from "./money";
import type {
  Account,
  Budget,
  BudgetProgress,
  Category,
  CategoryTotal,
  Goal,
  MonthSummary,
  TransactionView,
} from "./types";

/**
 * Every read the UI needs, in one place.
 *
 * Two rules hold across all of it:
 *  - Transfers (is_transfer = 1) and transfer-kind categories are excluded from
 *    income and spending. Moving $500 from checking to savings is not $500 of
 *    spending, and counting it as such makes every other number a lie.
 *  - Spending is reported as a POSITIVE number even though it is stored
 *    negative, because "you spent $412" is what a person wants to read.
 */

/** SQL fragment: rows that count as real activity for a month's totals. */
const REAL_ACTIVITY = `
  t.is_transfer = 0
  AND (c.kind IS NULL OR c.kind != 'transfer')
`;

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export function listAccounts(includeArchived = false): Account[] {
  return db
    .prepare(
      `SELECT * FROM accounts
        WHERE (? = 1 OR archived = 0)
        ORDER BY archived ASC, type ASC, name ASC`,
    )
    .all(includeArchived ? 1 : 0) as Account[];
}

/**
 * Net worth: assets minus liabilities. Credit cards and loans are stored with
 * the balance you OWE as a positive number, so they subtract here.
 */
export function netWorthCents(): { assets: number; liabilities: number; net: number } {
  const rows = listAccounts();
  let assets = 0;
  let liabilities = 0;
  for (const account of rows) {
    if (account.type === "credit" || account.type === "loan") {
      liabilities += Math.abs(account.balance_cents);
    } else {
      assets += account.balance_cents;
    }
  }
  return { assets, liabilities, net: assets - liabilities };
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export function listCategories(): Category[] {
  return db
    .prepare("SELECT * FROM categories ORDER BY sort_order ASC, name ASC")
    .all() as Category[];
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export interface TransactionFilter {
  month?: string;
  from?: string;
  to?: string;
  categoryId?: number;
  accountId?: number;
  /** Case-insensitive substring over merchant, description, and notes. */
  search?: string;
  uncategorizedOnly?: boolean;
  limit?: number;
  offset?: number;
}

const TX_SELECT = `
  SELECT t.*,
         c.name  AS category_name,
         c.color AS category_color,
         c.kind  AS category_kind,
         a.name  AS account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    JOIN accounts a ON a.id = t.account_id
`;

function buildWhere(filter: TransactionFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.month) {
    const { start, end } = monthRange(filter.month);
    clauses.push("t.date BETWEEN ? AND ?");
    params.push(start, end);
  }
  if (filter.from) {
    clauses.push("t.date >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("t.date <= ?");
    params.push(filter.to);
  }
  if (filter.categoryId != null) {
    clauses.push("t.category_id = ?");
    params.push(filter.categoryId);
  }
  if (filter.accountId != null) {
    clauses.push("t.account_id = ?");
    params.push(filter.accountId);
  }
  if (filter.search) {
    clauses.push(
      "(lower(t.merchant) LIKE ? OR lower(t.description) LIKE ? OR lower(COALESCE(t.notes,'')) LIKE ?)",
    );
    const needle = `%${filter.search.toLowerCase()}%`;
    params.push(needle, needle, needle);
  }
  if (filter.uncategorizedOnly) {
    clauses.push("(t.category_id IS NULL OR c.name = 'Uncategorized')");
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function listTransactions(filter: TransactionFilter = {}): TransactionView[] {
  const { sql, params } = buildWhere(filter);
  const limit = filter.limit ?? 200;
  const offset = filter.offset ?? 0;

  return db
    .prepare(
      `${TX_SELECT} ${sql}
        ORDER BY t.date DESC, t.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as TransactionView[];
}

export function countTransactions(filter: TransactionFilter = {}): number {
  const { sql, params } = buildWhere(filter);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         ${sql}`,
    )
    .get(...params) as { n: number };
  return row.n;
}

export function getTransaction(id: number): TransactionView | null {
  return (db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id) as TransactionView) ?? null;
}

/* ------------------------------------------------------------------ */
/* Month summaries                                                     */
/* ------------------------------------------------------------------ */

export function monthSummary(month: string): MonthSummary {
  const { start, end } = monthRange(month);

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END), 0) AS spending,
         COUNT(*) AS n
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date BETWEEN ? AND ? AND ${REAL_ACTIVITY}`,
    )
    .get(start, end) as { income: number; spending: number; n: number };

  const bucketRows = db
    .prepare(
      `SELECT COALESCE(c.bucket, 'want') AS bucket,
              COALESCE(SUM(-t.amount_cents), 0) AS total
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.date BETWEEN ? AND ?
          AND t.amount_cents < 0
          AND ${REAL_ACTIVITY}
        GROUP BY COALESCE(c.bucket, 'want')`,
    )
    .all(start, end) as Array<{ bucket: string; total: number }>;

  const buckets = { need: 0, want: 0, save: 0 };
  for (const row of bucketRows) {
    if (row.bucket === "need" || row.bucket === "want" || row.bucket === "save") {
      buckets[row.bucket] = row.total;
    }
  }

  return {
    month,
    income_cents: totals.income,
    spending_cents: totals.spending,
    net_cents: totals.income - totals.spending,
    buckets,
    transaction_count: totals.n,
  };
}

/** Spending by category for a month, biggest first. Positive numbers. */
export function categoryTotals(month: string): CategoryTotal[] {
  const { start, end } = monthRange(month);
  return db
    .prepare(
      `SELECT c.id                       AS category_id,
              COALESCE(c.name, 'Uncategorized')  AS name,
              COALESCE(c.color, '#94a3b8')       AS color,
              COALESCE(c.bucket, 'want')         AS bucket,
              SUM(-t.amount_cents)       AS total_cents,
              COUNT(*)                   AS count
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.date BETWEEN ? AND ?
          AND t.amount_cents < 0
          AND ${REAL_ACTIVITY}
        GROUP BY c.id
        ORDER BY total_cents DESC`,
    )
    .all(start, end) as CategoryTotal[];
}

/** The last n months of summaries, oldest first — the shape charts want. */
export function monthlyTrend(endMonth: string, count = 6): MonthSummary[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) months.push(addMonths(endMonth, -i));
  return months.map(monthSummary);
}

/** Top merchants by spend for a month. */
export function topMerchants(
  month: string,
  limit = 8,
): Array<{ merchant: string; total_cents: number; count: number }> {
  const { start, end } = monthRange(month);
  return db
    .prepare(
      `SELECT CASE WHEN TRIM(t.merchant) = '' THEN t.description ELSE t.merchant END AS merchant,
              SUM(-t.amount_cents) AS total_cents,
              COUNT(*)             AS count
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.date BETWEEN ? AND ?
          AND t.amount_cents < 0
          AND ${REAL_ACTIVITY}
        GROUP BY lower(merchant)
        ORDER BY total_cents DESC
        LIMIT ?`,
    )
    .all(start, end, limit) as Array<{
    merchant: string;
    total_cents: number;
    count: number;
  }>;
}

/**
 * Merchants charged a similar amount in at least 3 of the last 4 months —
 * a decent proxy for subscriptions and other recurring commitments you may
 * have forgotten you are paying for.
 */
export function recurringCharges(
  asOfMonth: string,
): Array<{ merchant: string; avg_cents: number; months: number; last_date: string }> {
  const start = `${addMonths(asOfMonth, -3)}-01`;
  const { end } = monthRange(asOfMonth);

  return db
    .prepare(
      `SELECT lower(CASE WHEN TRIM(t.merchant) = '' THEN t.description ELSE t.merchant END) AS key,
              MIN(CASE WHEN TRIM(t.merchant) = '' THEN t.description ELSE t.merchant END)   AS merchant,
              CAST(AVG(-t.amount_cents) AS INTEGER) AS avg_cents,
              COUNT(DISTINCT substr(t.date, 1, 7))  AS months,
              MAX(t.date)                           AS last_date
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.date BETWEEN ? AND ?
          AND t.amount_cents < 0
          AND ${REAL_ACTIVITY}
        GROUP BY key
       HAVING months >= 3
          AND (MAX(-t.amount_cents) - MIN(-t.amount_cents)) <= MAX(200, AVG(-t.amount_cents) * 0.15)
        ORDER BY avg_cents DESC`,
    )
    .all(start, end) as Array<{
    merchant: string;
    avg_cents: number;
    months: number;
    last_date: string;
  }>;
}

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

export function listBudgets(): Budget[] {
  return db.prepare("SELECT * FROM budgets ORDER BY category_id").all() as Budget[];
}

/**
 * Budgets for a month with spending applied.
 *
 * Resolution order per category: an explicit row for that month wins; otherwise
 * the recurring row (month IS NULL) applies. Categories with no budget at all
 * are omitted — use `categoryTotals` to see unbudgeted spending.
 */
export function budgetProgress(month: string): BudgetProgress[] {
  const { start, end } = monthRange(month);

  const rows = db
    .prepare(
      `WITH resolved AS (
         SELECT b.category_id,
                b.amount_cents,
                b.month,
                ROW_NUMBER() OVER (
                  PARTITION BY b.category_id
                  -- an explicit month beats the recurring default ('*')
                  ORDER BY CASE WHEN b.month = '*' THEN 1 ELSE 0 END
                ) AS rank
           FROM budgets b
          WHERE b.month = ? OR b.month = '*'
       )
       SELECT r.category_id,
              c.name   AS category_name,
              c.color  AS category_color,
              c.bucket AS bucket,
              r.amount_cents AS budget_cents,
              r.month = '*' AS is_default,
              COALESCE((
                SELECT SUM(-t.amount_cents)
                  FROM transactions t
                 WHERE t.category_id = r.category_id
                   AND t.date BETWEEN ? AND ?
                   AND t.amount_cents < 0
                   AND t.is_transfer = 0
              ), 0) AS spent_cents
         FROM resolved r
         JOIN categories c ON c.id = r.category_id
        WHERE r.rank = 1
        ORDER BY c.sort_order ASC, c.name ASC`,
    )
    .all(month, start, end) as Array<{
    category_id: number;
    category_name: string;
    category_color: string;
    bucket: BudgetProgress["bucket"];
    budget_cents: number;
    is_default: number;
    spent_cents: number;
  }>;

  return rows.map((row) => ({
    category_id: row.category_id,
    category_name: row.category_name,
    category_color: row.category_color,
    bucket: row.bucket,
    budget_cents: row.budget_cents,
    spent_cents: row.spent_cents,
    remaining_cents: row.budget_cents - row.spent_cents,
    ratio: row.budget_cents > 0 ? row.spent_cents / row.budget_cents : 0,
    is_default: Boolean(row.is_default),
  }));
}

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

export function listGoals(): Goal[] {
  return db.prepare("SELECT * FROM goals ORDER BY created_at ASC").all() as Goal[];
}

/* ------------------------------------------------------------------ */
/* Plaid items                                                         */
/* ------------------------------------------------------------------ */

export function listPlaidItems(): Array<{
  id: number;
  institution_name: string | null;
  status: string;
  last_synced_at: string | null;
  account_count: number;
}> {
  return db
    .prepare(
      `SELECT p.id, p.institution_name, p.status, p.last_synced_at,
              (SELECT COUNT(*) FROM accounts a WHERE a.plaid_item_id = p.id) AS account_count
         FROM plaid_items p
        ORDER BY p.created_at ASC`,
    )
    .all() as Array<{
    id: number;
    institution_name: string | null;
    status: string;
    last_synced_at: string | null;
    account_count: number;
  }>;
}
