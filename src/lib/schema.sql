-- Ledger schema.
--
-- MONEY: every amount is an INTEGER of minor units (cents). Never floats.
-- SIGN:  negative = money leaving you (an expense), positive = money arriving
--        (income, refund). This matches "effect on your balance", so summing a
--        column always gives net cash flow. Plaid uses the opposite convention
--        and is flipped at ingest time in src/lib/plaid.ts.

CREATE TABLE IF NOT EXISTS accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  type              TEXT    NOT NULL DEFAULT 'checking'
                            CHECK (type IN ('checking','savings','credit','cash','investment','loan','other')),
  institution       TEXT,
  mask              TEXT,                       -- last 4 digits, display only
  balance_cents     INTEGER NOT NULL DEFAULT 0,
  currency          TEXT    NOT NULL DEFAULT 'USD',
  is_manual         INTEGER NOT NULL DEFAULT 1, -- 1 = you maintain it by hand
  archived          INTEGER NOT NULL DEFAULT 0,
  plaid_item_id     INTEGER REFERENCES plaid_items(id) ON DELETE SET NULL,
  plaid_account_id  TEXT UNIQUE,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per financial institution you have linked through Plaid.
-- access_token is a long-lived secret: it lives only in this local DB file,
-- which .gitignore excludes from git.
CREATE TABLE IF NOT EXISTS plaid_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id           TEXT    NOT NULL UNIQUE,
  access_token      TEXT    NOT NULL,
  institution_name  TEXT,
  institution_id    TEXT,
  cursor            TEXT,                       -- Plaid /transactions/sync cursor
  status            TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','needs_reauth','revoked')),
  last_synced_at    TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per SimpleFIN Bridge connection. The access_url IS the credential —
-- it embeds a username and password — so it is treated as a secret: stored only
-- in this local file, never logged, never returned by the API.
CREATE TABLE IF NOT EXISTS simplefin_connections (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  access_url     TEXT    NOT NULL UNIQUE,
  name           TEXT,
  status         TEXT    NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','needs_reauth')),
  last_synced_at TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  kind        TEXT    NOT NULL DEFAULT 'expense'
                      CHECK (kind IN ('expense','income','transfer')),
  color       TEXT    NOT NULL DEFAULT '#64748b',
  -- 'need' / 'want' / 'save' powers the 50-30-20 view. Income and transfers
  -- are 'none' since they are not spending.
  bucket      TEXT    NOT NULL DEFAULT 'want'
                      CHECK (bucket IN ('need','want','save','none')),
  is_system   INTEGER NOT NULL DEFAULT 0,       -- system rows cannot be deleted
  sort_order  INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS transactions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id            INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id           INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  date                  TEXT    NOT NULL,       -- 'YYYY-MM-DD', local calendar date
  amount_cents          INTEGER NOT NULL,       -- see SIGN note at top
  merchant              TEXT    NOT NULL DEFAULT '',
  description           TEXT    NOT NULL DEFAULT '',
  notes                 TEXT,
  pending               INTEGER NOT NULL DEFAULT 0,
  -- Transfers between your own accounts are real rows but must be excluded
  -- from spending totals, or moving money looks like spending it.
  is_transfer           INTEGER NOT NULL DEFAULT 0,
  source                TEXT    NOT NULL DEFAULT 'manual'
                                CHECK (source IN ('manual','plaid','csv','simplefin')),
  plaid_transaction_id  TEXT UNIQUE,
  -- Set when a human picks the category, so auto-categorization never
  -- overwrites a decision you made yourself.
  category_locked       INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_account  ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);

-- Budgets are per category per calendar month. The literal '*' means the
-- recurring default that applies to every month with no explicit override.
--
-- '*' rather than NULL because SQLite treats NULLs as distinct in a UNIQUE
-- constraint, so a nullable month would let duplicate recurring rows through
-- and ON CONFLICT would never fire.
CREATE TABLE IF NOT EXISTS budgets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  month        TEXT    NOT NULL DEFAULT '*'
                       CHECK (month = '*' OR month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (category_id, month)
);

-- Auto-categorization rules, highest priority first. `pattern` is matched
-- case-insensitively as a substring of the merchant + description.
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT    NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority    INTEGER NOT NULL DEFAULT 100,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority DESC);

-- Savings goals (emergency fund, etc.). Progress is entered manually or
-- pointed at an account balance.
CREATE TABLE IF NOT EXISTS goals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  target_cents   INTEGER NOT NULL CHECK (target_cents > 0),
  saved_cents    INTEGER NOT NULL DEFAULT 0,
  target_date    TEXT,
  account_id     INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Free-form app settings: monthly take-home pay, pay cadence, etc.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Cache of AI analyses so re-opening the Insights page does not re-bill you.
CREATE TABLE IF NOT EXISTS insights (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  month       TEXT    NOT NULL,
  body        TEXT    NOT NULL,                 -- JSON payload from the model
  input_hash  TEXT    NOT NULL,                 -- fingerprint of the data analyzed
  model       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insights_month ON insights(month, created_at DESC);
