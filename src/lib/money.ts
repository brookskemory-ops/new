/**
 * Money is always an integer number of cents inside this app. These helpers are
 * the only places a string or a float is allowed to touch an amount.
 */

/**
 * Parse user input ("42", "$1,299.99", "-15.50", "(20)") into cents.
 * Returns null when the input is not a usable number.
 */
export function parseAmountToCents(input: string | number): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }

  let text = input.trim();
  if (!text) return null;

  // Accounting-style negatives: (12.34) means -12.34
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text.replace(/[$\s,]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;

  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$1,234.56" — the default for anything you might reconcile against a statement. */
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** "$1,235" — for chart axes and headline figures where cents are noise. */
export function formatCentsShort(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 1_000_00) return usdWhole.format(cents / 100);
  return usd.format(cents / 100);
}

/** "+$40.00" / "-$40.00" — used where the direction of the flow is the point. */
export function formatSigned(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "-" : "";
  return `${sign}${usd.format(Math.abs(cents) / 100)}`;
}

/* ------------------------------------------------------------------ */
/* Dates — all stored as 'YYYY-MM-DD' local calendar dates             */
/* ------------------------------------------------------------------ */

/** Today as 'YYYY-MM-DD' in the machine's local timezone. */
export function today(): string {
  return toDateString(new Date());
}

export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Current month as 'YYYY-MM'. */
export function currentMonth(): string {
  return today().slice(0, 7);
}

/** First and last calendar day of a 'YYYY-MM' month, inclusive. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

/** Shift a 'YYYY-MM' month by n months (negative goes back). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + n, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** "August 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** "Aug 9" — compact date for dense transaction lists. */
export function formatDateShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * How far through the month we are, 0–1. Used to compare spend-to-date against
 * budget: 60% of the budget spent on day 5 is a very different signal than the
 * same 60% on day 25.
 */
export function monthProgress(month: string, asOf = new Date()): number {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrent = toDateString(asOf).slice(0, 7) === month;
  if (!isCurrent) return toDateString(asOf).slice(0, 7) > month ? 1 : 0;
  return asOf.getDate() / daysInMonth;
}
