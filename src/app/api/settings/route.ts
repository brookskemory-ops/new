import { z } from "zod";
import { getSetting, setSetting } from "@/lib/db";
import { parseAmountToCents } from "@/lib/money";
import { isAIConfigured, aiModel, estimatedCostNote } from "@/lib/ai";
import { isPlaidConfigured, plaidEnvName } from "@/lib/plaid";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async () =>
  ok({
    monthly_income_cents: getSetting("monthly_income"),
    pay_cadence: getSetting("pay_cadence"),
    start_date: getSetting("start_date"),
    integrations: {
      plaid: { configured: isPlaidConfigured(), environment: plaidEnvName() },
      ai: {
        configured: isAIConfigured(),
        model: aiModel(),
        cost_note: estimatedCostNote(),
      },
    },
  }),
);

const UpdateSettings = z.object({
  monthly_income: z.union([z.string(), z.number()]).optional(),
  pay_cadence: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const PUT = route(async (request: Request) => {
  const body = UpdateSettings.parse(await request.json());

  if (body.monthly_income !== undefined) {
    const cents = parseAmountToCents(body.monthly_income);
    if (cents === null || cents < 0) return fail("Income must be zero or more.", 422);
    setSetting("monthly_income", String(cents));
  }
  if (body.pay_cadence) setSetting("pay_cadence", body.pay_cadence);
  if (body.start_date) setSetting("start_date", body.start_date);

  return ok({ saved: true });
});
