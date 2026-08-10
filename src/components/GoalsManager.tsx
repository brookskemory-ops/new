"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents } from "@/lib/money";
import type { Goal } from "@/lib/types";

/**
 * Savings goals with an honest projection.
 *
 * The date is computed from what you have actually been saving — the median of
 * your positive months — not from a figure you typed once and stopped
 * believing. When the rate is zero the answer is "not at your current rate",
 * which is more useful than a date decades away or no answer at all.
 */
export function GoalsManager({
  goals,
  typicalMonthlySaving,
}: {
  goals: Goal[];
  typicalMonthlySaving: number;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, target, saved: saved || 0 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setName("");
      setTarget("");
      setSaved("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {typicalMonthlySaving > 0 ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          In a typical month you keep{" "}
          <strong className="tnum text-text">
            {formatCents(typicalMonthlySaving)}
          </strong>
          . Projections below use that figure.
        </p>
      ) : (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          You have not had a month where money left over yet, so there is no
          saving rate to project from. Goals will still track what you put in.
        </p>
      )}

      {goals.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              typicalMonthlySaving={typicalMonthlySaving}
            />
          ))}
        </div>
      )}

      <section className="card p-4">
        <h2 className="section-title mb-1">
          {goals.length === 0 ? "Set your first goal" : "Add a goal"}
        </h2>
        <p className="mb-3 text-xs text-muted">
          Starting a new job is the moment to set one. Three months of expenses
          is the usual first target.
        </p>

        <form onSubmit={create} className="flex flex-col gap-2">
          <input
            className="field"
            placeholder="What for — emergency fund, moving costs, a trip"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <div className="flex gap-2">
            <input
              className="field tnum flex-1"
              placeholder="Target amount"
              inputMode="decimal"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              required
            />
            <input
              className="field tnum flex-1"
              placeholder="Already saved (optional)"
              inputMode="decimal"
              value={saved}
              onChange={(event) => setSaved(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Add
            </button>
          </div>
          {error && <p className="text-xs text-negative">{error}</p>}
        </form>
      </section>
    </div>
  );
}

function GoalCard({
  goal,
  typicalMonthlySaving,
}: {
  goal: Goal;
  typicalMonthlySaving: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const remaining = Math.max(goal.target_cents - goal.saved_cents, 0);
  const pct = goal.target_cents > 0 ? (goal.saved_cents / goal.target_cents) * 100 : 0;
  const done = remaining === 0;

  const monthsNeeded =
    typicalMonthlySaving > 0 ? Math.ceil(remaining / typicalMonthlySaving) : null;
  const arrival =
    monthsNeeded !== null
      ? new Date(
          new Date().getFullYear(),
          new Date().getMonth() + monthsNeeded,
          1,
        ).toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : null;

  async function update(nextSaved: string) {
    setBusy(true);
    try {
      await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: goal.id, saved: nextSaved }),
      });
      setDraft("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete the goal "${goal.name}"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/goals?id=${goal.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`card p-4 ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="section-title min-w-0 truncate">{goal.name}</h3>
        <button
          type="button"
          onClick={remove}
          className="shrink-0 text-xs text-faint hover:text-negative"
        >
          Delete
        </button>
      </div>

      <div className="figure-lg mt-2 text-2xl">
        {formatCents(goal.saved_cents)}
        <span className="ml-1 text-sm font-normal text-faint">
          of {formatCents(goal.target_cents)}
        </span>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${done ? "bg-positive" : "bg-accent"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      <p className="mt-2 text-sm">
        {done ? (
          <span className="text-positive">Reached. Nice.</span>
        ) : arrival ? (
          <>
            <span className="tnum">{formatCents(remaining)}</span> to go —{" "}
            <strong>{arrival}</strong> at your current rate
            {monthsNeeded !== null && monthsNeeded > 1 && (
              <span className="text-faint"> ({monthsNeeded} months)</span>
            )}
          </>
        ) : (
          <>
            <span className="tnum">{formatCents(remaining)}</span> to go — no
            date yet, since nothing is being saved in a typical month
          </>
        )}
      </p>

      <div className="mt-3 flex gap-2">
        <input
          className="field tnum flex-1 py-1 text-xs"
          placeholder="Update saved amount"
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft) update(draft);
          }}
          aria-label={`Update amount saved for ${goal.name}`}
        />
        <button
          type="button"
          onClick={() => update(draft)}
          className="btn py-1 text-xs"
          disabled={busy || !draft}
        >
          Save
        </button>
      </div>
    </div>
  );
}
