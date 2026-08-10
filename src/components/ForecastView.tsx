"use client";

import { useState } from "react";
import { formatCents, formatCentsShort, formatDateShort } from "@/lib/money";
import type { Forecast, IncomeChange, RecurringSeries } from "@/lib/forecast";

/**
 * The forward-looking view.
 *
 * The headline is "safe to spend": what is left after everything already
 * committed before money next arrives. It is stated with its arithmetic
 * visible, because a number like this is only worth anything if you can see
 * where it came from and decide whether you believe it.
 */
export function ForecastView({
  forecast,
  savingsCents,
  series,
  incomeChange,
}: {
  forecast: Forecast;
  savingsCents: number;
  series: RecurringSeries[];
  incomeChange: IncomeChange;
}) {
  const safe = forecast.safe_to_spend_cents;
  const tight = safe < 0;
  const upcoming = series.filter((item) => item.direction === "out").slice(0, 12);
  const priceRises = series.filter((item) => item.price_increase);
  const monthlyCommitted = series
    .filter((item) => item.direction === "out")
    .reduce((sum, item) => {
      const perMonth =
        item.cadence === "monthly" ? 1 : item.cadence === "biweekly" ? 26 / 12 : 52 / 12;
      return sum + item.amount_cents * perMonth;
    }, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Headline */}
      <section className={`card p-5 ${tight ? "border-negative" : ""}`}>
        <div className="text-xs font-medium uppercase tracking-wide text-faint">
          Safe to spend
        </div>
        <div
          className={`tnum mt-1 text-4xl font-semibold ${tight ? "text-negative" : ""}`}
        >
          {formatCents(safe)}
        </div>

        <p className="mt-3 max-w-2xl text-sm text-muted">
          {forecast.next_income ? (
            <>
              You have{" "}
              <strong className="tnum text-text">
                {formatCents(forecast.starting_balance_cents)}
              </strong>{" "}
              in checking and cash.{" "}
              <strong className="tnum text-text">
                {formatCents(forecast.committed_before_income_cents)}
              </strong>{" "}
              of it is already spoken for before{" "}
              {formatDateShort(forecast.next_income.date)}, when{" "}
              <strong className="tnum text-text">
                {formatCents(forecast.next_income.amount_cents)}
              </strong>{" "}
              arrives from {forecast.next_income.merchant}.
            </>
          ) : (
            <>
              You have{" "}
              <strong className="tnum text-text">
                {formatCents(forecast.starting_balance_cents)}
              </strong>{" "}
              in checking and cash, with{" "}
              <strong className="tnum text-text">
                {formatCents(forecast.committed_before_income_cents)}
              </strong>{" "}
              committed in the next {forecast.horizon_days} days. No regular
              income detected yet — that needs a few months of history.
            </>
          )}
        </p>

        {tight && (
          <p className="mt-2 rounded-lg bg-negative-soft px-3 py-2 text-sm text-negative">
            Your committed bills exceed what is in checking. Something needs to
            move before the next payday.
          </p>
        )}

        <p className="mt-2 text-xs text-faint">
          Savings of {formatCents(savingsCents)} is excluded on purpose — it is
          money you decided not to spend. This figure counts only bills seen
          repeating, so it is what remains <em>before</em> you buy anything;
          the chart below adds your usual day-to-day spending on top.
        </p>
      </section>

      <BalanceProjection forecast={forecast} />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Upcoming */}
        <section className="card p-4">
          <h2 className="section-title">What is coming</h2>
          <p className="mb-3 text-xs text-muted">
            Detected commitments, soonest first — about{" "}
            <strong className="tnum text-text">
              {formatCents(Math.round(monthlyCommitted))}
            </strong>{" "}
            a month in total.
          </p>
          {upcoming.length === 0 ? (
            <p className="py-4 text-sm text-muted">
              Nothing detected yet. This needs about three months of history
              before a pattern is trustworthy.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {upcoming.map((item) => (
                <li
                  key={`${item.key}-${item.direction}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate" title={item.merchant}>
                      {item.merchant}
                    </div>
                    <div className="text-xs text-faint">
                      {formatDateShort(item.next_due)} · {item.cadence}
                    </div>
                  </div>
                  <span className="tnum shrink-0 font-medium">
                    {formatCents(item.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-5">
          <PriceRises items={priceRises} />
          <LifestyleCreep change={incomeChange} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Projected balance over the horizon.
 *
 * Two series, so a legend is present: what happens if you spend as you
 * usually do, against bills and income alone. The second is drawn dashed and
 * recessive because it is the reference, not the expectation — a line that only
 * ever slopes upward is true and misleading at the same time.
 *
 * The zero line is drawn only when the projection actually crosses it. A
 * permanent reference line at the bottom of every chart is noise; a line you
 * are about to cross is the whole point.
 */
function BalanceProjection({ forecast }: { forecast: Forecast }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const days = forecast.days;
  if (days.length === 0) return null;

  const WIDTH = 720;
  const HEIGHT = 180;
  const PAD = { top: 12, right: 12, bottom: 26, left: 58 };
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const values = days.flatMap((day) => [day.balance_cents, day.balance_with_typical_cents]);
  const min = Math.min(...values, forecast.starting_balance_cents, 0);
  const max = Math.max(...values, forecast.starting_balance_cents);
  const range = max - min || 1;

  const x = (index: number) => PAD.left + (index / (days.length - 1 || 1)) * plotW;
  const y = (cents: number) => PAD.top + plotH - ((cents - min) / range) * plotH;

  const line = days
    .map((day, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(day.balance_cents)}`)
    .join(" ");
  const typicalLine = days
    .map(
      (day, index) =>
        `${index === 0 ? "M" : "L"}${x(index)},${y(day.balance_with_typical_cents)}`,
    )
    .join(" ");
  const area = `${typicalLine} L${x(days.length - 1)},${y(min)} L${x(0)},${y(min)} Z`;

  const active = hovered !== null ? days[hovered] : null;
  const realisticLow = days.reduce(
    (lowest, day) =>
      day.balance_with_typical_cents < lowest.balance_with_typical_cents ? day : lowest,
    days[0],
  );
  const crossesZero = min < 0;

  return (
    <section className="card p-4">
      <h2 className="section-title">Projected balance</h2>
      <p className="mb-2 text-xs text-muted">
        Checking and cash over the next {forecast.horizon_days} days. Lowest
        realistic point:{" "}
        <strong
          className={`tnum ${realisticLow.balance_with_typical_cents < 0 ? "text-negative" : "text-text"}`}
        >
          {formatCents(realisticLow.balance_with_typical_cents)}
        </strong>{" "}
        on {formatDateShort(realisticLow.date)}.
      </p>

      {/* Two series, so identity never rests on color alone. */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 bg-series-spending" />
          If you spend as usual ({formatCents(forecast.typical_daily_variable_cents)}/day)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0.5 w-4"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, var(--text-faint) 0 4px, transparent 4px 7px)",
            }}
          />
          Bills and income only
        </span>
      </div>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block w-full min-w-[560px]"
          role="img"
          aria-label={`Projected balance over the next ${forecast.horizon_days} days`}
          onMouseLeave={() => setHovered(null)}
        >
          {[0, 0.5, 1].map((fraction) => {
            const value = min + fraction * range;
            return (
              <g key={fraction}>
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
                  {formatCentsShort(value)}
                </text>
              </g>
            );
          })}

          {crossesZero && (
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--negative)"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          )}

          <path d={area} fill="var(--series-spending)" opacity="0.12" />

          {/* Committed-only sits behind, dashed and recessive: it is the
              reference, not the expectation. */}
          <path
            d={line}
            fill="none"
            stroke="var(--text-faint)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />
          {/* The line you should actually read. */}
          <path
            d={typicalLine}
            fill="none"
            stroke="var(--series-spending)"
            strokeWidth="2"
            strokeLinejoin="round"
          />

          {/* A dot on days something actually happens — not on every point. */}
          {days.map((day, index) =>
            day.events.length > 0 ? (
              <circle
                key={day.date}
                cx={x(index)}
                cy={y(day.balance_with_typical_cents)}
                r="3.5"
                fill="var(--surface)"
                stroke="var(--series-spending)"
                strokeWidth="2"
              />
            ) : null,
          )}

          {/* Full-height hit strips: the hover target is bigger than the mark. */}
          {days.map((day, index) => (
            <rect
              key={`hit-${day.date}`}
              x={x(index) - plotW / days.length / 2}
              y={PAD.top}
              width={plotW / days.length}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHovered(index)}
            />
          ))}

          {hovered !== null && (
            <line
              x1={x(hovered)}
              x2={x(hovered)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--text-faint)"
              strokeWidth="1"
            />
          )}

          <text
            x={PAD.left}
            y={HEIGHT - 8}
            fontSize="10"
            fill="var(--text-faint)"
          >
            {formatDateShort(days[0].date)}
          </text>
          <text
            x={WIDTH - PAD.right}
            y={HEIGHT - 8}
            textAnchor="end"
            fontSize="10"
            fill="var(--text-faint)"
          >
            {formatDateShort(days[days.length - 1].date)}
          </text>
        </svg>

        {active && (
          <div className="pointer-events-none absolute right-2 top-0 max-w-[15rem] rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
            <div className="font-medium">{formatDateShort(active.date)}</div>
            <div className="tnum mt-0.5">
              {formatCents(active.balance_with_typical_cents)}
            </div>
            <div className="tnum text-faint">
              {formatCents(active.balance_cents)} without everyday spending
            </div>
            {active.events.map((event, index) => (
              <div key={index} className="tnum mt-0.5 text-muted">
                {event.direction === "in" ? "+" : "−"}
                {formatCents(event.amount_cents)} {event.merchant.slice(0, 22)}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function PriceRises({ items }: { items: RecurringSeries[] }) {
  const yearlyExtra = items.reduce((sum, item) => {
    const rise = item.price_increase!.to_cents - item.price_increase!.from_cents;
    const perYear =
      item.cadence === "monthly" ? 12 : item.cadence === "biweekly" ? 26 : 52;
    return sum + rise * perYear;
  }, 0);

  return (
    <section className="card p-4">
      <h2 className="section-title">Quiet price rises</h2>
      <p className="mb-3 text-xs text-muted">
        Recurring charges that went up without announcing themselves.
      </p>

      {items.length === 0 ? (
        <p className="py-2 text-sm text-muted">
          Nothing has crept up. This checks the latest charge against what the
          same merchant used to bill.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border text-sm">
            {items.map((item) => (
              <li key={item.key} className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate" title={item.merchant}>
                    {item.merchant}
                  </span>
                  <span className="tnum shrink-0 text-negative">
                    +
                    {formatCents(
                      item.price_increase!.to_cents - item.price_increase!.from_cents,
                    )}
                  </span>
                </div>
                <div className="tnum text-xs text-faint">
                  {formatCents(item.price_increase!.from_cents)} →{" "}
                  {formatCents(item.price_increase!.to_cents)} since{" "}
                  {formatDateShort(item.price_increase!.since)}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Costing you{" "}
            <strong className="tnum text-text">{formatCents(yearlyExtra)}</strong>{" "}
            more a year than before.
          </p>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function LifestyleCreep({ change }: { change: IncomeChange }) {
  if (!change.detected) {
    return (
      <section className="card p-4">
        <h2 className="section-title">Income change</h2>
        <p className="mt-2 text-sm text-muted">
          No step change in income detected yet. Once a few months either side of
          a pay change exist, this shows how much of the raise you actually kept.
        </p>
      </section>
    );
  }

  const absorbed = Math.round(change.absorbed_ratio * 100);
  const kept = change.income_change_cents - change.spending_change_cents;

  return (
    <section className="card p-4">
      <h2 className="section-title">What happened to your raise</h2>
      <p className="mb-3 text-xs text-muted">
        Comparing the {change.before.months} months before{" "}
        {change.change_month} with the {change.after.months} since.
      </p>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-faint">Income</dt>
          <dd className="tnum">
            {formatCentsShort(change.before.avg_income_cents)} →{" "}
            <strong>{formatCentsShort(change.after.avg_income_cents)}</strong>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Spending</dt>
          <dd className="tnum">
            {formatCentsShort(change.before.avg_spending_cents)} →{" "}
            <strong>{formatCentsShort(change.after.avg_spending_cents)}</strong>
          </dd>
        </div>
      </dl>

      <div className="mt-3">
        {/* Two segments of one bar: what you kept, and what spending absorbed. */}
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="bg-positive"
            style={{ width: `${Math.max(0, Math.min(100, 100 - absorbed))}%` }}
          />
          <div
            className="ml-0.5 bg-warn"
            style={{ width: `${Math.max(0, Math.min(100, absorbed))}%` }}
          />
        </div>
        <p className="mt-2 text-sm">
          You kept{" "}
          <strong className="tnum text-positive">{formatCents(kept)}</strong> a
          month of the{" "}
          <strong className="tnum">
            {formatCents(change.income_change_cents)}
          </strong>{" "}
          increase.{" "}
          {absorbed <= 0 ? (
            <>Spending actually fell — all of it is yours.</>
          ) : absorbed < 40 ? (
            <>Only {absorbed}% went to higher spending, which is a good result.</>
          ) : absorbed < 80 ? (
            <>{absorbed}% went straight back out as higher spending.</>
          ) : (
            <>
              {absorbed}% of it vanished into higher spending — the raise has
              barely reached you.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
