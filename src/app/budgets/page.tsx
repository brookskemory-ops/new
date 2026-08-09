import { Suspense } from "react";
import { BudgetEditor } from "@/components/BudgetEditor";
import { MonthPicker } from "@/components/MonthPicker";
import { currentMonth, formatCents, monthProgress } from "@/lib/money";
import {
  budgetProgress,
  categoryTotals,
  listCategories,
  monthSummary,
  monthlyTrend,
} from "@/lib/queries";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Suggest a budget from history: the median of what you actually spent in that
 * category over the last six months. A budget you have never once hit is a
 * budget you will ignore, so the suggestion starts from reality.
 */
function suggestedBudgets(month: string): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT t.category_id AS id, substr(t.date, 1, 7) AS m, SUM(-t.amount_cents) AS total
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.amount_cents < 0
          AND t.is_transfer = 0
          AND (c.kind IS NULL OR c.kind != 'transfer')
          AND substr(t.date, 1, 7) <= ?
          AND t.category_id IS NOT NULL
        GROUP BY t.category_id, m`,
    )
    .all(month) as Array<{ id: number; m: string; total: number }>;

  const byCategory = new Map<number, number[]>();
  for (const row of rows) {
    const list = byCategory.get(row.id) ?? [];
    list.push(row.total);
    byCategory.set(row.id, list);
  }

  const suggestions = new Map<number, number>();
  for (const [id, totals] of byCategory) {
    const recent = totals.slice(-6).sort((a, b) => a - b);
    if (recent.length === 0) continue;
    const median = recent[Math.floor(recent.length / 2)];
    // Round to the nearest $5 — a budget of $237.14 is false precision.
    suggestions.set(id, Math.round(median / 500) * 500);
  }
  return suggestions;
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? params.month!
    : currentMonth();

  const budgets = budgetProgress(month);
  const categories = listCategories().filter(
    (category) => category.kind === "expense",
  );
  const spending = categoryTotals(month);
  const summary = monthSummary(month);
  const trend = monthlyTrend(month, 6);
  const suggestions = suggestedBudgets(month);

  const budgeted = budgets.reduce((sum, budget) => sum + budget.budget_cents, 0);
  const spentInBudgeted = budgets.reduce((sum, b) => sum + b.spent_cents, 0);
  const unbudgeted = summary.spending_cents - spentInBudgeted;

  // Median take-home over the months that had income — the sane basis for
  // "what can I actually commit to each month".
  const incomeMonths = trend
    .map((point) => point.income_cents)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const typicalIncome =
    incomeMonths.length > 0
      ? incomeMonths[Math.floor(incomeMonths.length / 2)]
      : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Budgets</h1>
          <p className="text-xs text-muted">
            A budget with no month set applies to every month. Set 0 to remove one.
          </p>
        </div>
        <Suspense fallback={null}>
          <MonthPicker month={month} />
        </Suspense>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <Summary label="Budgeted" value={formatCents(budgeted)} />
        <Summary
          label="Spent against budgets"
          value={formatCents(spentInBudgeted)}
        />
        <Summary
          label="Spending with no budget"
          value={formatCents(Math.max(unbudgeted, 0))}
          hint={
            unbudgeted > 0
              ? "Money leaving with nothing watching it"
              : "Everything is covered"
          }
        />
      </section>

      {typicalIncome > 0 && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          Your typical month brings in{" "}
          <strong className="tnum text-text">{formatCents(typicalIncome)}</strong>.
          A common split is 50% needs, 30% wants, 20% saved — that would be{" "}
          <span className="tnum">{formatCents(typicalIncome * 0.5)}</span>,{" "}
          <span className="tnum">{formatCents(typicalIncome * 0.3)}</span>, and{" "}
          <span className="tnum">{formatCents(typicalIncome * 0.2)}</span>. Treat
          it as a starting point, not a rule.
        </p>
      )}

      <BudgetEditor
        month={month}
        monthProgress={monthProgress(month)}
        budgets={budgets}
        categories={categories}
        spending={spending}
        suggestions={Object.fromEntries(suggestions)}
      />
    </div>
  );
}

function Summary({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-faint">
        {label}
      </div>
      <div className="tnum mt-1 text-xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
