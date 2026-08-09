import { plaidErrorMessage, removeItem } from "@/lib/plaid";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Unlink a bank. Tells Plaid to invalidate the access token (so it stops
 * billing you for the connection) and removes the local accounts and their
 * transactions.
 */
export const DELETE = route(async (_request: Request, context: Context) => {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail("Invalid bank id.", 422);

  try {
    await removeItem(id);
    return ok({ unlinked: id });
  } catch (error) {
    return fail(plaidErrorMessage(error), 502);
  }
});
