"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { today } from "@/lib/money";
import type { Account, Category } from "@/lib/types";

/** Manual expense entry — the fallback that always works, keys or no keys. */
export function QuickAdd({
  accounts,
  categories,
}: {
  accounts: Account[];
  categories: Category[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState(String(accounts[0]?.id ?? ""));
  const [categoryId, setCategoryId] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(
    null,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: Number(accountId),
          amount,
          direction,
          date,
          merchant,
          description: merchant,
          // Empty means "let the rules decide"; a pick locks the category.
          category_id: categoryId ? Number(categoryId) : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save that.");

      setAmount("");
      setMerchant("");
      setCategoryId("");
      setMessage({ text: "Saved.", error: false });
      router.refresh();
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Something went wrong.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add an account first on the Accounts page.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setDirection("expense")}
          aria-pressed={direction === "expense"}
          className={`btn flex-1 ${direction === "expense" ? "btn-primary" : ""}`}
        >
          Expense
        </button>
        <button
          type="button"
          onClick={() => setDirection("income")}
          aria-pressed={direction === "income"}
          className={`btn flex-1 ${direction === "income" ? "btn-primary" : ""}`}
        >
          Income
        </button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Amount
        <input
          className="field tnum"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="24.50"
          inputMode="decimal"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Merchant or description
        <input
          className="field"
          value={merchant}
          onChange={(event) => setMerchant(event.target.value)}
          placeholder="Trader Joe's"
          required
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Date
          <input
            type="date"
            className="field"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Account
          <select
            className="field"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Category
        <select
          className="field"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">Decide automatically</option>
          {categories
            .filter((category) => category.kind !== "transfer")
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </select>
      </label>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Saving…" : "Add transaction"}
      </button>

      {message && (
        <p
          role="status"
          className={`text-xs ${message.error ? "text-negative" : "text-positive"}`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
