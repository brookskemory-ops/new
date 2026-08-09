import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Single SQLite connection for the whole app.
 *
 * Next dev mode reloads modules on every edit, which would otherwise open a new
 * file handle each time, so the connection is stashed on globalThis.
 */

const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ledger.db");

declare global {
  // eslint-disable-next-line no-var
  var __ledgerDb: Database.Database | undefined;
}

function connect(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const database = new Database(DB_PATH);
  // WAL keeps reads from blocking on writes; both matter once bank sync runs
  // while you have the dashboard open.
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  // Next spawns several workers at build time and they all open this file at
  // once. Without a busy timeout the losers fail immediately with SQLITE_BUSY
  // instead of waiting the few milliseconds the writer actually needs.
  database.pragma("busy_timeout = 10000");

  migrate(database);
  return database;
}

function migrate(database: Database.Database) {
  const schemaPath = path.join(process.cwd(), "src", "lib", "schema.sql");
  database.exec(fs.readFileSync(schemaPath, "utf8"));
  seedSystemRows(database);
}

/* ------------------------------------------------------------------ */
/* System categories + starter rules                                   */
/* ------------------------------------------------------------------ */
/* These are declared before `db` is initialized below: connect() runs at
 * module-evaluation time and reaches seedSystemRows, so the const arrays it
 * reads have to already be initialized or they are still in the temporal dead
 * zone. Function declarations hoist; const arrays do not.                    */

/** [name, kind, color, bucket, sortOrder] */
const SYSTEM_CATEGORIES: Array<
  [string, "expense" | "income" | "transfer", string, "need" | "want" | "save" | "none", number]
> = [
  ["Income",            "income",   "#059669", "none",  1],
  ["Rent & Mortgage",   "expense",  "#7c3aed", "need",  10],
  ["Utilities",         "expense",  "#8b5cf6", "need",  11],
  ["Groceries",         "expense",  "#16a34a", "need",  12],
  ["Transportation",    "expense",  "#0891b2", "need",  13],
  ["Insurance",         "expense",  "#4f46e5", "need",  14],
  ["Health & Medical",  "expense",  "#db2777", "need",  15],
  ["Debt Payments",     "expense",  "#b91c1c", "need",  16],
  ["Phone & Internet",  "expense",  "#6366f1", "need",  17],
  ["Dining & Takeout",  "expense",  "#ea580c", "want",  30],
  ["Shopping",          "expense",  "#d946ef", "want",  31],
  ["Entertainment",     "expense",  "#f59e0b", "want",  32],
  ["Subscriptions",     "expense",  "#0ea5e9", "want",  33],
  ["Travel",            "expense",  "#14b8a6", "want",  34],
  ["Personal Care",     "expense",  "#f472b6", "want",  35],
  ["Gifts & Donations", "expense",  "#facc15", "want",  36],
  ["Education",         "expense",  "#3b82f6", "want",  37],
  ["Savings",           "expense",  "#10b981", "save",  50],
  ["Investments",       "expense",  "#22c55e", "save",  51],
  ["Transfer",          "transfer", "#94a3b8", "none",  90],
  ["Fees & Charges",    "expense",  "#ef4444", "need",  91],
  ["Uncategorized",     "expense",  "#94a3b8", "want",  99],
];

