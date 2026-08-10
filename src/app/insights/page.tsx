import { Suspense } from "react";
import { AskPanel } from "@/components/AskPanel";
import { InsightsPanel } from "@/components/InsightsPanel";
import { MonthPicker } from "@/components/MonthPicker";
import { estimatedCostNote, getCachedInsight, isAIConfigured, aiModel } from "@/lib/ai";
import { currentMonth } from "@/lib/money";
import { monthSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? params.month!
    : currentMonth();

  const configured = isAIConfigured();
  const summary = monthSummary(month);
  // Reading a cached analysis costs nothing, so the page can render one
  // immediately without an API call.
  const cached = configured ? getCachedInsight(month) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Insights</h1>
          <p className="text-xs text-muted">
            Claude reads your monthly totals and tells you what to do about them.
          </p>
        </div>
        <Suspense fallback={null}>
          <MonthPicker month={month} />
        </Suspense>
      </div>

      <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        <strong className="text-text">What gets sent:</strong> category totals,
        budget variance, recurring charge amounts, and your six-month trend.
        Individual transactions, dates, account numbers, and your name never
        leave this machine.
      </div>

      <AskPanel configured={configured} />

      <InsightsPanel
        month={month}
        configured={configured}
        model={aiModel()}
        costNote={estimatedCostNote()}
        initial={cached}
        hasData={summary.transaction_count > 0}
      />
    </div>
  );
}
