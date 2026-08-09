import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import { db } from "./db";
import { formatCents, formatMonth, monthProgress } from "./money";
import {
  budgetProgress,
  categoryTotals,
  monthSummary,
  monthlyTrend,
  recurringCharges,
  topMerchants,
} from "./queries";
import { getSetting } from "./db";

/**
 * AI spending analysis via the Anthropic API.
 *
 * Two things are deliberate here:
 *
 *  1. The model never sees raw transactions. It gets aggregates — category
 *     totals, budget variance, recurring charges, month-over-month trend. That
 *     is enough to give useful advice and it keeps individual merchants, dates,
 *     and amounts out of the request. Nothing identifying leaves the machine.
 *
 *  2. Results are cached against a hash of the exact numbers analyzed. Opening
 *     the Insights page ten times costs one API call, not ten. A new call
 *     happens only when the underlying data actually changed, or you ask for a
 *     refresh explicitly.
 */

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * An env var present but empty — which is exactly what `.env.example` ships,
 * e.g. `ANTHROPIC_MODEL=` — is `""`, not undefined. `??` would happily return
 * that empty string and we would call the API with no model name. Treat blank
 * as unset.
 */
function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function isAIConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function aiModel(): string {
  return envOr("ANTHROPIC_MODEL", DEFAULT_MODEL);
}

/* ------------------------------------------------------------------ */
/* The shape we ask the model for                                      */
/* ------------------------------------------------------------------ */

export interface Insight {
  headline: string;
  summary: string;
  observations: Array<{
    title: string;
    detail: string;
    severity: "info" | "watch" | "urgent";
  }>;
  recommendations: Array<{
    action: string;
    rationale: string;
    /** The model's estimate of monthly dollars freed up. 0 when not quantifiable. */
    estimated_monthly_savings: number;
    difficulty: "easy" | "moderate" | "hard";
  }>;
  suggested_budgets: Array<{
    category: string;
    monthly_amount: number;
    reasoning: string;
  }>;
}

/**
 * JSON Schema for the structured output. Every object needs
 * `additionalProperties: false` and a complete `required` list — the API
 * rejects schemas without them.
 */
