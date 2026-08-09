import { SimpleFinError, syncAllConnections, syncConnection } from "@/lib/simplefin";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Pull new transactions from every SimpleFIN connection, or one with ?connection=<id>. */
export const POST = route(async (request: Request) => {
  const connectionId = new URL(request.url).searchParams.get("connection");

  try {
    if (connectionId) {
      return ok({ results: [await syncConnection(Number(connectionId))], errors: [] });
    }
    return ok(await syncAllConnections());
  } catch (error) {
    if (error instanceof SimpleFinError) {
      return fail(error.message, error.kind === "auth" ? 401 : 502);
    }
    throw error;
  }
});
