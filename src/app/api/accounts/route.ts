import { z } from "zod";
import { db } from "@/lib/db";
import { parseAmountToCents } from "@/lib/money";
import { listAccounts, listPlaidItems, netWorthCents } from "@/lib/queries";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async () =>
  ok({
    accounts: listAccounts(),
    net_worth: netWorthCents(),
    linked_banks: listPlaidItems(),
  }),
);

const CreateAccount = z.object({
  name: z.string().min(1).max(80),
  type: z
    .enum(["checking", "savings", "credit", "cash", "investment", "loan", "other"])
    .default("checking"),
  institution: z.string().max(80).nullable().optional(),
  balance: z.union([z.string(), z.number()]).default(0),
});

export const POST = route(async (request: Request) => {
  const body = CreateAccount.parse(await request.json());

  const balance = parseAmountToCents(body.balance);
  if (balance === null) return fail("Balance is not a valid number.", 422);

  const result = db
    .prepare(
      `INSERT INTO accounts (name, type, institution, balance_cents, is_manual)
       VALUES (?, ?, ?, ?, 1)`,
    )
    .run(body.name, body.type, body.institution ?? null, balance);

  return ok({ id: Number(result.lastInsertRowid) }, 201);
});
