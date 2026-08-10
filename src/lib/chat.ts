import Anthropic from "@anthropic-ai/sdk";
import { aiModel, AIError, isAIConfigured } from "./ai";
import { db } from "./db";
import { addMonths, currentMonth, formatCents, formatMonth, monthRange } from "./money";
import { categoryTotals, monthSummary, monthlyTrend, topMerchants } from "./queries";
import { buildForecast, detectRecurring } from "./forecast";

/**
 * Ask-a-question chat over your own finances.
 *
 * The design point: rather than shipping the whole ledger to the model and
 * hoping, Claude is given a small set of read-only tools and fetches only what
 * a given question needs. "How much do I spend at Starbucks?" pulls one
 * merchant total; it never sees the rest. That keeps the same aggregates-only
 * posture as the Insights analysis, keeps each answer cheap, and means the
 * model works from real figures rather than from a summary that may not contain
 * the answer.
 *
 * Every tool returns aggregates. None of them return a transaction list, so
 * individual dates, amounts, and payees stay on the machine.
 */

const SYSTEM_PROMPT = `You answer questions about one person's finances using the tools provided. Today is ${new Date().toISOString().slice(0, 10)}.

Call a tool rather than guessing. If a question needs a number you have not fetched, fetch it. Several tools in one turn is fine.

Answer in one to three sentences unless asked for more. Lead with the number they asked for, then the context that makes it meaningful — a total alone rarely answers the real question, and "$312 on dining, up from $240 last month" is what they actually wanted to know.

Quote figures exactly as the tools return them. Never estimate a number you could fetch, and never present a projection as though it were settled fact.

If the tools genuinely cannot answer, say so plainly and say what would be needed. Do not fill the gap with plausible-sounding invention — a wrong number here costs real money.

Be direct about bad news. If they are overspending, say so in the first sentence rather than leading with reassurance. Skip disclaimers about consulting a professional unless the situation genuinely warrants one.

You have no knowledge of their life beyond these figures. Do not assume employment, family, or goals that the data does not show.`;

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const TOOLS: Anthropic.Tool[] = [
  {
    name: "month_summary",
    description:
      "Income, spending, net, and the needs/wants split for one month. Use for 'how did I do in July' or as context for any comparison.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM. Defaults to the current month." },
      },
      required: [],
    },
  },
  {
    name: "category_breakdown",
    description:
      "Spending per category for one month, largest first. Use for 'where did my money go' or any question about a specific category.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM. Defaults to the current month." },
      },
      required: [],
    },
  },
  {
    name: "merchant_spending",
    description:
      "Total spent at merchants whose name matches a search term, across a number of months. Use for 'how much do I spend at Starbucks' or 'what am I spending on coffee'.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of a merchant name, case-insensitive." },
        months: { type: "integer", description: "How many months back to include. Default 3." },
      },
      required: ["search"],
    },
  },
  {
    name: "monthly_trend",
    description:
      "Income and spending per month over the last N months. Use for 'am I spending more than I used to' or any trend question.",
    input_schema: {
      type: "object",
      properties: {
        months: { type: "integer", description: "How many months. Default 6, max 24." },
      },
      required: [],
    },
  },
  {
    name: "recurring_commitments",
    description:
      "Detected recurring bills and subscriptions with amounts and next due dates, plus any that recently increased in price.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cash_position",
    description:
      "What is available to spend now: balances, bills committed before the next paycheck, safe-to-spend, and the projected low point. Use for 'can I afford X' or 'how am I doing until payday'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "top_merchants",
    description: "The merchants you spent most at in a given month.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM. Defaults to the current month." },
        limit: { type: "integer", description: "How many to return. Default 10." },
      },
      required: [],
    },
  },
];

const dollars = (cents: number) => Math.round(cents / 100);
const validMonth = (value: unknown): string =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : currentMonth();

