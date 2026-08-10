"use client";

import { useRef, useState } from "react";

interface Turn {
  role: "user" | "assistant";
  content: string;
  consulted?: string[];
}

/** Questions worth asking that a new user would not think to type. */
const SUGGESTIONS = [
  "What's my biggest avoidable expense?",
  "How much do I spend on coffee?",
  "Can I afford a $400 purchase this week?",
  "Am I spending more than I did three months ago?",
  "Which subscriptions should I cancel?",
];

/**
 * Ask questions about your own finances.
 *
 * Each answer is produced by Claude calling read-only tools against your
 * database, so it works from real figures rather than a summary. Which tools
 * were consulted is shown under each answer — an answer you cannot trace is
 * not worth much when it is about money.
 */
export function AskPanel({ configured }: { configured: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((current) => [...current, { role: "user", content: trimmed }]);
    setQuestion("");
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/insights/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setTurns((current) => [
        ...current,
        { role: "assistant", content: data.answer, consulted: data.consulted },
      ]);
      requestAnimationFrame(() =>
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not answer that.");
      // Drop the unanswered question rather than leaving it hanging in the
      // transcript as though it had been considered.
      setTurns((current) => current.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  if (!configured) return null;

  return (
    <section className="card p-4">
      <h2 className="section-title">Ask a question</h2>
      <p className="mb-3 text-xs text-muted">
        Answered by looking up your actual figures — not a guess from a summary.
        About a cent a question.
      </p>

      {turns.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => ask(suggestion)}
              className="btn py-1 text-xs"
              disabled={busy}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="mb-3 flex max-h-[26rem] flex-col gap-3 overflow-y-auto">
          {turns.map((turn, index) =>
            turn.role === "user" ? (
              <div key={index} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-white">
                  {turn.content}
                </p>
              </div>
            ) : (
              <div key={index} className="max-w-[92%]">
                <p className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm leading-relaxed">
                  {turn.content}
                </p>
                {turn.consulted && turn.consulted.length > 0 && (
                  <p className="mt-1 pl-1 text-[0.7rem] text-faint">
                    checked {turn.consulted.join(", ").replace(/_/g, " ")}
                  </p>
                )}
              </div>
            ),
          )}
          {busy && (
            <p className="pl-1 text-sm text-muted" role="status">
              Looking it up…
            </p>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && (
        <p className="mb-2 rounded-lg bg-negative-soft px-3 py-2 text-sm text-negative">
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
        className="flex gap-2"
      >
        <input
          className="field flex-1"
          placeholder="Ask about your spending…"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={busy}
          aria-label="Your question"
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || question.trim() === ""}
        >
          Ask
        </button>
      </form>

      {turns.length > 0 && (
        <button
          type="button"
          onClick={() => setTurns([])}
          className="mt-2 text-xs text-faint hover:text-muted"
        >
          Clear conversation
        </button>
      )}
    </section>
  );
}
