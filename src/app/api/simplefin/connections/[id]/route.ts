import { removeConnection } from "@/lib/simplefin";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Disconnect. Deleting the stored Access URL is what ends this app's access —
 * there is nothing to revoke remotely. Cancel the subscription itself on the
 * SimpleFIN site.
 */
export const DELETE = route(async (_request: Request, context: Context) => {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail("Invalid connection id.", 422);
  removeConnection(id);
  return ok({ disconnected: id });
});
