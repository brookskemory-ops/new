/**
 * Deletes all financial data, leaving the schema, system categories, and rules
 * in place. Linked banks are removed locally only — if you linked through
 * Plaid, unlink from the Accounts page first so the connection is also
 * cancelled on Plaid's side.
 */

import { db } from "../src/lib/db";

const before = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };

db.transaction(() => {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM plaid_items").run();
  db.prepare("DELETE FROM budgets").run();
  db.prepare("DELETE FROM goals").run();
  db.prepare("DELETE FROM insights").run();
  db.prepare("DELETE FROM settings").run();
  // User-created categorization rules go; the shipped defaults stay.
  db.prepare("DELETE FROM rules WHERE is_system = 0").run();
})();

// Recreate the default cash account so the app is immediately usable again.
db.prepare(
  "INSERT INTO accounts (name, type, institution, is_manual) VALUES ('Cash', 'cash', 'Manual', 1)",
).run();

console.log(`Cleared ${before.n} transactions. The database is empty and ready.`);
