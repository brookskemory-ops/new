import { z } from "zod";
import { db } from "@/lib/db";
import { parseAmountToCents } from "@/lib/money";
import { getAccount } from "@/lib/queries";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const UpdateAccount = z.object({
  name: z.string().min(1).max(80).optional(),
  type: z
    .enum(["checking", "savings", "credit", "cash", "investment", "loan", "other"])
    .optional(),
  institution: z.string().max(80).nullable().optional(),
  balance: z.union([z.string(), z.number()]).optional(),
  /**
   * The amount actually present — you counted your wallet. The difference from
   * the derived balance is recorded as a visible adjustment transaction rather
   * than quietly rewriting the opening balance, so the ledger still explains
   * itself: cash you forgot to record shows up as an adjustment, not as money
   * that appeared from nowhere.
   */
  reconcile_to: z.union([z.string(), z.number()]).optional(),
});

/**
 * Edit an account. The type matters beyond cosmetics: credit and loan accounts
 * count against net worth instead of toward it, so a card guessed as a
 * checking account shows up on the wrong side of the ledger.
 */
export const PATCH = route(async (request: Request, context: Context) => {
  const id = Number((await context.params).id);
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as
    | { id: number; is_manual: number }
    | undefined;
  if (!account) return fail(`No account with id ${id}.`, 404);

  const body = UpdateAccount.parse(await request.json());

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    params.push(body.name);
  }
  if (body.type !== undefined) {
    updates.push("type = ?");
    params.push(body.type);
  }
  if (body.institution !== undefined) {
    updates.push("institution = ?");
    params.push(body.institution);
  }
  if (body.balance !== undefined) {
    // A synced account's balance comes from the bank and is overwritten on the
    // next sync, so editing it by hand would silently revert.
    if (account.is_manual === 0) {
      return fail(
        "This balance is set by your bank on each sync, so it cannot be edited here.",
        422,
      );
    }
    const cents = parseAmountToCents(body.balance);
    if (cents === null) return fail("Balance is not a valid number.", 422);
    // For a manual account the live balance is derived, so an edit here sets
    // the *opening* figure; writing balance_cents alone would have no effect.
    updates.push("balance_cents = ?", "opening_balance_cents = ?");
    params.push(cents, cents);
  }

  let adjustment: number | null = null;

  if (body.reconcile_to !== undefined) {
    if (account.is_manual === 0) {
      return fail("A synced account is reconciled by your bank, not here.", 422);
    }
    const actual = parseAmountToCents(body.reconcile_to);
    if (actual === null) return fail("That is not a valid amount.", 422);

    const current = getAccount(id)!.balance_cents;
    adjustment = actual - current;

    if (adjustment !== 0) {
      const category = db
        .prepare("SELECT id FROM categories WHERE name = ?")
        .get(adjustment < 0 ? "Uncategorized" : "Income") as { id: number } | undefined;

      db.prepare(
        `INSERT INTO transactions
           (account_id, category_id, date, amount_cents, merchant, description, source)
         VALUES (?, ?, date('now','localtime'), ?, ?, ?, 'manual')`,
      ).run(
        id,
        category?.id ?? null,
        adjustment,
        "Balance adjustment",
        adjustment < 0
          ? "Cash spent but not recorded"
          : "Cash on hand higher than recorded",
      );
    }
  }

  if (updates.length === 0 && adjustment === null) {
    return fail("Nothing to update.", 422);
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE accounts SET ${updates.join(", ")} WHERE id = ?`).run(...params, id);
  }

  return ok({ account: getAccount(id), adjustment_cents: adjustment });
});

/**
 * Delete an account and its transactions.
 *
 * A synced account would simply reappear on the next sync, so those are
 * refused with a pointer at the thing that actually removes them.
 */
export const DELETE = route(async (_request: Request, context: Context) => {
  const id = Number((await context.params).id);
  const account = db
    .prepare("SELECT id, name, is_manual FROM accounts WHERE id = ?")
    .get(id) as { id: number; name: string; is_manual: number } | undefined;
  if (!account) return fail(`No account with id ${id}.`, 404);

  if (account.is_manual === 0) {
    return fail(
      "This account comes from a bank connection. Disconnect the connection to remove it.",
      422,
    );
  }

  const count = db
    .prepare("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?")
    .get(id) as { n: number };

  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);

  return ok({ deleted: id, transactions_removed: count.n });
});
