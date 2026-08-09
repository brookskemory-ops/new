import { z } from "zod";
import { db } from "@/lib/db";
import { currentMonth, parseAmountToCents } from "@/lib/money";
import { budgetProgress } from "@/lib/queries";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? currentMonth();
  return ok({ month, budgets: budgetProgress(month) });
});

const SetBudget = z.object({
  category_id: z.number().int().positive(),
  amount: z.union([z.string(), z.number()]),
  /**
   * '*' (the default) sets the recurring budget that applies to every month.
   * A 'YYYY-MM' string overrides just that one month.
   */
  month: z
    .string()
    .regex(/^(\*|\d{4}-\d{2})$/, "must be YYYY-MM or *")
    .default("*"),
});

export const PUT = route(async (request: Request) => {
  const body = SetBudget.parse(await request.json());

  const cents = parseAmountToCents(body.amount);
  if (cents === null || cents < 0) return fail("Budget must be zero or more.", 422);

  const month = body.month;

  // Setting a budget to 0 removes it — that reads more naturally in the UI
  // than a separate delete button.
  if (cents === 0) {
    db.prepare("DELETE FROM budgets WHERE category_id = ? AND month = ?").run(
      body.category_id,
      month,
    );
    return ok({ removed: true });
  }

  db.prepare(
    `INSERT INTO budgets (category_id, amount_cents, month)
     VALUES (?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
  ).run(body.category_id, cents, month);

  return ok({ category_id: body.category_id, amount_cents: cents, month });
});
