import { isPlaidConfigured, plaidErrorMessage, syncAllItems, syncTransactions } from "@/lib/plaid";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Pull new transactions. Syncs every linked bank, or one with ?item=<id>. */
export const POST = route(async (request: Request) => {
  if (!isPlaidConfigured()) {
    return fail("Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env.", 503);
  }

  const itemId = new URL(request.url).searchParams.get("item");

  try {
    if (itemId) {
      return ok({ results: [await syncTransactions(Number(itemId))], errors: [] });
    }
    return ok(await syncAllItems());
  } catch (error) {
    return fail(plaidErrorMessage(error), 502);
  }
});
