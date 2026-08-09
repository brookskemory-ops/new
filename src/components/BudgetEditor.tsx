"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BudgetMeter } from "@/components/Charts";
import { formatCents } from "@/lib/money";
import type { BudgetProgress, CategoryTotal, Category } from "@/lib/types";

export function BudgetEditor({
  month,
  monthProgress,
  budgets,
  categories,
  spending,
  suggestions,
}: {
  month: string;
  monthProgress: number;
  budgets: BudgetProgress[];
  categories: Category[];
  spending: CategoryTotal[];
  suggestions: Record<number, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  /** false = recurring default for every month; true = just this month. */
  const [thisMonthOnly, setThisMonthOnly] = useState(false);

  async function save(categoryId: number, amount: string) {
    setBusy(categoryId);
    try {
      await fetch("/api/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: categoryId,
          amount,
          month: thisMonthOnly ? month : "*",
        }),
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[categoryId];
        return next;
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const budgetByCategory = new Map(budgets.map((b) => [b.category_id, b]));
  const spentByCategory = new Map(
    spending.map((row) => [row.category_id ?? -1, row.total_cents]),
  );

  // Categories you actually spend in come first — the ones without a budget
  // are the whole point of this page.
  const ordered = [...categories].sort((a, b) => {
    const aHas = budgetByCategory.has(a.id) ? 1 : 0;
    const bHas = budgetByCategory.has(b.id) ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return (spentByCategory.get(b.id) ?? 0) - (spentByCategory.get(a.id) ?? 0);
  });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={thisMonthOnly}
          onChange={(event) => setThisMonthOnly(event.target.checked)}
        />
        Apply changes to this month only (otherwise they repeat every month)
      </label>

      <div className="card divide-y divide-border">
        {ordered.map((category) => {
          const budget = budgetByCategory.get(category.id);
          const spent = spentByCategory.get(category.id) ?? 0;
          const suggestion = suggestions[category.id];
          const draft =
            drafts[category.id] ??
            (budget ? (budget.budget_cents / 100).toFixed(2) : "");

          return (
            <div key={category.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-[12rem] flex-1">
                  {budget ? (
                    <BudgetMeter
                      label={category.name}
                      spentCents={budget.spent_cents}
                      budgetCents={budget.budget_cents}
                      monthProgress={monthProgress}
                    />
                  ) : (
                    <div className="py-2.5">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span
                          aria-hidden
                          className="h-2 w-2 rounded-full"
                          style={{ background: category.color }}
                        />
                        {category.name}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {spent > 0 ? (
                          <>
                            <span className="tnum">{formatCents(spent)}</span> spent
                            this month, no budget set
                          </>
                        ) : (
                          "No budget, no spending"
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {suggestion !== undefined && !budget && (
                    <button
                      type="button"
                      onClick={() => save(category.id, String(suggestion / 100))}
                      className="btn whitespace-nowrap text-xs"
                      disabled={busy === category.id}
                      title="Based on your median spending in this category"
                    >
                      Use {formatCents(suggestion)}
                    </button>
                  )}
                  <input
                    className="field tnum w-28"
                    placeholder="0.00"
                    inputMode="decimal"
                    value={draft}
                    onChange={(event) =>
                      setDrafts({ ...drafts, [category.id]: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") save(category.id, draft);
                    }}
                    aria-label={`Monthly budget for ${category.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => save(category.id, draft || "0")}
                    className="btn"
                    disabled={busy === category.id || drafts[category.id] === undefined}
                  >
                    {busy === category.id ? "…" : "Save"}
                  </button>
                </div>
              </div>

              {budget?.is_default === false && (
                <p className="mt-1 text-xs text-warn">
                  Overridden for this month only
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
