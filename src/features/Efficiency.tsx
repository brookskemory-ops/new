/**
 * Clock speed, Somersloop and the 100%-uptime solver — the "stop my machines
 * idling" tab.
 */
import { useMemo, useState } from 'react'

import { Field, NumberInput, Panel, Select, Stat, Warning, fmt } from '../components/ui'
import { MAX_CLOCK, SOMERSLOOP_SLOTS, gameData, itemName, machineName } from '../data/constants'
import type { RecipeId } from '../data/types'
import {
  basePower,
  formatClock,
  inputPerMachine,
  outputPerMachine,
  powerAtClock,
  shardsForClock,
  solveEfficiency,
  somersloopMultiplier,
} from '../engine/clock'
import { recipesById } from '../data/constants'

type Mode = 'output' | 'input'

export function Efficiency() {
  const [recipeId, setRecipeId] = useState<RecipeId>('Recipe_IngotIron_C')
  const [mode, setMode] = useState<Mode>('output')
  const [rate, setRate] = useState(187.5)
  const [inputItem, setInputItem] = useState<string>('')
  const [clock, setClock] = useState(100)
  const [somersloops, setSomersloops] = useState(0)

  const recipe = recipesById.get(recipeId)!

  const recipeOptions = useMemo(
    () =>
      [...gameData.recipes]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => ({
          value: r.className,
          label: `${r.name}${r.alternate ? ' (alt)' : ''} — ${machineName(r.machine)}`,
        })),
    [],
  )

  // When sizing from an available input, convert that input rate into the output
  // rate it can sustain, then solve as normal.
  const ingredient =
    recipe.ingredients.find((i) => i.item === inputItem) ?? recipe.ingredients[0] ?? null

  const targetOutput = useMemo(() => {
    if (mode === 'output') return rate
    if (!ingredient) return 0
    const perMachineIn = inputPerMachine(recipe, ingredient.item)
    if (perMachineIn <= 0) return 0
    return (rate / perMachineIn) * outputPerMachine(recipe)
  }, [mode, rate, recipe, ingredient])

  const solution = useMemo(
    () => solveEfficiency(recipe, targetOutput),
    [recipe, targetOutput],
  )

  const base = basePower(recipe)
  const clockFraction = clock / 100
  const slots = SOMERSLOOP_SLOTS[recipe.machine] ?? 1
  const sloopMultiplier = somersloopMultiplier(somersloops, recipe.machine)
  const singlePower = powerAtClock(base, clockFraction, somersloops, recipe.machine)
  const singleOutput = outputPerMachine(recipe) * clockFraction * sloopMultiplier
  const shards = shardsForClock(clockFraction)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Uptime solver"
        subtitle="How many machines, and at what clock, to run at exactly 100% with nothing idling."
      >
        <div className="space-y-3">
          <Field label="Recipe">
            <Select value={recipeId} onChange={setRecipeId} options={recipeOptions} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Size by">
              <Select
                value={mode}
                onChange={(next) => setMode(next)}
                options={[
                  { value: 'output', label: 'Output I want' },
                  { value: 'input', label: 'Input I have' },
                ]}
              />
            </Field>
            <Field
              label={mode === 'output' ? 'Output rate' : 'Available input'}
              hint="per minute"
            >
              <NumberInput value={rate} onChange={setRate} />
            </Field>
          </div>

          {mode === 'input' && recipe.ingredients.length > 1 && (
            <Field label="Which input">
              <Select
                value={ingredient?.item ?? ''}
                onChange={setInputItem}
                options={recipe.ingredients.map((i) => ({
                  value: i.item,
                  label: itemName(i.item),
                }))}
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Output" value={fmt(targetOutput, 3)} unit="/min" />
            <Stat label="Machines needed" value={fmt(solution.exactMachines, 4)} />
          </div>

          {solution.warning && <Warning>{solution.warning}</Warning>}

          <div className="space-y-2">
            {solution.options.map((option) => (
              <div
                key={option.label}
                className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-slate-100">{option.label}</span>
                  <span className="tabular text-sm text-ficsit-400">
                    {fmt(option.power, 2)} MW
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {option.shards === null
                    ? 'Above the 250% limit'
                    : option.shards === 0
                      ? 'No power shards needed'
                      : `${option.shards} power shard${option.shards === 1 ? '' : 's'}`}
                  {option.lastClock !== undefined &&
                    ` · last machine at ${formatClock(option.lastClock)}`}
                </div>
              </div>
            ))}
          </div>

          {solution.options.length > 1 && (
            <p className="text-xs text-slate-500">
              Underclocking evenly always draws the least power — power scales with clock
              <span className="text-slate-400"> ^1.321929</span>, so two machines at 50% cost less
              than one at 100%.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Single machine" subtitle="What one machine does at a given clock and sloop count.">
        <div className="space-y-3">
          <Field label={`Clock speed — ${formatClock(clockFraction)}`}>
            <input
              type="range"
              min={1}
              max={250}
              step={0.5}
              value={clock}
              onChange={(event) => setClock(Number.parseFloat(event.target.value))}
              className="w-full accent-ficsit-500"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Clock %">
              <NumberInput value={clock} onChange={setClock} min={1} />
            </Field>
            <Field label={`Somersloops (max ${slots})`}>
              <NumberInput
                value={somersloops}
                onChange={(value) => setSomersloops(Math.max(0, Math.min(slots, Math.round(value))))}
                min={0}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Output" value={fmt(singleOutput, 3)} unit="/min" />
            <Stat
              label="Power draw"
              value={fmt(singlePower, 2)}
              unit="MW"
              tone={clockFraction > 1 ? 'warn' : 'good'}
            />
            <Stat
              label="Power shards"
              value={shards === null ? 'over 250%' : shards}
              tone={shards === null ? 'warn' : 'default'}
            />
            <Stat
              label="MW per item/min"
              value={singleOutput > 0 ? fmt(singlePower / singleOutput, 3) : '—'}
            />
          </div>

          {somersloops > 0 && (
            <p className="text-xs text-amber-400">
              {sloopMultiplier}× output for {fmt(Math.pow(sloopMultiplier, 2), 2)}× power. Sloops pay
              off when the input is scarce, not when power is.
            </p>
          )}

          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs">
            <div className="mb-2 font-medium text-slate-400">
              Per machine at {formatClock(clockFraction)}
            </div>
            <ul className="space-y-1">
              {recipe.ingredients.map((i) => (
                <li key={i.item} className="flex justify-between">
                  <span className="text-slate-400">in · {itemName(i.item)}</span>
                  <span className="tabular text-slate-200">
                    {fmt(inputPerMachine(recipe, i.item) * clockFraction, 3)}/min
                  </span>
                </li>
              ))}
              {recipe.products.map((p) => (
                <li key={p.item} className="flex justify-between">
                  <span className="text-slate-400">out · {itemName(p.item)}</span>
                  <span className="tabular text-emerald-300">
                    {fmt(outputPerMachine(recipe, p.item) * clockFraction * sloopMultiplier, 3)}/min
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <ShardTable base={base} machine={recipe.machine} />
        </div>
      </Panel>
    </div>
  )
}

function ShardTable({ base, machine }: { base: number; machine: string }) {
  const rows = [0.25, 0.5, 0.75, 1, 1.5, 2, MAX_CLOCK]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800 text-left text-slate-500">
            <th className="py-1.5 font-medium">Clock</th>
            <th className="py-1.5 text-right font-medium">Power</th>
            <th className="py-1.5 text-right font-medium">vs 100%</th>
            <th className="py-1.5 text-right font-medium">Shards</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const power = powerAtClock(base, c, 0, machine)
            return (
              <tr key={c} className="border-b border-slate-800/40">
                <td className="tabular py-1.5 text-slate-300">{formatClock(c)}</td>
                <td className="tabular py-1.5 text-right text-slate-200">{fmt(power, 2)} MW</td>
                <td
                  className={`tabular py-1.5 text-right ${
                    c > 1 ? 'text-amber-400' : c < 1 ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {c === 1 ? '—' : `${fmt((power / base - 1) * 100, 1)}%`}
                </td>
                <td className="tabular py-1.5 text-right text-slate-400">
                  {shardsForClock(c) ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
