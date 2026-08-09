/**
 * Seeds six months of realistic demo data so the app can be evaluated before
 * you connect anything real. `npm run reset` removes it.
 *
 * The numbers describe someone starting a new job partway through: a couple of
 * lean months, then a salary that steps up. That makes the trend chart, the
 * budget meters, and the AI analysis all show something worth looking at.
 */

import { db } from "../src/lib/db";
import { categorize, looksLikeTransfer } from "../src/lib/categorize";
import { addMonths, currentMonth, monthRange } from "../src/lib/money";

interface Recipe {
  merchant: string;
  /** Dollar range, inclusive. */
  low: number;
  high: number;
  /** Roughly how many times a month. */
  perMonth: number;
}

const SPENDING: Recipe[] = [
  { merchant: "Trader Joe's", low: 38, high: 96, perMonth: 4 },
  { merchant: "Safeway", low: 22, high: 71, perMonth: 2 },
  { merchant: "Starbucks", low: 5, high: 12, perMonth: 9 },
  { merchant: "Chipotle", low: 11, high: 19, perMonth: 3 },
  { merchant: "DoorDash", low: 24, high: 58, perMonth: 4 },
  { merchant: "Blue Bottle Coffee", low: 5, high: 9, perMonth: 4 },
  { merchant: "Uber", low: 9, high: 34, perMonth: 5 },
  { merchant: "Shell", low: 32, high: 61, perMonth: 2 },
  { merchant: "Amazon", low: 14, high: 128, perMonth: 6 },
  { merchant: "Target", low: 26, high: 94, perMonth: 2 },
  { merchant: "CVS Pharmacy", low: 8, high: 42, perMonth: 2 },
  { merchant: "AMC Theatres", low: 16, high: 32, perMonth: 1 },
  { merchant: "Steam Games", low: 12, high: 60, perMonth: 1 },
];

/** Charged the same amount on the same day each month. */
const RECURRING: Array<{ merchant: string; amount: number; day: number }> = [
  { merchant: "Sunset Property Management (Rent)", amount: 1850, day: 1 },
  { merchant: "Pacific Gas & Electric", amount: 94.32, day: 8 },
  { merchant: "Comcast Xfinity Internet", amount: 79.99, day: 12 },
  { merchant: "Verizon Wireless", amount: 85.0, day: 15 },
  { merchant: "Netflix", amount: 22.99, day: 4 },
  { merchant: "Spotify", amount: 11.99, day: 7 },
  { merchant: "Planet Fitness", amount: 24.99, day: 3 },
  { merchant: "Adobe Creative Cloud", amount: 59.99, day: 18 },
  { merchant: "Geico Auto Insurance", amount: 132.4, day: 22 },
  { merchant: "iCloud+ Storage", amount: 9.99, day: 11 },
  { merchant: "Nelnet Student Loan", amount: 287.0, day: 20 },
];

