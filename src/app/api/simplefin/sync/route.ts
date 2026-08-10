import { SimpleFinError, syncAllConnections, syncConnection } from "@/lib/simplefin";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Pull new transactions from every SimpleFIN connection, or one with
 * ?connection=<id>. Add ?full=1 to re-pull a full year rather than the short
 * incremental window.
 */
export const POST = route(async (request: Request) => {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connection");
  // ?full=1 ignores the short incremental window and re-pulls a year. Used
  // when a bank was connected late, or simply looks like it is missing history.
  const fullHistory = url.searchParams.get("full") === "1";

  try {
    if (connectionId) {
      return ok({
        results: [await syncConnection(Number(connectionId), { fullHistory })],
        errors: [],
      });
    }
    return ok(await syncAllConnections({ fullHistory }));
  } catch (error) {
    if (error instanceof SimpleFinError) {
      return fail(error.message, error.kind === "auth" ? 401 : 502);
    }
    throw error;
  }
});
