"use client";

import { useId, useState } from "react";
import { formatCents, formatCentsShort } from "@/lib/money";

/**
 * Charts are hand-written inline SVG — no charting library.
 *
 * Three of them, each doing a different job:
 *   CategoryBars  — magnitude ranking across categories. ONE series, so one
 *                   hue; identity is carried by the row label, not by color.
 *   TrendChart    — two measures over six months. Two series, so a legend and
 *                   a hover tooltip; never a second y-axis.
 *   BudgetMeter   — a single value against a target, colored by status. Status
 *                   is always paired with a word, never signalled by color alone.
 */

/* ------------------------------------------------------------------ */
/* Category spending — horizontal bars                                 */
/* ------------------------------------------------------------------ */

export function CategoryBars({
  data,
  emptyMessage = "No spending recorded for this month yet.",
}: {
  data: Array<{ name: string; total_cents: number; count: number; color?: string }>;
  emptyMessage?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) {
    return <p className="py-6 text-sm text-muted">{emptyMessage}</p>;
  }

  const rows = data.slice(0, 10);
  const max = Math.max(...rows.map((row) => row.total_cents), 1);
  const total = data.reduce((sum, row) => sum + row.total_cents, 0);

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row, index) => {
        const pct = (row.total_cents / max) * 100;
        const share = total > 0 ? (row.total_cents / total) * 100 : 0;
        const active = hovered === index;

        return (
          <li
            key={row.name}
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered(null)}
            className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3"
          >
            <span className="flex min-w-0 items-center gap-2" title={row.name}>
              {/* The category's own color as a small marker. The bar stays one
                  hue because this is a single series ranked by size — color
                  here is identity, not magnitude. */}
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: row.color ?? "var(--series-spending)" }}
              />
              <span className="truncate text-sm text-muted">{row.name}</span>
            </span>

            {/* The track is the scale; the fill is the value. 4px rounded end
                on the data side only, so the bar stays anchored to zero. */}
            <span className="relative block h-5 rounded-md bg-surface-2">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px] bg-series-spending transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(pct, 1.5)}%` }}
              />
              {active && (
                <span className="pointer-events-none absolute -top-8 left-2 z-10 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-lg">
                  {share.toFixed(0)}% of spending · {row.count}{" "}
                  {row.count === 1 ? "transaction" : "transactions"}
                </span>
              )}
            </span>

            <span className="tnum text-sm font-medium">
              {formatCentsShort(row.total_cents)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Six-month trend — grouped bars, two series                          */
/* ------------------------------------------------------------------ */

interface TrendPoint {
  month: string;
  income_cents: number;
  spending_cents: number;
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const clipId = useId();

  if (data.length === 0) {
    return <p className="py-6 text-sm text-muted">Not enough history yet.</p>;
  }

  const WIDTH = 640;
  const HEIGHT = 220;
  const PAD = { top: 12, right: 8, bottom: 28, left: 52 };
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const max = Math.max(
    ...data.flatMap((point) => [point.income_cents, point.spending_cents]),
    1,
  );
  // Round the axis top up to a clean number so gridline labels aren't noise.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const axisMax = Math.ceil(max / step) * step;

  const groupW = plotW / data.length;
  const barW = Math.min(22, (groupW - 10) / 2);
  const y = (cents: number) => PAD.top + plotH - (cents / axisMax) * plotH;

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * axisMax);
  const active = hovered !== null ? data[hovered] : null;

  return (
    <figure className="m-0">
      {/* Two series, so identity never rests on color alone. */}
      <figcaption className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-sm bg-series-income"
          />
          Money in
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-sm bg-series-spending"
          />
          Money out
        </span>
      </figcaption>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          // No fixed height: the viewBox aspect ratio drives it, so the plot
          // fills the card's width instead of being letterboxed inside it.
          className="block w-full min-w-[520px]"
          role="img"
          aria-label={`Income and spending for the last ${data.length} months`}
        >
          <defs>
            {/* Clip keeps a rounded top from bleeding below the baseline on
                very short bars. */}
            <clipPath id={clipId}>
              <rect x="0" y="0" width={WIDTH} height={PAD.top + plotH} />
            </clipPath>
          </defs>

          {gridlines.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--series-grid)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={y(value) + 4}
                textAnchor="end"
                className="tnum"
                fontSize="10"
                fill="var(--text-faint)"
              >
                {value === 0 ? "0" : formatCentsShort(value)}
              </text>
            </g>
          ))}

          {data.map((point, index) => {
            const groupX = PAD.left + index * groupW;
            const center = groupX + groupW / 2;
            // 2px of surface between the paired bars so they read as two marks.
            const incomeX = center - barW - 1;
            const spendX = center + 1;
            const label = point.month.slice(5);

            return (
              <g
                key={point.month}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Invisible hit target spanning the full group height — a
                    hover target should be bigger than the mark. */}
                <rect
                  x={groupX}
                  y={PAD.top}
                  width={groupW}
                  height={plotH}
                  fill={hovered === index ? "var(--surface-2)" : "transparent"}
                />
                <g clipPath={`url(#${clipId})`}>
                  <rect
                    x={incomeX}
                    y={y(point.income_cents)}
                    width={barW}
                    height={Math.max(plotH - (y(point.income_cents) - PAD.top), 0)}
                    rx="4"
                    fill="var(--series-income)"
                  />
                  <rect
                    x={spendX}
                    y={y(point.spending_cents)}
                    width={barW}
                    height={Math.max(plotH - (y(point.spending_cents) - PAD.top), 0)}
                    rx="4"
                    fill="var(--series-spending)"
                  />
                </g>
                <text
                  x={center}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-faint)"
                >
                  {monthLabel(point.month)}
                </text>
                <title>{`${label}: in ${formatCents(point.income_cents)}, out ${formatCents(point.spending_cents)}`}</title>
              </g>
            );
          })}

          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--border)"
            strokeWidth="1"
          />
        </svg>

        {active && (
          <div className="pointer-events-none absolute right-2 top-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
            <div className="mb-1 font-medium">{monthLabel(active.month, true)}</div>
            <div className="tnum flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-sm bg-series-income" />
              In {formatCents(active.income_cents)}
            </div>
            <div className="tnum flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-sm bg-series-spending" />
              Out {formatCents(active.spending_cents)}
            </div>
            <div className="tnum mt-1 border-t border-border pt-1 text-muted">
              Net {formatCents(active.income_cents - active.spending_cents)}
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}

function monthLabel(month: string, long = false): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    year: long ? "numeric" : undefined,
  });
}

