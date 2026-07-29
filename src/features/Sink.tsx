/** AWESOME Sink economics: what is actually worth sinking for coupons. */
import { useMemo, useState } from 'react'

import { Field, NumberInput, Panel, Stat, fmt } from '../components/ui'
import { couponCost, minutesToNextCoupon, nextCouponCost, rankSinkables } from '../engine/sink'
import type { UnlockState } from '../state/useUnlocks'

export function Sink({ unlocks }: { unlocks: UnlockState }) {
  const [couponsClaimed, setCouponsClaimed] = useState(0)
  const [pointsPerMinute, setPointsPerMinute] = useState(1000)

  const rankings = useMemo(
    () => rankSinkables({ unlocked: unlocks.trackingDisabled ? undefined : unlocks.unlockedRecipes }, 40),
    [unlocks],
  )

  const minutes = minutesToNextCoupon(pointsPerMinute, couponsClaimed)

  // A window around where you actually are, rather than always coupons 1-10.
  const curve = useMemo(() => {
    const first = Math.max(1, couponsClaimed - 1)
    return Array.from({ length: 12 }, (_, i) => ({ n: first + i, cost: couponCost(first + i) }))
  }, [couponsClaimed])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-4">
        <Panel title="Coupons">
          <div className="space-y-3">
            <Field label="Coupons already claimed">
              <NumberInput
                value={couponsClaimed}
                onChange={(value) => setCouponsClaimed(Math.max(0, Math.round(value)))}
                step={1}
              />
            </Field>
            <Field label="Points per minute" hint="What your sink currently earns">
              <NumberInput value={pointsPerMinute} onChange={setPointsPerMinute} min={0} />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Stat label="Next coupon costs" value={fmt(nextCouponCost(couponsClaimed), 0)} />
              <Stat
                label="Time to earn"
                value={minutes === null ? '—' : formatMinutes(minutes)}
                tone={minutes !== null && minutes < 60 ? 'good' : 'default'}
              />
            </div>
          </div>
        </Panel>

        <Panel
          title="Coupon cost curve"
          subtitle="Coupons come in groups of three; the price climbs quadratically by group"
        >
          <ul className="space-y-1 text-sm">
            {curve.map(({ n, cost }) => (
              <li
                key={n}
                className={`flex justify-between ${
                  n === couponsClaimed + 1 ? 'text-ficsit-400' : 'text-slate-400'
                }`}
              >
                <span>Coupon {n}</span>
                <span className="tabular">{cost.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="What to sink"
        subtitle="Ranked by points earned per unit of raw ore spent — the number that matters when you are building a factory just to feed the sink."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 text-right font-medium">Points each</th>
                <th className="py-2 pr-3 text-right font-medium">Per raw unit</th>
                <th className="py-2 text-right font-medium">Per machine/min</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((row) => (
                <tr key={row.item.className} className="border-b border-slate-800/50">
                  <td className="py-2 pr-3 text-slate-200">{row.item.name}</td>
                  <td className="tabular py-2 pr-3 text-right text-slate-300">
                    {row.pointsPerUnit.toLocaleString()}
                  </td>
                  <td className="tabular py-2 pr-3 text-right text-emerald-400">
                    {row.pointsPerRawUnit === null ? '—' : fmt(row.pointsPerRawUnit, 0)}
                  </td>
                  <td className="tabular py-2 text-right text-slate-400">
                    {row.pointsPerMachineMinute > 0 ? fmt(row.pointsPerMachineMinute, 0) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${fmt(minutes, 1)} min`
  const hours = minutes / 60
  if (hours < 24) return `${fmt(hours, 1)} h`
  return `${fmt(hours / 24, 1)} days`
}
