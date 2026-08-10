"use client";

import { useState } from "react";
import type { Insight, InsightResult } from "@/lib/ai";

const SEVERITY: Record<string, { label: string; className: string }> = {
  info: { label: "Note", className: "bg-surface-2 text-muted" },
  watch: { label: "Watch", className: "bg-warn-soft text-warn" },
  urgent: { label: "Act on this", className: "bg-negative-soft text-negative" },
};

const DIFFICULTY: Record<string, string> = {
  easy: "Quick win",
  moderate: "Some effort",
  hard: "Bigger change",
};

export function InsightsPanel({
  month,
  configured,
  model,
  costNote,
  initial,
  hasData,
}: {
  month: string;
  configured: boolean;
  model: string;
  costNote: string;
  initial: InsightResult | null;
  hasData: boolean;
}) {
  const [result, setResult] = useState<InsightResult | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, force }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <section className="card p-5">
        <h2 className="text-base font-semibold">AI analysis is not set up yet</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Add an <code className="font-mono">ANTHROPIC_API_KEY</code> to your{" "}
          <code className="font-mono">.env</code> file and restart the dev server.
          You can get a key at{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            console.anthropic.com
          </a>
          . It is pay-as-you-go with no subscription — each analysis costs{" "}
          {costNote}, and results are cached so re-opening this page is free.
        </p>
        <p className="mt-3 text-sm text-muted">
          Everything else in the app works without this.
        </p>
      </section>
    );
  }

  if (!hasData) {
    return (
      <section className="card p-5 text-sm text-muted">
        There is nothing to analyze in this month yet. Add or import some
        transactions first.
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => analyze(result !== null)}
          className="btn btn-primary"
          disabled={busy}
        >
          {busy
            ? "Analyzing…"
            : result
              ? "Run a fresh analysis"
              : "Analyze this month"}
        </button>
        <span className="text-xs text-muted">
          {model} · {costNote}
          {result?.cached && " · showing a cached result, which cost nothing"}
        </span>
      </div>

      {error && (
        <p className="rounded-lg bg-negative-soft px-3 py-2 text-sm text-negative">
          {error}
        </p>
      )}

      {busy && !result && (
        <div className="card p-5 text-sm text-muted">
          Reading your numbers… this usually takes 10–30 seconds.
        </div>
      )}

      {result && <InsightBody insight={result.insight} />}
    </div>
  );
}

function InsightBody({ insight }: { insight: Insight }) {
  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <h2 className="text-lg font-semibold">{insight.headline}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{insight.summary}</p>
      </section>

      {insight.observations.length > 0 && (
        <section className="card p-5">
          <h3 className="section-title mb-3">What the numbers show</h3>
          <ul className="flex flex-col gap-3">
            {insight.observations.map((observation, index) => {
              const severity = SEVERITY[observation.severity] ?? SEVERITY.info;
              return (
                <li key={index} className="flex gap-3">
                  {/* The severity word carries the meaning; color only backs it up. */}
                  <span
                    className={`h-fit shrink-0 rounded px-1.5 py-0.5 text-[0.7rem] font-medium ${severity.className}`}
                  >
                    {severity.label}
                  </span>
                  <div>
                    <div className="text-sm font-medium">{observation.title}</div>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted">
                      {observation.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {insight.recommendations.length > 0 && (
        <section className="card p-5">
          <h3 className="section-title mb-3">What to do</h3>
          <ol className="flex flex-col gap-4">
            {insight.recommendations.map((recommendation, index) => (
              <li key={index} className="border-l-2 border-accent pl-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{recommendation.action}</span>
                  {recommendation.estimated_monthly_savings > 0 && (
                    <span className="tnum rounded bg-positive-soft px-1.5 py-0.5 text-xs font-medium text-positive">
                      ~${recommendation.estimated_monthly_savings}/mo
                    </span>
                  )}
                  <span className="text-xs text-faint">
                    {DIFFICULTY[recommendation.difficulty] ?? recommendation.difficulty}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {recommendation.rationale}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {insight.suggested_budgets.length > 0 && (
        <section className="card p-5">
          <h3 className="section-title mb-1">Suggested budgets</h3>
          <p className="mb-3 text-xs text-muted">
            Set any of these on the Budgets page.
          </p>
          <ul className="divide-y divide-border">
            {insight.suggested_budgets.map((budget, index) => (
              <li key={index} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{budget.category}</span>
                  <span className="tnum text-sm">${budget.monthly_amount}/mo</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{budget.reasoning}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-faint">
        Generated by a language model from your own numbers. It can be wrong, and
        it does not know anything about your life that is not in the data — treat
        it as a starting point for your own judgment, not advice.
      </p>
    </div>
  );
}
