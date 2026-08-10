"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents, today } from "@/lib/money";
import type { Account } from "@/lib/types";

/**
 * Cash on hand.
 *
 * Cash is the spending people forget to record, so this asks for the least
 * possible: an amount and what it was for. Everything else — date, account,
 * category — is inferred. A form with six fields does not get filled in at a
 * coffee counter, and an unrecorded expense is worse than a roughly-recorded
 * one.
 */
export function CashCard({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const cashAccounts = accounts.filter((account) => account.type === "cash");

  const [accountId, setAccountId] = useState(String(cashAccounts[0]?.id ?? ""));
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = cashAccounts.find((account) => String(account.id) === accountId);
  const total = cashAccounts.reduce((sum, account) => sum + account.balance_cents, 0);

  async function spend(event: React.FormEvent) {
    event.preventDefault();
    if (!active) return;

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: active.id,
          amount,
          direction: "expense",
          date: today(),
          merchant: what,
          description: what,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not record that.");

      setMessage(`Recorded. ${active.name} is now lower by that amount.`);
      setAmount("");
      setWhat("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record that.");
    } finally {
      setBusy(false);
    }
  }

  async function addWallet() {
    const startingAmount = prompt(
      "How much cash do you have on hand right now?",
      "0.00",
    );
    if (startingAmount === null) return;

    setBusy(true);
    try {
      await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Cash", type: "cash", balance: startingAmount }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (cashAccounts.length === 0) {
    return (
      <section className="card p-4">
        <h2 className="section-title">Cash on hand</h2>
        <p className="mt-1 text-xs text-muted">
          Cash is the spending that goes unrecorded and quietly breaks every
          other total. Track a wallet and it stops being a blind spot.
        </p>
        <button
          type="button"
          onClick={addWallet}
          className="btn btn-primary mt-3"
          disabled={busy}
        >
          Track cash
        </button>
      </section>
    );
  }

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="section-title">Cash on hand</h2>
        <span className={`figure-lg text-lg ${total < 0 ? "text-negative" : ""}`}>
          {formatCents(total)}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted">
        Spend it here and the balance drops. Off by a bit?{" "}
        <strong className="text-text">Reconcile</strong> on the Accounts page.
      </p>

      <form onSubmit={spend} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            className="field tnum w-24"
            placeholder="12.00"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            aria-label="Amount of cash spent"
          />
          <input
            className="field flex-1"
            placeholder="What for?"
            value={what}
            onChange={(event) => setWhat(event.target.value)}
            required
            aria-label="What the cash was spent on"
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "…" : "Spend"}
          </button>
        </div>

        {cashAccounts.length > 1 && (
          <select
            className="field text-xs"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            aria-label="Which cash account"
          >
            {cashAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} — {formatCents(account.balance_cents)}
              </option>
            ))}
          </select>
        )}
      </form>

      {message && <p className="mt-2 text-xs text-positive">{message}</p>}
      {error && <p className="mt-2 text-xs text-negative">{error}</p>}

      {total < 0 && (
        <p className="mt-2 rounded-lg bg-warn-soft px-2 py-1.5 text-xs text-warn">
          This has gone negative, which means more was recorded than the wallet
          held. Reconcile it against what is actually there.
        </p>
      )}
    </section>
  );
}
