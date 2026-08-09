import {
  AIError,
  aiErrorMessage,
  analyzeMonth,
  estimatedCostNote,
  getCachedInsight,
  isAIConfigured,
} from "@/lib/ai";
import { currentMonth } from "@/lib/money";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";
// The model can take a while at higher effort; don't let the platform cut it off.
export const maxDuration = 120;

/** Returns a cached analysis if one exists. Never calls the API, never bills. */
export const GET = route(async (request: Request) => {
  const month = new URL(request.url).searchParams.get("month") ?? currentMonth();
  return ok({
    month,
    configured: isAIConfigured(),
    cost_note: estimatedCostNote(),
    result: isAIConfigured() ? getCachedInsight(month) : null,
  });
});

/** Runs the analysis. This is the only path that spends money. */
export const POST = route(async (request: Request) => {
  const body = (await request.json().catch(() => ({}))) as {
    month?: string;
    force?: boolean;
  };
  const month = body.month ?? currentMonth();

  try {
    return ok({ month, result: await analyzeMonth(month, body.force === true) });
  } catch (error) {
    if (error instanceof AIError) {
      const status =
        error.kind === "unconfigured" ? 503 : error.kind === "no_data" ? 422 : 502;
      return fail(error.message, status);
    }
    return fail(aiErrorMessage(error), 502);
  }
});