/** [pattern, categoryName] — matched case-insensitively against merchant + description. */
const SYSTEM_RULES: Array<[string, string]> = [
  // Groceries
  ["trader joe", "Groceries"], ["whole foods", "Groceries"], ["safeway", "Groceries"],
  ["kroger", "Groceries"], ["aldi", "Groceries"], ["publix", "Groceries"],
  ["wegmans", "Groceries"], ["heb", "Groceries"], ["sprouts", "Groceries"],
  ["food lion", "Groceries"], ["giant food", "Groceries"], ["harris teeter", "Groceries"],
  ["grocery", "Groceries"],
  // Dining
  ["starbucks", "Dining & Takeout"], ["chipotle", "Dining & Takeout"],
  ["doordash", "Dining & Takeout"], ["uber eats", "Dining & Takeout"],
  ["grubhub", "Dining & Takeout"], ["mcdonald", "Dining & Takeout"],
  ["dunkin", "Dining & Takeout"], ["panera", "Dining & Takeout"],
  ["chick-fil-a", "Dining & Takeout"], ["pizza", "Dining & Takeout"],
  ["restaurant", "Dining & Takeout"], ["coffee", "Dining & Takeout"],
  ["taco bell", "Dining & Takeout"], ["cafe", "Dining & Takeout"],
  ["seamless", "Dining & Takeout"], ["postmates", "Dining & Takeout"],
  // Transportation
  ["uber", "Transportation"], ["lyft", "Transportation"], ["shell", "Transportation"],
  ["chevron", "Transportation"], ["exxon", "Transportation"], ["bp ", "Transportation"],
  ["gas station", "Transportation"], ["parking", "Transportation"],
  ["metro", "Transportation"], ["transit", "Transportation"], ["amtrak", "Transportation"],
  ["76 station", "Transportation"], ["circle k", "Transportation"], ["speedway", "Transportation"],
  // Subscriptions
  ["netflix", "Subscriptions"], ["spotify", "Subscriptions"], ["hulu", "Subscriptions"],
  ["disney+", "Subscriptions"], ["hbo", "Subscriptions"], ["youtube premium", "Subscriptions"],
  ["apple.com/bill", "Subscriptions"], ["icloud", "Subscriptions"],
  ["adobe", "Subscriptions"], ["patreon", "Subscriptions"], ["substack", "Subscriptions"],
  ["audible", "Subscriptions"], ["dropbox", "Subscriptions"], ["notion", "Subscriptions"],
  ["chatgpt", "Subscriptions"], ["claude.ai", "Subscriptions"], ["github", "Subscriptions"],
  ["prime video", "Subscriptions"], ["peacock", "Subscriptions"], ["paramount+", "Subscriptions"],
  // Shopping
  ["amazon", "Shopping"], ["amzn", "Shopping"], ["target", "Shopping"],
  ["walmart", "Shopping"], ["costco", "Shopping"], ["etsy", "Shopping"],
  ["ebay", "Shopping"], ["best buy", "Shopping"], ["ikea", "Shopping"],
  ["home depot", "Shopping"], ["lowes", "Shopping"], ["nike", "Shopping"],
  ["nordstrom", "Shopping"], ["macy", "Shopping"], ["uniqlo", "Shopping"],
  ["rei ", "Shopping"], ["wayfair", "Shopping"],
  // Utilities / connectivity
  ["comcast", "Phone & Internet"], ["xfinity", "Phone & Internet"],
  ["verizon", "Phone & Internet"], ["at&t", "Phone & Internet"],
  ["t-mobile", "Phone & Internet"], ["spectrum", "Phone & Internet"],
  ["google fi", "Phone & Internet"], ["mint mobile", "Phone & Internet"],
  ["electric", "Utilities"], ["pg&e", "Utilities"], ["water dept", "Utilities"],
  ["con edison", "Utilities"], ["duke energy", "Utilities"], ["national grid", "Utilities"],
  ["waste management", "Utilities"], ["utility", "Utilities"],
  // Housing
  ["rent", "Rent & Mortgage"], ["mortgage", "Rent & Mortgage"],
  ["property mgmt", "Rent & Mortgage"], ["landlord", "Rent & Mortgage"],
  ["zillow rental", "Rent & Mortgage"],
  // Health
  ["cvs", "Health & Medical"], ["walgreens", "Health & Medical"],
  ["pharmacy", "Health & Medical"], ["dental", "Health & Medical"],
  ["clinic", "Health & Medical"], ["hospital", "Health & Medical"],
  ["optometr", "Health & Medical"], ["therapy", "Health & Medical"],
  // Fitness lands in Personal Care
  ["planet fitness", "Personal Care"], ["equinox", "Personal Care"],
  ["gym", "Personal Care"], ["barber", "Personal Care"], ["salon", "Personal Care"],
  ["sephora", "Personal Care"], ["ulta", "Personal Care"],
  // Insurance
  ["geico", "Insurance"], ["state farm", "Insurance"], ["progressive", "Insurance"],
  ["allstate", "Insurance"], ["insurance", "Insurance"], ["lemonade", "Insurance"],
  // Entertainment
  ["steam games", "Entertainment"], ["playstation", "Entertainment"],
  ["xbox", "Entertainment"], ["nintendo", "Entertainment"], ["amc theat", "Entertainment"],
  ["cinemark", "Entertainment"], ["ticketmaster", "Entertainment"],
  ["stubhub", "Entertainment"], ["eventbrite", "Entertainment"],
  // Travel
  ["airbnb", "Travel"], ["marriott", "Travel"], ["hilton", "Travel"],
  ["delta air", "Travel"], ["united air", "Travel"], ["southwest air", "Travel"],
  ["american air", "Travel"], ["expedia", "Travel"], ["booking.com", "Travel"],
  ["hotel", "Travel"], ["hertz", "Travel"], ["enterprise rent", "Travel"],
  // Debt
  ["student loan", "Debt Payments"], ["nelnet", "Debt Payments"],
  ["sallie mae", "Debt Payments"], ["loan payment", "Debt Payments"],
  ["auto loan", "Debt Payments"],
  // Fees
  ["overdraft", "Fees & Charges"], ["atm fee", "Fees & Charges"],
  ["service charge", "Fees & Charges"], ["late fee", "Fees & Charges"],
  ["foreign transaction fee", "Fees & Charges"], ["interest charge", "Fees & Charges"],
  // Income
  ["payroll", "Income"], ["direct dep", "Income"], ["salary", "Income"],
  ["employer", "Income"], ["gusto", "Income"], ["adp ", "Income"],
  ["paychex", "Income"], ["tax refund", "Income"],
  // Savings / investing
  ["vanguard", "Investments"], ["fidelity", "Investments"],
  ["schwab", "Investments"], ["robinhood", "Investments"],
  ["betterment", "Investments"], ["wealthfront", "Investments"],
  ["coinbase", "Investments"], ["401k", "Investments"], ["roth ira", "Investments"],
  // Transfers
  ["venmo", "Transfer"], ["zelle", "Transfer"], ["cash app", "Transfer"],
  // A card payoff moves money you already counted when you swiped the card.
  ["card payment", "Transfer"], ["cardmember payment", "Transfer"],
  ["payment thank you", "Transfer"],
  ["paypal transfer", "Transfer"], ["transfer to", "Transfer"],
  ["transfer from", "Transfer"], ["online transfer", "Transfer"],
];

