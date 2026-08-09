"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents, formatDateShort } from "@/lib/money";
import type { Category, TransactionView } from "@/lib/types";

/**
 * Editable transaction list.
 *
 * Recategorizing offers to save the merchant as a rule. That is how the
 * categorizer improves: you correct it once, and every future charge from that
 * merchant lands in the right place without you touching it.
 */
export function TransactionTable({
  transactions,
  categories,
}: {
  transactions: TransactionView[];
  categories: Category[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [ruleOffer, setRuleOffer] = useState<{
    id: number;
    merchant: string;
    categoryId: number;
    categoryName: string;
  } | null>(null);

  async function recategorize(tx: TransactionView, categoryId: number) {
    setBusyId(tx.id);
    try {
      await fetch(`/api/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: categoryId }),
      });

      const merchant = (tx.merchant || tx.description).trim();
      const category = categories.find((row) => row.id === categoryId);
      if (merchant.length >= 3 && category) {
        setRuleOffer({
          id: tx.id,
          merchant,
          categoryId,
          categoryName: category.name,
        });
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function saveRule() {
    if (!ruleOffer) return;
    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pattern: ruleOffer.merchant,
        category_id: ruleOffer.categoryId,
        apply_now: true,
      }),
    });
    setRuleOffer(null);
    router.refresh();
  }

  async function remove(id: number) {
    setBusyId(id);
    try {
      await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (transactions.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        No transactions match these filters.
      </div>
    );
  }

  return (
    <>
      {ruleOffer && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
          <span>
            Always file <strong>{ruleOffer.merchant}</strong> under{" "}
            <strong>{ruleOffer.categoryName}</strong>?
          </span>
          <button type="button" onClick={saveRule} className="btn btn-primary py-1">
            Yes, make it a rule
          </button>
          <button
            type="button"
            onClick={() => setRuleOffer(null)}
            className="btn py-1"
          >
            Just this one
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Merchant</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {transactions.map((tx) => (
              <tr
                key={tx.id}
                className={busyId === tx.id ? "opacity-50" : undefined}
              >
                <td className="whitespace-nowrap px-3 py-2 text-muted">
                  {formatDateShort(tx.date)}
                </td>
                <td className="max-w-[16rem] px-3 py-2">
                  <div className="truncate" title={tx.description || tx.merchant}>
                    {tx.merchant || tx.description || "—"}
                  </div>
                  <div className="flex gap-2 text-xs text-faint">
                    {tx.pending === 1 && <span>Pending</span>}
                    {tx.is_transfer === 1 && <span>Transfer</span>}
                    {tx.source !== "manual" && <span>{tx.source}</span>}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: tx.category_color ?? "var(--text-faint)",
                      }}
                    />
                    <select
                      className="field w-auto min-w-[9rem] py-1 text-xs"
                      value={tx.category_id ?? ""}
                      onChange={(event) =>
                        recategorize(tx, Number(event.target.value))
                      }
                      aria-label={`Category for ${tx.merchant || tx.description}`}
                    >
                      {tx.category_id === null && <option value="">—</option>}
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">
                  {tx.account_name}
                </td>
                <td
                  className={`tnum whitespace-nowrap px-3 py-2 text-right font-medium ${
                    tx.amount_cents > 0 ? "text-positive" : ""
                  }`}
                >
                  {tx.amount_cents > 0 ? "+" : ""}
                  {formatCents(tx.amount_cents)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => remove(tx.id)}
                    className="text-xs text-faint hover:text-negative"
                    aria-label={`Delete ${tx.merchant || tx.description}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
