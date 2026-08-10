import { z } from "zod";
import { AIError, aiErrorMessage } from "@/lib/ai";
import { askQuestion } from "@/lib/chat";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Ask = z.object({
  question: z.string().min(1).max(500),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(20)
    .default([]),
});

/** Answer one question. Each call spends about a cent. */
export const POST = route(async (request: Request) => {
  const body = Ask.parse(await request.json());

  try {
    return ok(await askQuestion(body.question, body.history));
  } catch (error) {
    if (error instanceof AIError) {
      return fail(error.message, error.kind === "unconfigured" ? 503 : 502);
    }
    return fail(aiErrorMessage(error), 502);
  }
});