function seedSystemRows(database: Database.Database) {
  const insertCategory = database.prepare(
    `INSERT INTO categories (name, kind, color, bucket, is_system, sort_order)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(name) DO NOTHING`,
  );
  const insertRule = database.prepare(
    `INSERT INTO rules (pattern, category_id, priority, is_system)
     SELECT ?, id, 50, 1 FROM categories WHERE name = ?
       AND NOT EXISTS (
         SELECT 1 FROM rules r WHERE r.pattern = ? AND r.is_system = 1
       )`,
  );

  database.transaction(() => {
    for (const [name, kind, color, bucket, sort] of SYSTEM_CATEGORIES) {
      insertCategory.run(name, kind, color, bucket, sort);
    }
    for (const [pattern, categoryName] of SYSTEM_RULES) {
      insertRule.run(pattern, categoryName, pattern);
    }
    if (!database.prepare("SELECT 1 FROM accounts LIMIT 1").get()) {
      database
        .prepare(
          `INSERT INTO accounts (name, type, institution, is_manual)
           VALUES ('Cash', 'cash', 'Manual', 1)`,
        )
        .run();
    }
  })();
}

/* ------------------------------------------------------------------ */
/* The connection                                                      */
/* ------------------------------------------------------------------ */

export const db: Database.Database = globalThis.__ledgerDb ?? connect();
if (process.env.NODE_ENV !== "production") globalThis.__ledgerDb = db;

/* ------------------------------------------------------------------ */
/* Settings helpers                                                    */
/* ------------------------------------------------------------------ */

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
