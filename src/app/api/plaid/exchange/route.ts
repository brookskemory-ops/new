import { z } from "zod";
import { exchangePublicToken, isPlaidConfigured, plaidErrorMessage, syncTransactions } from "@/lib/plaid";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Exchange = z.object({ public_token: z.string().min(10) });

/**
 * Called by the browser after Plaid Link succeeds. Swaps the short-lived
 * public token for a durable access token, then pulls history immediately so
 * the dashboard has data the moment the modal closes.
 */
export const POST = route(async (request: Request) => {
  if (!isPlaidConfigured()) {
    return fail("Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env.", 503);
  }

  const body = Exchange.parse(await request.json());

  try {
    const itemId = await exchangePublicToken(body.public_token);
    const sync = await syncTransactions(itemId);
    return ok({ item_id: itemId, sync }, 201);
  } catch (error) {
    return fail(plaidErrorMessage(error), 502);
  }
});
