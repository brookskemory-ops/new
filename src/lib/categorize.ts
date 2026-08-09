import { db } from "./db";

/**
 * Rule-based auto-categorization.
 *
 * This runs on every imported and manually-entered transaction. It is
 * deliberately dumb and deterministic — substring matching against a rules
 * table — because a categorizer you can predict and correct beats a clever one
 * you cannot. When you recategorize a transaction in the UI you are offered the
 * option to save it as a rule, so the system learns from your corrections
 * instead of guessing.
 *
 * The AI features never touch categorization. They read the finished numbers.
 */

interface Rule {
  id: number;
  pattern: string;
  category_id: number;
  priority: number;
}

export interface CategorizeInput {
  merchant?: string | null;
  description?: string | null;
  amount_cents: number;
  /** Plaid's primary category guess, used only as a fallback. */
  plaidCategory?: string | null;
  /** Plaid's detailed category — the only place card payments are separable. */
  plaidDetailedCategory?: string | null;
}

let rulesCache: { rules: Rule[]; loadedAt: number } | null = null;
const RULES_TTL_MS = 5_000;

function loadRules(): Rule[] {
  const now = Date.now();
  if (rulesCache && now - rulesCache.loadedAt < RULES_TTL_MS) return rulesCache.rules;

  const rules = db
    .prepare(
      `SELECT id, pattern, category_id, priority
         FROM rules
        -- User rules (is_system = 0) win ties against the shipped defaults.
        ORDER BY priority DESC, is_system ASC, length(pattern) DESC`,
    )
    .all() as Rule[];

  rulesCache = { rules, loadedAt: now };
  return rules;
}

/** Call after any write to the rules table so the next lookup sees it. */
export function invalidateRulesCache(): void {
  rulesCache = null;
}

function categoryIdByName(name: string): number | null {
  const row = db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

/**
 * Map Plaid's personal_finance_category primary enum onto our category names.
 * Only used when no local rule matched.
 */
const PLAID_CATEGORY_MAP: Record<string, string> = {
  INCOME: "Income",
  TRANSFER_IN: "Transfer",
  TRANSFER_OUT: "Transfer",
  LOAN_PAYMENTS: "Debt Payments",
  BANK_FEES: "Fees & Charges",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Dining & Takeout",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Shopping",
  MEDICAL: "Health & Medical",
  PERSONAL_CARE: "Personal Care",
  GENERAL_SERVICES: "Shopping",
  GOVERNMENT_AND_NON_PROFIT: "Gifts & Donations",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  RENT_AND_UTILITIES: "Utilities",
};

/**
 * Pick a category id for a transaction. Never returns null — anything that
 * matches nothing lands in Uncategorized so it shows up in the review queue
 * rather than silently vanishing from budget math.
 */
export function categorize(input: CategorizeInput): number {
  const haystack = `${input.merchant ?? ""} ${input.description ?? ""}`
    .toLowerCase()
    .trim();

  if (haystack) {
    for (const rule of loadRules()) {
      if (haystack.includes(rule.pattern.toLowerCase())) return rule.category_id;
    }
  }

  if (input.plaidCategory) {
    const mapped = PLAID_CATEGORY_MAP[input.plaidCategory];
    if (mapped) {
      const id = categoryIdByName(mapped);
      if (id) return id;
    }
  }

  // Money coming in with no other signal is far more likely to be income than
  // an expense, and misfiling it as an expense corrupts every spending total.
  if (input.amount_cents > 0) {
    const income = categoryIdByName("Income");
    if (income) return income;
  }

  return categoryIdByName("Uncategorized")!;
}

/**
 * True when this transaction moves money between accounts you own, rather than
 * spending it. These are excluded from every spending total.
 *
 * Credit card payments are the case that matters most and the one people get
 * wrong. When you buy groceries on a card, that purchase is already recorded as
 * grocery spending. Paying the card off later moves money from checking to the
 * card — counting it again would double every dollar you put on plastic.
 *
 * Loan payments are deliberately NOT transfers. A student loan or car payment
 * is money you must find every month and budget for, so it belongs in spending
 * even though it also reduces a liability.
 */
export function looksLikeTransfer(input: CategorizeInput): boolean {
  const haystack = `${input.merchant ?? ""} ${input.description ?? ""}`.toLowerCase();

  if (input.plaidCategory === "TRANSFER_IN" || input.plaidCategory === "TRANSFER_OUT") {
    return true;
  }
  // Plaid files card payments under LOAN_PAYMENTS; only the detailed enum
  // separates them from real loan payments.
  if (input.plaidDetailedCategory === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") {
    return true;
  }

  // "PAYMENT THANK YOU" and "CARDMEMBER PAYMENT" are how the major issuers
  // label a card payoff on the statement.
  if (/payment\s*-?\s*thank\s?you|cardmember payment|autopay payment/.test(haystack)) {
    return true;
  }
  // "Rewards Card Payment", "credit card pmt" — but not "student loan payment".
  if (/\bcredit card (payment|pmt)\b/.test(haystack)) return true;
  if (/\bcard (payment|pmt)\b/.test(haystack) && !/\bloan\b/.test(haystack)) {
    return true;
  }

  return /\b(transfer|zelle|venmo|cash app|wire|ach credit|ach debit)\b/.test(haystack);
}

/**
 * Re-run categorization over every transaction that a human has not explicitly
 * categorized. Used after adding rules. Returns the number of rows changed.
 */
export function recategorizeUnlocked(): number {
  invalidateRulesCache();

  const rows = db
    .prepare(
      `SELECT id, merchant, description, amount_cents, category_id
         FROM transactions
        WHERE category_locked = 0`,
    )
    .all() as Array<{
    id: number;
    merchant: string;
    description: string;
    amount_cents: number;
    category_id: number | null;
  }>;

  const update = db.prepare(
    "UPDATE transactions SET category_id = ?, updated_at = datetime('now') WHERE id = ?",
  );

  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const next = categorize({
        merchant: row.merchant,
        description: row.description,
        amount_cents: row.amount_cents,
      });
      if (next !== row.category_id) {
        update.run(next, row.id);
        changed++;
      }
    }
  })();

  return changed;
}