/* ------------------------------------------------------------------ */
/* Budget meter — one value against a target                           */
/* ------------------------------------------------------------------ */

export type BudgetStatus = "under" | "pace" | "ahead" | "over";

/**
 * Compare spend-to-date against how much of the month has elapsed, not against
 * the flat budget. Spending 60% of the grocery budget is fine on the 20th and a
 * problem on the 5th, and a meter that ignores that is worse than no meter.
 */
export function budgetStatus(ratio: number, monthProgress: number): BudgetStatus {
  if (ratio > 1) return "over";
  if (ratio > monthProgress + 0.15) return "ahead";
  if (ratio > monthProgress - 0.15) return "pace";
  return "under";
}

const STATUS_TEXT: Record<BudgetStatus, string> = {
  under: "Under pace",
  pace: "On track",
  ahead: "Spending fast",
  over: "Over budget",
};

const STATUS_CLASS: Record<BudgetStatus, { fill: string; text: string }> = {
  under: { fill: "bg-positive", text: "text-positive" },
  pace: { fill: "bg-positive", text: "text-positive" },
  ahead: { fill: "bg-warn", text: "text-warn" },
  over: { fill: "bg-negative", text: "text-negative" },
};

export function BudgetMeter({
  label,
  spentCents,
  budgetCents,
  monthProgress,
}: {
  label: string;
  spentCents: number;
  budgetCents: number;
  monthProgress: number;
}) {
  const ratio = budgetCents > 0 ? spentCents / budgetCents : 0;
  const status = budgetStatus(ratio, monthProgress);
  const styles = STATUS_CLASS[status];
  const remaining = budgetCents - spentCents;

  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{label}</span>
        <span className="tnum shrink-0 text-sm text-muted">
          {formatCents(spentCents)}{" "}
          <span className="text-faint">of {formatCents(budgetCents)}</span>
        </span>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${styles.fill} transition-[width] duration-300`}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
        {/* Where you *should* be by now, given the day of the month. */}
        {monthProgress > 0 && monthProgress < 1 && (
          <div
            className="absolute inset-y-0 w-px bg-text opacity-40"
            style={{ left: `${monthProgress * 100}%` }}
            title={`${Math.round(monthProgress * 100)}% of the month elapsed`}
          />
        )}
      </div>

      {/* Status is a word first; the color only reinforces it. */}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
        <span className={styles.text}>{STATUS_TEXT[status]}</span>
        <span className="tnum text-faint">
          {remaining >= 0
            ? `${formatCents(remaining)} left`
            : `${formatCents(-remaining)} over`}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI tiles — a number is the right "chart" for a single value        */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : "text-text";

  // A thin accent rail rather than a tinted card: it marks the tile's meaning
  // without washing the figure itself in color, which would fight the value.
  const railClass =
    tone === "positive"
      ? "bg-positive"
      : tone === "negative"
        ? "bg-negative"
        : "bg-border";

  return (
    <div className="card relative overflow-hidden p-4 pl-5">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${railClass}`} />
      <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-faint">
        {label}
      </div>
      <div className={`figure-lg mt-1.5 text-2xl ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs leading-snug text-muted">{sub}</div>}
    </div>
  );
}
