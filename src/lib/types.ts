export type AccountType =
  | "checking" | "savings" | "credit" | "cash" | "investment" | "loan" | "other";

export type CategoryKind = "expense" | "income" | "transfer";
export type Bucket = "need" | "want" | "save" | "none";
export type TxSource = "manual" | "plaid" | "csv";

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  institution: string | null;
  mask: string | null;
  balance_cents: number;
  currency: string;
  is_manual: number;
  archived: number;
  plaid_item_id: number | null;
  plaid_account_id: string | null;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  color: string;
  bucket: Bucket;
  is_system: number;
  sort_order: number;
}

export interface Transaction {
  id: number;
  account_id: number;
  category_id: number | null;
  date: string;
  /** Minor units. Negative = money out. */
  amount_cents: number;
  merchant: string;
  description: string;
  notes: string | null;
  pending: number;
  is_transfer: number;
  source: TxSource;
  plaid_transaction_id: string | null;
  category_locked: number;
  created_at: string;
  updated_at: string;
}

/** A transaction joined with the display fields the UI needs. */
export interface TransactionView extends Transaction {
  category_name: string | null;
  category_color: string | null;
  category_kind: CategoryKind | null;
  account_name: string;
}

export interface Budget {
  id: number;
  category_id: number;
  amount_cents: number;
  /** 'YYYY-MM' for a one-month override, or '*' for the recurring default. */
  month: string;
}

/** A budget resolved for a specific month, with spending applied. */
export interface BudgetProgress {
  category_id: number;
  category_name: string;
  category_color: string;
  bucket: Bucket;
  budget_cents: number;
  spent_cents: number;
  remaining_cents: number;
  /** 0–1+, where >1 means over budget. */
  ratio: number;
  /** True when the row came from the recurring default rather than a monthly override. */
  is_default: boolean;
}

export interface Goal {
  id: number;
  name: string;
  target_cents: number;
  saved_cents: number;
  target_date: string | null;
  account_id: number | null;
  created_at: string;
}

export interface MonthSummary {
  month: string;
  income_cents: number;
  /** Positive number representing total money spent. */
  spending_cents: number;
  net_cents: number;
  /** Spending split by need / want / save. Positive numbers. */
  buckets: Record<"need" | "want" | "save", number>;
  transaction_count: number;
}

export interface CategoryTotal {
  category_id: number | null;
  name: string;
  color: string;
  bucket: Bucket;
  /** Positive number representing money spent in this category. */
  total_cents: number;
  count: number;
}
