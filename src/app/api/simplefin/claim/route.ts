import { z } from "zod";
import { claimSetupToken, SimpleFinError, syncConnection } from "@/lib/simplefin";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Claim = z.object({ setup_token: z.string().min(1) });

/**
 * Trade a SimpleFIN Setup Token for a stored connection, then pull history
 * straight away so the dashboard has data as soon as the form returns.
 */
export const POST = route(async (request: Request) => {
  const body = Claim.parse(await request.json());

  try {
    const connectionId = await claimSetupToken(body.setup_token);
    const sync = await syncConnection(connectionId);
    return ok({ connection_id: connectionId, sync }, 201);
  } catch (error) {
    if (error instanceof SimpleFinError) {
      const status =
        error.kind === "invalid_token" || error.kind === "invalid_url"
          ? 422
          : error.kind === "auth"
            ? 401
            : error.kind === "payment_required"
              ? 402
              : 502;
      return fail(error.message, status);
    }
    throw error;
  }
});
