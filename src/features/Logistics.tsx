/** Belts, pipes, miners and splitter ratios. */
import { useMemo, useState } from 'react'

import { Field, NumberInput, Panel, Select, Stat, Warning, fmt } from '../components/ui'
import { BELTS, PIPES, itemName } from '../data/constants'
import type { Purity } from '../data/constants'
import { formatClock } from '../engine/clock'
import { liquidExtractors, minerOutput, planSplit, planThroughput, solidMiners } from '../engine/logistics'

export function Logistics() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ThroughputCard />
      <MinerCard />
      <SplitterCard />
      <ReferenceCard />
    </div>
  )
}

function ThroughputCard() {
  const [rate, setRate] = useState(780)
  const [liquid, setLiquid] = useState(false)

  const plan = useMemo(() => planThroughput(rate, liquid), [rate, liquid])

  return (
    <Panel title="Belt & pipe throughput" subtitle="How many lines a rate needs, and which tier.">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate" hint={liquid ? 'm³ per minute' : 'items per minute'}>
            <NumberInput value={rate} onChange={setRate} min={0} />
          </Field>
          <Field label="Carried by">
            <Select
              value={liquid ? 'pipe' : 'belt'}
              onChange={(value) => setLiquid(value === 'pipe')}
              options={[
                { value: 'belt', label: 'Belt (solids)' },
                { value: 'pipe', label: 'Pipe (fluids)' },
              ]}
            />
          </Field>
        </div>

        {plan.singleLine ? (
          <Stat
            label="Cheapest single line"
            value={`${liquid ? 'Pipeline' : 'Conveyor'} ${plan.singleLine.name}`}
            tone="good"
          />
        ) : (
          <Warning>
            No single {liquid ? 'pipe' : 'belt'} carries {fmt(rate)}/min — you need parallel lines.
          </Warning>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
              <th className="py-1.5 font-medium">Tier</th>
              <th className="py-1.5 text-right font-medium">Capacity</th>
              <th className="py-1.5 text-right font-medium">Lines</th>
              <th className="py-1.5 text-right font-medium">Utilisation</th>
            </tr>
          </thead>
          <tbody>
            {plan.perTier.map(({ tier, lines, utilisation }) => (
              <tr key={tier.name} className="border-b border-slate-800/40">
                <td className="py-1.5 text-slate-200">{tier.name}</td>
                <td className="tabular py-1.5 text-right text-slate-400">{tier.rate}/min</td>
                <td className="tabular py-1.5 text-right text-slate-100">{lines}</td>
                <td
                  className={`tabular py-1.5 text-right ${
                    utilisation > 0.9 ? 'text-emerald-400' : 'text-slate-400'
                  }`}
                >
                  {lines > 0 ? `${fmt(utilisation * 100, 1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function MinerCard() {
  const [minerId, setMinerId] = useState('Desc_MinerMk2_C')
  const [purity, setPurity] = useState<Purity>('normal')
  const [clock, setClock] = useState(100)

  const miners = [...solidMiners(), ...liquidExtractors()]
  const miner = miners.find((m) => m.className === minerId) ?? miners[0]!

  const output = useMemo(
    () => minerOutput(miner, purity, clock / 100),
    [miner, purity, clock],
  )

  return (
    <Panel title="Extractor output" subtitle="Node purity × miner tier × clock speed.">
      <div className="space-y-3">
        <Field label="Extractor">
          <Select
            value={miner.className}
            onChange={setMinerId}
            options={miners.map((m) => ({ value: m.className, label: m.name }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Node purity">
            <Select
              value={purity}
              onChange={(value) => setPurity(value)}
              options={[
                { value: 'impure', label: 'Impure (×0.5)' },
                { value: 'normal', label: 'Normal (×1)' },
                { value: 'pure', label: 'Pure (×2)' },
              ]}
            />
          </Field>
          <Field label="Clock %">
            <NumberInput value={clock} onChange={setClock} min={1} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Extraction"
            value={fmt(output.rate, 2)}
            unit={miner.allowLiquids ? 'm³/min' : '/min'}
          />
          <Stat label="Power" value={fmt(output.power, 2)} unit="MW" />
          <Stat
            label={miner.allowLiquids ? 'Pipe needed' : 'Belt needed'}
            value={output.belt?.name ?? 'over Mk.6'}
            tone={output.belt ? 'default' : 'warn'}
          />
          <Stat label="Clock" value={formatClock(clock / 100)} />
        </div>

        {output.overflow && <Warning>{output.overflow}</Warning>}

        <p className="text-xs text-slate-500">
          Extracts: {miner.allowedResources.length > 0
            ? miner.allowedResources.map((r) => itemName(r)).join(', ')
            : 'any solid ore node'}
        </p>
      </div>
    </Panel>
  )
}

function SplitterCard() {
  const [input, setInput] = useState(780)
  const [ways, setWays] = useState(4)

  const plan = useMemo(() => planSplit(input, Math.max(1, Math.round(ways))), [input, ways])

  return (
    <Panel title="Splitter ratios" subtitle="Dividing a line evenly between machines.">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Input rate" hint="per minute">
            <NumberInput value={input} onChange={setInput} min={0} />
          </Field>
          <Field label="Split into">
            <NumberInput value={ways} onChange={setWays} min={1} step={1} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Per output" value={fmt(plan.perOutput, 4)} unit="/min" />
          <Stat
            label="Clean split"
            value={plan.clean ? 'yes' : 'needs balancer'}
            tone={plan.clean ? 'good' : 'warn'}
          />
        </div>

        <p className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
          {plan.recipe}
        </p>

        <p className="text-xs text-slate-500">
          A manifold (chaining splitters in a line) works for any count and self-balances once the
          buffers fill — it just takes longer to start up.
        </p>
      </div>
    </Panel>
  )
}

function ReferenceCard() {
  return (
    <Panel title="Reference" subtitle="Throughput at a glance.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase">Conveyor belts</h3>
          <ul className="space-y-1 text-sm">
            {BELTS.map((belt) => (
              <li key={belt.name} className="flex justify-between">
                <span className="text-slate-300">{belt.name}</span>
                <span className="tabular text-slate-100">{belt.rate}/min</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase">Pipelines</h3>
          <ul className="space-y-1 text-sm">
            {PIPES.map((pipe) => (
              <li key={pipe.name} className="flex justify-between">
                <span className="text-slate-300">{pipe.name}</span>
                <span className="tabular text-slate-100">{pipe.rate} m³/min</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 mb-2 text-xs font-semibold text-slate-500 uppercase">Extractors</h3>
          <ul className="space-y-1 text-sm">
            {[...solidMiners(), ...liquidExtractors()].map((m) => (
              <li key={m.className} className="flex justify-between">
                <span className="text-slate-300">{m.name}</span>
                <span className="tabular text-slate-100">
                  {fmt(m.allowLiquids ? m.itemsPerMinute / 1000 : m.itemsPerMinute, 0)}
                  <span className="text-xs text-slate-500">
                    {m.allowLiquids ? ' m³/min' : '/min'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  )
}
