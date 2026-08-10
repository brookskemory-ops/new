import Link from "next/link";
import { Suspense } from "react";
import { BudgetMeter, CategoryBars, StatTile, TrendChart } from "@/components/Charts";
import { MonthPicker } from "@/components/MonthPicker";
import { QuickAdd } from "@/components/QuickAdd";
import {
  currentMonth,
  formatCents,
  formatDateShort,
  formatMonth,
  monthProgress,
} from "@/lib/money";
import { buildForecast } from "@/lib/forecast";
import {
  budgetProgress,
  categoryTotals,
  countTransactions,
  listAccounts,
  listCategories,
  listTransactions,
  monthSummary,
  monthlyTrend,
  netWorthCents,
  recurringCharges,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? params.month!
    : currentMonth();

  const summary = monthSummary(month);
  const categories = categoryTotals(month);
  const budgets = budgetProgress(month);
  const trend = monthlyTrend(month, 6);
  const worth = netWorthCents();
  const recurring = recurringCharges(month);
  const recent = listTransactions({ month, limit: 8 });
  const accounts = listAccounts();
  const allCategories = listCategories();
  const needsReview = countTransactions({ month, uncategorizedOnly: true });
  // Only meaningful for the month in progress — "safe to spend" in a month
  // that already ended is a number about the past pretending to be advice.
  const forecast = month === currentMonth() ? buildForecast() : null;

  const progress = monthProgress(month);
  const recurringTotal = recurring.reduce((sum, row) => sum + row.avg_cents, 0);
  const overBudget = budgets.filter((budget) => budget.spent_cents > budget.budget_cents);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Dashboard</h1>
        <Suspense fallback={null}>
          <MonthPicker month={month} />
        </Suspense>
      </div>

      {summary.transaction_count === 0 && <EmptyState />}

      <section
        aria-label="This month at a glance"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatTile
          label="Money in"
          value={formatCents(summary.income_cents)}
          sub={formatMonth(month)}
          tone={summary.income_cents > 0 ? "positive" : "neutral"}
        />
        <StatTile
          label="Money out"
          value={formatCents(summary.spending_cents)}
          sub={`${summary.transaction_count} transactions`}
        />
        <StatTile
          label="Net"
          value={formatCents(summary.net_cents)}
          sub={summary.net_cents >= 0 ? "You kept money this month" : "You spent more than you earned"}
          tone={summary.net_cents >= 0 ? "positive" : "negative"}
        />
        {forecast ? (
          <StatTile
            label="Safe to spend"
            value={formatCents(forecast.safe_to_spend_cents)}
            sub={
              forecast.next_income
                ? `after committed bills, until ${formatDateShort(forecast.next_income.date)}`
                : "after committed bills"
            }
            tone={forecast.safe_to_spend_cents < 0 ? "negative" : "neutral"}
          />
        ) : (
        <StatTile
          label="Net worth"
          value={formatCents(worth.net)}
          sub={`${formatCents(worth.assets)} assets · ${formatCents(worth.liabilities)} owed`}
          tone={worth.net >= 0 ? "neutral" : "negative"}
        />
        )}
      </section>

      {(overBudget.length > 0 || needsReview > 0) && (
        <section className="flex flex-col gap-2">
          {overBudget.length > 0 && (
            <Banner tone="negative">
              Over budget in{" "}
              <strong>
                {overBudget.map((budget) => budget.category_name).join(", ")}
              </strong>
              . <Link href="/budgets" className="underline">Review budgets</Link>
            </Banner>
          )}
          {needsReview > 0 && (
            <Banner tone="warn">
              {needsReview} uncategorized{" "}
              {needsReview === 1 ? "transaction" : "transactions"} — they still
              count toward totals but not toward any budget.{" "}
              <Link
                href={`/transactions?month=${month}&uncategorized=1`}
                className="underline"
              >
                Categorize them
              </Link>
            </Banner>
          )}
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-4">
          <h2 className="section-title mb-1">Where the money went</h2>
          <p className="mb-4 text-xs text-muted">
            Top categories in {formatMonth(month)}. Transfers between your own
            accounts are excluded.
          </p>
          <CategoryBars
            data={categories.map((entry) => ({
              name: entry.name,
              total_cents: entry.total_cents,
              count: entry.count,
              color: entry.color,
            }))}
          />
        </section>

        <section className="card p-4">
          <h2 className="section-title mb-1">Add an expense</h2>
          <p className="mb-4 text-xs text-muted">
            It gets categorized automatically — you can correct it after.
          </p>
          <QuickAdd accounts={accounts} categories={allCategories} />
        </section>
      </div>

      <section className="card p-4">
        <h2 className="section-title mb-1">Last six months</h2>
        <p className="mb-4 text-xs text-muted">
          Money in against money out. Bars that cross mean a month you spent more
          than you earned.
        </p>
        <TrendChart data={trend} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Budgets</h2>
            <Link href="/budgets" className="text-xs text-accent hover:underline">
              Manage
            </Link>
          </div>
          {budgets.length === 0 ? (
            <p className="py-4 text-sm text-muted">
              No budgets set.{" "}
              <Link href="/budgets" className="text-accent hover:underline">
                Set your first one
              </Link>{" "}
              — the app can suggest amounts from what you already spend.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {budgets.slice(0, 6).map((budget) => (
                <BudgetMeter
                  key={budget.category_id}
                  label={budget.category_name}
                  spentCents={budget.spent_cents}
                  budgetCents={budget.budget_cents}
                  monthProgress={progress}
                />
              ))}
            </div>
          )}
        </section>

        <section className="card p-4">
          <h2 className="section-title mb-1">Recurring charges</h2>
          <p className="mb-3 text-xs text-muted">
            Charged in at least 3 of the last 4 months at a steady amount
            {recurringTotal > 0 && (
              <>
                {" "}— about{" "}
                <strong className="tnum text-text">
                  {formatCents(recurringTotal)}
                </strong>{" "}
                a month committed
              </>
            )}
            .
          </p>
          {recurring.length === 0 ? (
            <p className="py-4 text-sm text-muted">
              Nothing detected yet. This needs a few months of history.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {recurring.slice(0, 8).map((charge) => (
                <li
                  key={charge.merchant}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="truncate" title={charge.merchant}>
                    {charge.merchant}
                  </span>
                  <span className="tnum shrink-0 font-medium">
                    {formatCents(charge.avg_cents)}
                    <span className="ml-1 text-xs font-normal text-faint">/mo</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Recent activity</h2>
          <Link
            href={`/transactions?month=${month}`}
            className="text-xs text-accent hover:underline"
          >
            See all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="py-4 text-sm text-muted">
            Nothing recorded in {formatMonth(month)}.
          </p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {recent.map((tx) => (
              <li key={tx.id} className="flex items-center gap-3 py-2">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: tx.category_color ?? "var(--text-faint)" }}
                />
                <span className="w-12 shrink-0 text-xs text-faint">
                  {formatDateShort(tx.date)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {tx.merchant || tx.description || "—"}
                </span>
                <span className="hidden shrink-0 text-xs text-muted sm:inline">
                  {tx.category_name ?? "Uncategorized"}
                </span>
                <span
                  className={`tnum w-24 shrink-0 text-right font-medium ${
                    tx.amount_cents > 0 ? "text-positive" : ""
                  }`}
                >
                  {tx.amount_cents > 0 ? "+" : ""}
                  {formatCents(tx.amount_cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "negative" | "warn";
  children: React.ReactNode;
}) {
  const classes =
    tone === "negative"
      ? "bg-negative-soft text-negative"
      : "bg-warn-soft text-warn";
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${classes}`}>{children}</div>
  );
}

function EmptyState() {
  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold">Nothing here yet</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Three ways to get your finances in, fastest first:
      </p>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        <li>
          <strong>Import a CSV.</strong> Download the last few months from your
          bank&apos;s website and drop the file on the{" "}
          <Link href="/accounts" className="text-accent hover:underline">
            Accounts
          </Link>{" "}
          page. This gives you real history immediately.
        </li>
        <li>
          <strong>Link your bank.</strong> Once you add Plaid keys, transactions
          sync on their own. See the README for the five-minute setup.
        </li>
        <li>
          <strong>Add expenses by hand</strong> with the form on this page.
        </li>
      </ol>
      <p className="mt-3 text-xs text-faint">
        Want to see how it looks with data first? Run{" "}
        <code className="font-mono">npm run seed</code> for a realistic demo
        month, and <code className="font-mono">npm run reset</code> to clear it.
      </p>
    </section>
  );
}
