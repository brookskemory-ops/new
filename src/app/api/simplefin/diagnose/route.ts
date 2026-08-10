import { diagnoseConnection, SimpleFinError } from "@/lib/simplefin";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Report what SimpleFIN actually returns, without writing anything.
 *
 * Read-only on purpose: when one bank syncs and another does not, you want to
 * inspect the feed without a sync mutating state underneath you.
 */
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const connectionId = Number(url.searchParams.get("connection"));
  if (!Number.isInteger(connectionId) || connectionId <= 0) {
    return fail("A connection id is required.", 422);
  }

  try {
    return ok({ diagnosis: await diagnoseConnection(connectionId) });
  } catch (error) {
    if (error instanceof SimpleFinError) return fail(error.message, 502);
    throw error;
  }
});
