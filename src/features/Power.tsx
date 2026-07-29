/** Generator sizing and the factory that keeps them fed. */
import { useMemo, useState } from 'react'

import { Count, Empty, Field, NumberInput, Panel, Select, Stat, Warning, fmt } from '../components/ui'
import { gameData, itemName, machineName } from '../data/constants'
import { formatClock } from '../engine/clock'
import { planFuelChain } from '../engine/power'
import type { UnlockState } from '../state/useUnlocks'

export function Power({ unlocks }: { unlocks: UnlockState }) {
  const [generatorId, setGeneratorId] = useState('Desc_GeneratorCoal_C')
  const [fuel, setFuel] = useState('Desc_Coal_C')
  const [targetMW, setTargetMW] = useState(600)

  const generator =
    gameData.generators.find((g) => g.className === generatorId) ?? gameData.generators[0]!

  // Keep the fuel selection valid when the generator changes.
  const activeFuel = generator.fuel.includes(fuel) ? fuel : generator.fuel[0]!

  const chain = useMemo(
    () =>
      planFuelChain(generator, activeFuel, targetMW, {
        unlocked: unlocks.trackingDisabled ? undefined : unlocks.unlockedRecipes,
      }),
    [generator, activeFuel, targetMW, unlocks],
  )

  const { plan, production } = chain

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-4">
        <Panel title="Power plant">
          <div className="space-y-3">
            <Field label="Generator">
              <Select
                value={generatorId}
                onChange={setGeneratorId}
                options={gameData.generators.map((g) => ({
                  value: g.className,
                  label: `${g.name} — ${g.powerProduction} MW`,
                }))}
              />
            </Field>
            <Field label="Fuel">
              <Select
                value={activeFuel}
                onChange={setFuel}
                options={generator.fuel.map((f) => ({ value: f, label: itemName(f) }))}
              />
            </Field>
            <Field label="Target output" hint="megawatts">
              <NumberInput value={targetMW} onChange={setTargetMW} min={0} />
            </Field>
          </div>
        </Panel>

        <Panel title="Plant">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Generators" value={plan.count} />
            <Stat label="Clock" value={formatClock(plan.clock)} />
            <Stat label="Gross output" value={fmt(plan.power, 1)} unit="MW" />
            <Stat
              label="Net output"
              value={fmt(chain.netPower, 1)}
              unit="MW"
              tone={chain.netPower < plan.power ? 'warn' : 'good'}
            />
            <Stat label="Fuel" value={fmt(plan.fuelRate, 2)} unit="/min" />
            <Stat label="Water" value={fmt(chain.totalWater, 1)} unit="m³/min" />
          </div>

          {chain.factoryPower > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              The fuel factory draws {fmt(chain.factoryPower, 1)} MW, so this plant nets{' '}
              {fmt(chain.netPower, 1)} MW —{' '}
              {fmt((chain.factoryPower / plan.power) * 100, 1)}% goes to feeding itself.
            </p>
          )}
        </Panel>

        {plan.byproducts.length > 0 && (
          <Panel title="Waste" subtitle="Must be stored, sunk or reprocessed">
            <ul className="space-y-1 text-sm">
              {plan.byproducts.map((b) => (
                <li key={b.item} className="flex justify-between">
                  <span className="text-amber-300">{itemName(b.item)}</span>
                  <span className="tabular text-slate-200">{fmt(b.rate, 2)}/min</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title="Water extractors" subtitle="At 120 m³/min each">
          {chain.totalWater > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Extractors" value={Math.ceil(chain.totalWater / 120 - 1e-9)} />
              <Stat
                label="Each at"
                value={formatClock(
                  chain.totalWater / 120 / Math.max(1, Math.ceil(chain.totalWater / 120 - 1e-9)),
                )}
              />
            </div>
          ) : (
            <Empty>This generator needs no water.</Empty>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        {production?.warnings.map((warning) => <Warning key={warning}>{warning}</Warning>)}

        <Panel title="Fuel supply" subtitle={`What it takes to make ${fmt(plan.fuelRate, 2)} ${itemName(activeFuel)}/min`}>
          {production ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Machines"
                  value={Math.ceil(
                    [...production.machineCounts.values()].reduce((a, b) => a + b, 0) - 1e-9,
                  )}
                />
                <Stat label="Factory draw" value={fmt(production.totalPower, 1)} unit="MW" />
                <Stat
                  label="Raw resources"
                  value={fmt([...production.rawResources.values()].reduce((a, b) => a + b, 0), 1)}
                  unit="/min"
                />
                <Stat label="Recipes" value={production.steps.length} />
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase">
                  Raw resources
                </h3>
                <ul className="space-y-1 text-sm">
                  {[...production.rawResources]
                    .sort((a, b) => b[1] - a[1])
                    .map(([item, rate]) => (
                      <li key={item} className="flex justify-between">
                        <span className="text-slate-300">{itemName(item)}</span>
                        <span className="tabular text-slate-100">{fmt(rate, 2)}/min</span>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                      <th className="py-2 pr-3 font-medium">Recipe</th>
                      <th className="py-2 pr-3 font-medium">Machine</th>
                      <th className="py-2 pr-3 text-right font-medium">Count</th>
                      <th className="py-2 text-right font-medium">MW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {production.steps.map((step) => (
                      <tr key={step.recipe.className} className="border-b border-slate-800/50">
                        <td className="py-2 pr-3 text-slate-200">{step.recipe.name}</td>
                        <td className="py-2 pr-3 text-slate-400">
                          {machineName(step.recipe.machine)}
                        </td>
                        <td className="tabular py-2 pr-3 text-right text-slate-100">
                          <Count value={step.machines} />
                        </td>
                        <td className="tabular py-2 text-right text-slate-300">
                          {fmt(step.power, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {production.surplus.size > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase">
                    Byproducts to deal with
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {[...production.surplus]
                      .filter(([, rate]) => rate > 1e-6)
                      .map(([item, rate]) => (
                        <li key={item} className="flex justify-between">
                          <span className="text-amber-300">{itemName(item)}</span>
                          <span className="tabular text-slate-200">{fmt(rate, 2)}/min</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <Empty>
              {itemName(activeFuel)} comes straight from the map — just belt it in from a miner.
            </Empty>
          )}
        </Panel>

        <Panel title="All generators" subtitle="At 100% clock">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                  <th className="py-2 pr-3 font-medium">Generator</th>
                  <th className="py-2 pr-3 text-right font-medium">Output</th>
                  <th className="py-2 pr-3 text-right font-medium">Water</th>
                  <th className="py-2 font-medium">Fuels</th>
                </tr>
              </thead>
              <tbody>
                {gameData.generators.map((g) => (
                  <tr key={g.className} className="border-b border-slate-800/50">
                    <td className="py-2 pr-3 text-slate-200">{g.name}</td>
                    <td className="tabular py-2 pr-3 text-right text-slate-100">
                      {g.powerProduction} MW
                    </td>
                    <td className="tabular py-2 pr-3 text-right text-slate-300">
                      {g.waterToPowerRatio > 0
                        ? `${fmt(g.powerProduction * g.waterToPowerRatio * 0.06, 0)} m³/min`
                        : '—'}
                    </td>
                    <td className="py-2 text-xs text-slate-400">
                      {g.fuel.map((f) => itemName(f)).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
