import { z } from "zod";
import { db } from "@/lib/db";
import { parseAmountToCents } from "@/lib/money";
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
    updates.push("balance_cents = ?");
    params.push(cents);
  }

  if (updates.length === 0) return fail("Nothing to update.", 422);

  db.prepare(`UPDATE accounts SET ${updates.join(", ")} WHERE id = ?`).run(...params, id);

  return ok({ account: db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) });
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