/** Execute one tool call. Returns a compact object for the model to read. */
export function runTool(name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case "month_summary": {
      const month = validMonth(input.month);
      const summary = monthSummary(month);
      return {
        month: formatMonth(month),
        income: dollars(summary.income_cents),
        spending: dollars(summary.spending_cents),
        net: dollars(summary.net_cents),
        needs: dollars(summary.buckets.need),
        wants: dollars(summary.buckets.want),
        transactions: summary.transaction_count,
      };
    }

    case "category_breakdown": {
      const month = validMonth(input.month);
      return {
        month: formatMonth(month),
        categories: categoryTotals(month).map((row) => ({
          category: row.name,
          spent: dollars(row.total_cents),
          transactions: row.count,
        })),
      };
    }

    case "merchant_spending": {
      const search = String(input.search ?? "").trim();
      if (!search) return { error: "A search term is required." };

      const months = Math.min(Math.max(Number(input.months) || 3, 1), 24);
      const since = `${addMonths(currentMonth(), -(months - 1))}-01`;

      const rows = db
        .prepare(
          `SELECT substr(t.date, 1, 7) AS month,
                  SUM(-t.amount_cents) AS total,
                  COUNT(*) AS count
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
            WHERE t.date >= ?
              AND t.amount_cents < 0
              AND t.is_transfer = 0
              AND (c.kind IS NULL OR c.kind != 'transfer')
              AND (lower(t.merchant) LIKE ? OR lower(t.description) LIKE ?)
            GROUP BY month
            ORDER BY month`,
        )
        .all(since, `%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`) as Array<{
        month: string;
        total: number;
        count: number;
      }>;

      const total = rows.reduce((sum, row) => sum + row.total, 0);
      return {
        search,
        months_covered: months,
        total_spent: dollars(total),
        average_per_month: rows.length ? dollars(Math.round(total / rows.length)) : 0,
        visits: rows.reduce((sum, row) => sum + row.count, 0),
        by_month: rows.map((row) => ({ month: row.month, spent: dollars(row.total) })),
      };
    }

    case "monthly_trend": {
      const months = Math.min(Math.max(Number(input.months) || 6, 2), 24);
      return {
        months: monthlyTrend(currentMonth(), months).map((entry) => ({
          month: entry.month,
          income: dollars(entry.income_cents),
          spending: dollars(entry.spending_cents),
          net: dollars(entry.net_cents),
        })),
      };
    }

    case "recurring_commitments": {
      const series = detectRecurring();
      return {
        commitments: series
          .filter((item) => item.direction === "out")
          .map((item) => ({
            merchant: item.merchant,
            amount: dollars(item.amount_cents),
            cadence: item.cadence,
            next_due: item.next_due,
            price_increase: item.price_increase
              ? {
                  from: dollars(item.price_increase.from_cents),
                  to: dollars(item.price_increase.to_cents),
                }
              : undefined,
          })),
      };
    }

    case "cash_position": {
      const forecast = buildForecast();
      return {
        available_now: dollars(forecast.starting_balance_cents),
        committed_before_next_income: dollars(forecast.committed_before_income_cents),
        safe_to_spend: dollars(forecast.safe_to_spend_cents),
        next_income: forecast.next_income
          ? {
              date: forecast.next_income.date,
              amount: dollars(forecast.next_income.amount_cents),
            }
          : null,
        typical_daily_spending: dollars(forecast.typical_daily_variable_cents),
        projected_low_point: {
          date: forecast.low_point.date,
          amount: dollars(forecast.low_point.balance_cents),
        },
        note: "Savings is excluded from available_now. Only detected recurring bills are counted as committed.",
      };
    }

    case "top_merchants": {
      const month = validMonth(input.month);
      const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 25);
      return {
        month: formatMonth(month),
        merchants: topMerchants(month, limit).map((row) => ({
          merchant: row.merchant,
          spent: dollars(row.total_cents),
          visits: row.count,
        })),
      };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}

/* ------------------------------------------------------------------ */
/* The conversation                                                    */
/* ------------------------------------------------------------------ */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatReply {
  answer: string;
  /** Which tools were consulted, so the answer is traceable to real figures. */
  consulted: string[];
}

let client: Anthropic | null = null;

/**
 * Answer one question, running the tool loop to completion.
 *
 * Capped iterations: a runaway loop here spends real money, and no legitimate
 * question about a month of spending needs more than a handful of lookups.
 */
export async function askQuestion(
  question: string,
  history: ChatTurn[] = [],
): Promise<ChatReply> {
  if (!isAIConfigured()) {
    throw new AIError(
      "Anthropic API key not set. Add ANTHROPIC_API_KEY to .env — see README.",
      "unconfigured",
    );
  }
  client ??= new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    // Keep the recent exchange so follow-ups like "what about last month?"
    // resolve, without resending an unbounded transcript.
    ...history.slice(-8).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user" as const, content: question },
  ];

  const consulted: string[] = [];
  const MAX_ITERATIONS = 6;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model: aiModel(),
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      throw new AIError("The model declined to answer that question.", "refused");
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0) {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      return {
        answer: text || "I could not work that out from your data.",
        consulted: [...new Set(consulted)],
      };
    }

    messages.push({ role: "assistant", content: response.content });

    // All results go back in ONE user message — splitting them trains the
    // model out of requesting tools in parallel.
    messages.push({
      role: "user",
      content: toolUses.map((toolUse) => {
        consulted.push(toolUse.name);
        let result: unknown;
        try {
          result = runTool(toolUse.name, (toolUse.input ?? {}) as Record<string, unknown>);
        } catch (error) {
          return {
            type: "tool_result" as const,
            tool_use_id: toolUse.id,
            content: `Lookup failed: ${error instanceof Error ? error.message : error}`,
            is_error: true,
          };
        }
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        };
      }),
    });
  }

  return {
    answer:
      "That took more lookups than expected and I stopped to avoid running up cost. Try asking something more specific.",
    consulted: [...new Set(consulted)],
  };
}

export { formatCents, monthRange };
