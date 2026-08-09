import { z } from "zod";
import { db } from "@/lib/db";
import { categorize, looksLikeTransfer } from "@/lib/categorize";
import { parseAmountToCents } from "@/lib/money";
import { countTransactions, listTransactions } from "@/lib/queries";
import { fail, numParam, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const transactions = listTransactions({
    month: url.searchParams.get("month") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    search: url.searchParams.get("q") ?? undefined,
    categoryId: numParam(url, "category"),
    accountId: numParam(url, "account"),
    uncategorizedOnly: url.searchParams.get("uncategorized") === "1",
    limit: numParam(url, "limit") ?? 100,
    offset: numParam(url, "offset") ?? 0,
  });

  return ok({
    transactions,
    total: countTransactions({
      month: url.searchParams.get("month") ?? undefined,
      search: url.searchParams.get("q") ?? undefined,
      categoryId: numParam(url, "category"),
      accountId: numParam(url, "account"),
      uncategorizedOnly: url.searchParams.get("uncategorized") === "1",
    }),
  });
});

const CreateTransaction = z.object({
  account_id: z.number().int().positive(),
  // Accepts "42", "$1,299.99", "(20)" — parsed in one place, see money.ts
  amount: z.union([z.string(), z.number()]),
  /** "expense" flips a positive amount to negative; "income" keeps it positive. */
  direction: z.enum(["expense", "income"]).default("expense"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  merchant: z.string().max(200).default(""),
  description: z.string().max(500).default(""),
  category_id: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  is_transfer: z.boolean().optional(),
});

export const POST = route(async (request: Request) => {
  const body = CreateTransaction.parse(await request.json());

  const magnitude = parseAmountToCents(body.amount);
  if (magnitude === null) return fail("Amount is not a valid number.", 422);
  if (magnitude === 0) return fail("Amount cannot be zero.", 422);

  // The form gives a positive number plus a direction; the sign convention is
  // applied here so the UI never has to think about it.
  const amountCents =
    body.direction === "expense" ? -Math.abs(magnitude) : Math.abs(magnitude);

  const account = db
    .prepare("SELECT id FROM accounts WHERE id = ?")
    .get(body.account_id);
  if (!account) return fail(`No account with id ${body.account_id}.`, 422);

  const input = {
    merchant: body.merchant,
    description: body.description,
    amount_cents: amountCents,
  };

  // A category the user picked is locked so re-running the rules never
  // overwrites it later.
  const categoryId = body.category_id ?? categorize(input);
  const locked = body.category_id ? 1 : 0;

  const result = db
    .prepare(
      `INSERT INTO transactions
         (account_id, category_id, date, amount_cents, merchant, description,
          notes, is_transfer, source, category_locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
    )
    .run(
      body.account_id,
      categoryId,
      body.date,
      amountCents,
      body.merchant,
      body.description,
      body.notes ?? null,
      (body.is_transfer ?? looksLikeTransfer(input)) ? 1 : 0,
      locked,
    );

  return ok({ id: Number(result.lastInsertRowid) }, 201);
});