// Deterministic PRNG so re-seeding produces the same data and screenshots or
// bug reports stay reproducible.
let seed = 20260826;
function random(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

function between(low: number, high: number): number {
  return Math.round((low + random() * (high - low)) * 100);
}

/** Has this day-of-month already passed? Always true for a past month. */
function hasOccurred(month: string, day: number): boolean {
  if (month !== currentMonth()) return true;
  return day <= new Date().getDate();
}

/**
 * Clamp a day to the month, and — for the month in progress — to today.
 * Seeding future-dated spending would make the budget meters read "already
 * blown" on the 3rd, which is exactly the signal they exist to give honestly.
 */
function dayIn(month: string, day: number): string {
  const { end } = monthRange(month);
  let lastDay = Number(end.slice(8));

  if (month === currentMonth()) {
    lastDay = Math.min(lastDay, new Date().getDate());
  }

  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function main() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {
    n: number;
  };
  if (existing.n > 0) {
    console.log(
      `There are already ${existing.n} transactions. Run "npm run reset" first if you want a clean demo.`,
    );
    process.exit(1);
  }

  // Accounts
  db.prepare("DELETE FROM accounts WHERE name = 'Cash' AND is_manual = 1").run();
  const checking = Number(
    db
      .prepare(
        `INSERT INTO accounts (name, type, institution, balance_cents, is_manual)
         VALUES ('Everyday Checking', 'checking', 'Demo Bank', 428650, 1)`,
      )
      .run().lastInsertRowid,
  );
  const card = Number(
    db
      .prepare(
        `INSERT INTO accounts (name, type, institution, balance_cents, is_manual)
         VALUES ('Rewards Card', 'credit', 'Demo Bank', 112430, 1)`,
      )
      .run().lastInsertRowid,
  );
  const savings = Number(
    db
      .prepare(
        `INSERT INTO accounts (name, type, institution, balance_cents, is_manual)
         VALUES ('Savings', 'savings', 'Demo Bank', 610000, 1)`,
      )
      .run().lastInsertRowid,
  );

  const insert = db.prepare(
    `INSERT INTO transactions
       (account_id, category_id, date, amount_cents, merchant, description, is_transfer, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`,
  );

  function add(accountId: number, date: string, cents: number, merchant: string) {
    const input = { merchant, description: merchant, amount_cents: cents };
    insert.run(
      accountId,
      categorize(input),
      date,
      cents,
      merchant,
      merchant,
      looksLikeTransfer(input) ? 1 : 0,
    );
  }

  const months = Array.from({ length: 6 }, (_, i) => addMonths(currentMonth(), i - 5));

  db.transaction(() => {
    months.forEach((month, index) => {
      // The new job starts two months in — pay steps up and stays there.
      const newJob = index >= 4;
      const paycheck = newJob ? 3620 : 2480;

      // A paycheck or bill dated later this month has not happened yet, so it
      // is skipped rather than clamped onto today — otherwise the month in
      // progress shows a full month's income against a partial month's spend.
      for (const day of [1, 15]) {
        if (!hasOccurred(month, day)) continue;
        add(checking, dayIn(month, day), Math.round(paycheck * 100), "ACME Corp Payroll");
      }

      for (const bill of RECURRING) {
        if (!hasOccurred(month, bill.day)) continue;
        add(checking, dayIn(month, bill.day), -Math.round(bill.amount * 100), bill.merchant);
      }

      // The month in progress gets a proportional slice of activity, not a
      // full month's worth crammed into the days so far.
      const elapsed =
        month === currentMonth()
          ? Math.max(new Date().getDate() / 28, 0.15)
          : 1;

      for (const recipe of SPENDING) {
        // Spending drifts up a little after the raise, the way it actually does.
        const count = Math.max(
          1,
          Math.round(
            recipe.perMonth *
              (newJob ? 1.15 : 1) *
              (0.7 + random() * 0.6) *
              Math.min(elapsed, 1),
          ),
        );
        for (let i = 0; i < count; i++) {
          const day = 1 + Math.floor(random() * 28 * Math.min(elapsed, 1));
          // Everyday spending goes on the card; that's what the card is for.
          const account = recipe.merchant === "Amazon" || random() > 0.35 ? card : checking;
          add(account, dayIn(month, day), -between(recipe.low, recipe.high), recipe.merchant);
        }
      }

      // Monthly transfer to savings — must NOT count as spending, which is
      // exactly the case the transfer handling exists to get right.
      if (hasOccurred(month, 16)) {
        add(checking, dayIn(month, 16), -(newJob ? 60000 : 25000), "Online Transfer to Savings");
        add(savings, dayIn(month, 16), newJob ? 60000 : 25000, "Online Transfer from Checking");
      }

      // Card payment — also a transfer, not new spending.
      if (hasOccurred(month, 25)) {
        add(checking, dayIn(month, 25), -95000, "Rewards Card Payment");
      }
    });
  })();

  // A few budgets, deliberately including one that is blown.
  const budgetFor = (name: string, dollars: number) => {
    const row = db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as
      | { id: number }
      | undefined;
    if (row) {
      db.prepare(
        `INSERT INTO budgets (category_id, amount_cents, month) VALUES (?, ?, '*')
         ON CONFLICT(category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
      ).run(row.id, dollars * 100);
    }
  };

  budgetFor("Groceries", 500);
  budgetFor("Dining & Takeout", 250);
  budgetFor("Shopping", 200);
  budgetFor("Transportation", 180);
  budgetFor("Entertainment", 80);
  budgetFor("Subscriptions", 100);

  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('monthly_income', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(3620 * 2 * 100));

  db.prepare(
    "INSERT INTO goals (name, target_cents, saved_cents, target_date) VALUES (?, ?, ?, ?)",
  ).run("Emergency fund (3 months)", 1200000, 610000, null);

  const count = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {
    n: number;
  };
  console.log(`Seeded ${count.n} transactions across ${months.length} months.`);
  console.log("Start the app with: npm run dev");
}

main();
