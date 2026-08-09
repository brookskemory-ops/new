import { createLinkToken, createUpdateLinkToken, isPlaidConfigured, plaidErrorMessage } from "@/lib/plaid";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Mint a Link token. Passing ?item=<id> returns a token that opens Plaid Link
 * straight into the re-authentication flow for a bank whose login expired.
 */
export const GET = route(async (request: Request) => {
  if (!isPlaidConfigured()) {
    return fail("Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env.", 503);
  }

  const itemId = new URL(request.url).searchParams.get("item");

  try {
    const link_token = itemId
      ? await createUpdateLinkToken(Number(itemId))
      : await createLinkToken();
    return ok({ link_token });
  } catch (error) {
    return fail(plaidErrorMessage(error), 502);
  }
});