const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description: "One sentence, under 90 characters, on the state of this month.",
    },
    summary: {
      type: "string",
      description: "Two to four sentences of plain-language context. No preamble.",
    },
    observations: {
      type: "array",
      description: "3-6 specific things the numbers show. Cite the actual figures.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          severity: { type: "string", enum: ["info", "watch", "urgent"] },
        },
        required: ["title", "detail", "severity"],
        additionalProperties: false,
      },
    },
    recommendations: {
      type: "array",
      description: "2-5 concrete actions, most impactful first.",
      items: {
        type: "object",
        properties: {
          action: { type: "string" },
          rationale: { type: "string" },
          estimated_monthly_savings: {
            type: "number",
            description: "Whole dollars per month. 0 if it cannot be estimated.",
          },
          difficulty: { type: "string", enum: ["easy", "moderate", "hard"] },
        },
        required: ["action", "rationale", "estimated_monthly_savings", "difficulty"],
        additionalProperties: false,
      },
    },
    suggested_budgets: {
      type: "array",
      description:
        "Proposed monthly budgets for categories that have none or are badly mis-set. Empty array if the current budgets look right.",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          monthly_amount: { type: "number", description: "Whole dollars." },
          reasoning: { type: "string" },
        },
        required: ["category", "monthly_amount", "reasoning"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "summary", "observations", "recommendations", "suggested_budgets"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a personal finance analyst reviewing one person's monthly spending. You are given aggregate figures only — category totals, budget variance, recurring charges, and month-over-month trend. You never see individual transactions.

Ground every observation in a number you were actually given. Quote the figure. If the data does not support a claim, do not make it.

Judge spending against the month's progress, not the calendar: 70% of a budget spent on day 6 is a real problem, and the same 70% on day 26 is fine. The percentage of the month elapsed is given to you — use it.

Rank recommendations by dollars freed per unit of effort. A forgotten $60/mo subscription outranks a suggestion to cook at home more, because one is a single cancellation and the other is a lifestyle change. Prefer structural fixes (cancel, renegotiate, automate a transfer) over willpower.

When you propose a budget, base it on what this person actually spends — typically their recent median, trimmed toward the lower end where the category is discretionary. Do not propose budgets that would require an implausible overnight change in behavior.

Say the uncomfortable thing when the numbers show it: if spending exceeds income, lead with that. Do not soften it, and do not pad the response with reassurance. Skip caveats about consulting a professional unless the situation genuinely calls for one (bankruptcy, tax, legal).

Write plainly, in second person, to someone who is capable but not a finance person. No jargon, no filler, no restating the question back.`;

/* ------------------------------------------------------------------ */
/* Building the (aggregate-only) payload                               */
/* ------------------------------------------------------------------ */

interface AnalysisPayload {
  month: string;
  month_elapsed_pct: number;
  income: number;
  spending: number;
  net: number;
  stated_monthly_income: number | null;
  needs_wants_saved: {
    needs: number;
    wants: number;
    /**
     * What actually stayed with them: income minus spending, plus anything
     * filed under a savings/investment category. Money moved into a savings
     * account is a transfer, so it is deliberately absent from `spending` —
     * reading the savings bucket alone would say they saved nothing.
     */
    saved: number;
  };
  by_category: Array<{ category: string; spent: number; transactions: number }>;
  budgets: Array<{ category: string; budget: number; spent: number; remaining: number }>;
  recurring: Array<{ merchant: string; monthly_amount: number; months_seen: number }>;
  top_merchants: Array<{ merchant: string; spent: number; visits: number }>;
  trend: Array<{ month: string; income: number; spending: number; net: number }>;
}

/** Cents to whole dollars — the model does not need precision it cannot use. */
const dollars = (cents: number) => Math.round(cents / 100);

export function buildPayload(month: string): AnalysisPayload {
  const summary = monthSummary(month);
  const statedIncome = getSetting("monthly_income");

  return {
    month: formatMonth(month),
    month_elapsed_pct: Math.round(monthProgress(month) * 100),
    income: dollars(summary.income_cents),
    spending: dollars(summary.spending_cents),
    net: dollars(summary.net_cents),
    stated_monthly_income: statedIncome ? dollars(Number(statedIncome)) : null,
    needs_wants_saved: {
      needs: dollars(summary.buckets.need),
      wants: dollars(summary.buckets.want),
      saved: dollars(Math.max(summary.net_cents, 0) + summary.buckets.save),
    },
    by_category: categoryTotals(month).map((c) => ({
      category: c.name,
      spent: dollars(c.total_cents),
      transactions: c.count,
    })),
    budgets: budgetProgress(month).map((b) => ({
      category: b.category_name,
      budget: dollars(b.budget_cents),
      spent: dollars(b.spent_cents),
      remaining: dollars(b.remaining_cents),
    })),
    recurring: recurringCharges(month).map((r) => ({
      merchant: r.merchant,
      monthly_amount: dollars(r.avg_cents),
      months_seen: r.months,
    })),
    top_merchants: topMerchants(month, 10).map((m) => ({
      merchant: m.merchant,
      spent: dollars(m.total_cents),
      visits: m.count,
    })),
    trend: monthlyTrend(month, 6).map((m) => ({
      month: m.month,
      income: dollars(m.income_cents),
      spending: dollars(m.spending_cents),
      net: dollars(m.net_cents),
    })),
  };
}

function hashPayload(payload: AnalysisPayload): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/* ------------------------------------------------------------------ */
/* The call                                                            */
/* ------------------------------------------------------------------ */

export interface InsightResult {
  insight: Insight;
  model: string;
  created_at: string;
  /** True when this came from the cache and cost nothing. */
  cached: boolean;
}

export class AIError extends Error {
  constructor(
    message: string,
    readonly kind: "unconfigured" | "no_data" | "refused" | "api",
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!isAIConfigured()) {
    throw new AIError(
      "Anthropic API key not set. Add ANTHROPIC_API_KEY to .env — see README.",
      "unconfigured",
    );
  }
  // The SDK reads ANTHROPIC_API_KEY from the environment on its own.
  client ??= new Anthropic();
  return client;
}

export function getCachedInsight(month: string): InsightResult | null {
  const payload = buildPayload(month);
  const hash = hashPayload(payload);

  const row = db
    .prepare(
      `SELECT body, model, created_at FROM insights
        WHERE month = ? AND input_hash = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(month, hash) as
    | { body: string; model: string; created_at: string }
    | undefined;

  if (!row) return null;
  return {
    insight: JSON.parse(row.body) as Insight,
    model: row.model,
    created_at: row.created_at,
    cached: true,
  };
}

/**
 * Analyze a month. Returns the cached analysis when the numbers have not
 * changed since the last run, unless `force` is set.
 */
export async function analyzeMonth(month: string, force = false): Promise<InsightResult> {
  const payload = buildPayload(month);

  if (payload.spending === 0 && payload.income === 0) {
    throw new AIError(
      `No transactions in ${payload.month} yet — add some spending first.`,
      "no_data",
    );
  }

  if (!force) {
    const cached = getCachedInsight(month);
    if (cached) return cached;
  }

  const model = aiModel();
  const message = await anthropic().messages.create({
    model,
    max_tokens: 8000,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // Stable across every request, so it caches and later months are cheaper.
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: INSIGHT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Analyze this month's finances.\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  // Safety classifiers can decline a request; that arrives as a 200 with
  // stop_reason "refusal" and an empty content array, so check it before
  // reading content.
  if (message.stop_reason === "refusal") {
    throw new AIError(
      "The model declined to analyze this request. Nothing was charged.",
      "refused",
    );
  }

  const text = message.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new AIError("The model returned no analysis. Try again.", "api");
  }

  let insight: Insight;
  try {
    insight = JSON.parse(text.text) as Insight;
  } catch {
    throw new AIError("Could not parse the model's response as JSON.", "api");
  }

  db.prepare(
    "INSERT INTO insights (month, body, input_hash, model) VALUES (?, ?, ?, ?)",
  ).run(month, JSON.stringify(insight), hashPayload(payload), model);

  return {
    insight,
    model,
    created_at: new Date().toISOString(),
    cached: false,
  };
}

/** Turn an unknown thrown value into something worth showing a human. */
export function aiErrorMessage(error: unknown): string {
  if (error instanceof AIError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Anthropic API. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API. Check your connection.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error (${error.status}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Rough cost of one analysis, for the UI to show before you spend money. */
export function estimatedCostNote(): string {
  const model = aiModel();
  if (model.includes("haiku")) return "about $0.01 per analysis";
  if (model.includes("sonnet")) return "about $0.02 per analysis";
  return "about $0.03–0.05 per analysis";
}

export { formatCents };
