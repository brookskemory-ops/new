import { z } from "zod";
import { db } from "@/lib/db";
import { invalidateRulesCache } from "@/lib/categorize";
import { parseAmountToCents } from "@/lib/money";
import { getTransaction } from "@/lib/queries";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const UpdateTransaction = z.object({
  amount: z.union([z.string(), z.number()]).optional(),
  direction: z.enum(["expense", "income"]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  merchant: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  category_id: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  is_transfer: z.boolean().optional(),
  /**
   * When set with a category change, saves a rule so every future transaction
   * matching this merchant lands in the same category. This is how the
   * categorizer learns from corrections.
   */
  save_rule: z.boolean().optional(),
});

export const PATCH = route(async (request: Request, context: Context) => {
  const id = Number((await context.params).id);
  const existing = getTransaction(id);
  if (!existing) return fail(`No transaction with id ${id}.`, 404);

  const body = UpdateTransaction.parse(await request.json());

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.amount !== undefined) {
    const magnitude = parseAmountToCents(body.amount);
    if (magnitude === null || magnitude === 0) {
      return fail("Amount must be a non-zero number.", 422);
    }
    // Direction defaults to whatever the transaction already was, so editing
    // only the amount never silently flips an expense into income.
    const direction =
      body.direction ?? (existing.amount_cents < 0 ? "expense" : "income");
    updates.push("amount_cents = ?");
    params.push(direction === "expense" ? -Math.abs(magnitude) : Math.abs(magnitude));
  }

  for (const field of ["date", "merchant", "description", "notes"] as const) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(body[field]);
    }
  }

  if (body.is_transfer !== undefined) {
    updates.push("is_transfer = ?");
    params.push(body.is_transfer ? 1 : 0);
  }

  if (body.category_id !== undefined) {
    updates.push("category_id = ?", "category_locked = 1");
    params.push(body.category_id);
  }

  if (updates.length === 0) return fail("Nothing to update.", 422);

  updates.push("updated_at = datetime('now')");
  db.prepare(`UPDATE transactions SET ${updates.join(", ")} WHERE id = ?`).run(
    ...params,
    id,
  );

  // Learn from the correction: remember that this merchant means this category.
  let ruleCreated = false;
  if (body.save_rule && body.category_id) {
    const pattern = (body.merchant ?? existing.merchant).trim().toLowerCase();
    if (pattern.length >= 3) {
      db.prepare(
        `INSERT INTO rules (pattern, category_id, priority, is_system)
         VALUES (?, ?, 200, 0)`,
      ).run(pattern, body.category_id);
      invalidateRulesCache();
      ruleCreated = true;
    }
  }

  return ok({ transaction: getTransaction(id), rule_created: ruleCreated });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const id = Number((await context.params).id);
  const result = db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  if (result.changes === 0) return fail(`No transaction with id ${id}.`, 404);
  return ok({ deleted: id });
});
