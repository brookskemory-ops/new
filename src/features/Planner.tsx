/** Factory planner: target item and rate in, full production chain out. */
import { useMemo, useState } from 'react'

import { ItemPicker } from '../components/ItemPicker'
import { Button, Count, Empty, Field, NumberInput, Panel, Stat, Warning, fmt } from '../components/ui'
import { itemName, machineName } from '../data/constants'
import type { ItemId, RecipeId } from '../data/types'
import { formatClock, solveEfficiency } from '../engine/clock'
import { isLiquid, planThroughput } from '../engine/logistics'
import { availableRecipes, solve, suggestAlternates } from '../engine/solve'
import type { TreeNode } from '../engine/solve'
import type { UnlockState } from '../state/useUnlocks'
import { usePlan } from '../state/usePlan'

export function Planner({ unlocks }: { unlocks: UnlockState }) {
  const plan = usePlan()
  const { target, rate, creditByproducts, respectUnlocks } = plan
  const [copied, setCopied] = useState(false)

  const imported = useMemo(() => new Set(plan.imported), [plan.imported])

  const options = useMemo(
    () => ({
      recipeChoices: plan.recipeChoices,
      imported,
      creditByproducts,
      // With nothing ticked, unlock tracking would block every recipe, so it
      // stays off until the player has recorded some progress.
      unlocked:
        respectUnlocks && !unlocks.trackingDisabled ? unlocks.unlockedRecipes : undefined,
    }),
    [plan.recipeChoices, imported, creditByproducts, respectUnlocks, unlocks],
  )

  const result = useMemo(() => solve(target, rate, options), [target, rate, options])

  const suggestions = useMemo(() => suggestAlternates(result, options).slice(0, 5), [result, options])

  const toggleImport = plan.toggleImport

  const setRecipe = (item: ItemId, recipe: RecipeId): void => {
    // Storing a choice that matches the default would only bloat the share link.
    const auto = availableRecipes(item, options.unlocked)[0]
    plan.setRecipe(item, recipe === auto?.className ? null : recipe)
  }

  const share = async (): Promise<void> => {
    const url = plan.shareUrl()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be blocked; the URL bar already holds the same link.
      window.prompt('Copy this link:', url)
    }
  }

  const totalRaw = [...result.rawResources.values()].reduce((a, b) => a + b, 0)
  const totalMachines = [...result.machineCounts.values()].reduce((a, b) => a + b, 0)

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-4">
        <Panel title="Target">
          <div className="space-y-3">
            <Field label="Item">
              <ItemPicker value={target} onChange={(item) => plan.set('target', item)} />
            </Field>
            <Field label="Rate" hint={isLiquid(target) ? 'cubic metres per minute' : 'items per minute'}>
              <NumberInput value={rate} onChange={(value) => plan.set('rate', value)} min={0} />
            </Field>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="accent-ficsit-500"
                checked={creditByproducts}
                onChange={(e) => plan.set('creditByproducts', e.target.checked)}
              />
              Feed byproducts back in
            </label>
            <p className="-mt-2 text-xs text-slate-500">
              Subtracts byproducts from demand elsewhere instead of listing them as surplus.
            </p>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="accent-ficsit-500"
                checked={respectUnlocks}
                onChange={(e) => plan.set('respectUnlocks', e.target.checked)}
                disabled={unlocks.trackingDisabled}
              />
              Only use what I have unlocked
            </label>
            {unlocks.trackingDisabled && (
              <p className="-mt-2 text-xs text-slate-500">
                Nothing ticked on the Unlocks tab yet, so every recipe is in play.
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button variant="primary" onClick={share}>
                {copied ? 'Link copied' : 'Copy share link'}
              </Button>
              <Button variant="ghost" onClick={plan.reset}>
                Reset
              </Button>
            </div>
            <p className="-mt-2 text-xs text-slate-500">
              Your plan is saved here and lives in the URL, so you can bookmark it or send it on.
            </p>
          </div>
        </Panel>

        <Panel title="Totals">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Machines" value={fmt(totalMachines, 2)} />
            <Stat label="Power" value={fmt(result.totalPower, 1)} unit="MW" />
            <Stat label="Raw resources" value={fmt(totalRaw, 1)} unit="/min" />
            <Stat label="Recipes" value={result.steps.length} />
          </div>
        </Panel>

        <Panel title="Raw resources" subtitle="What the map has to supply">
          <RateList entries={result.rawResources} />
        </Panel>

        {result.imports.size > 0 && (
          <Panel title="Imported" subtitle="Shipped in from another factory">
            <RateList entries={result.imports} />
          </Panel>
        )}

        {result.surplus.size > 0 && (
          <Panel title="Surplus" subtitle="Byproducts you must sink or store">
            <RateList entries={result.surplus} />
          </Panel>
        )}

        <Panel title="Machines">
          <ul className="space-y-1 text-sm">
            {[...result.machineCounts]
              .sort((a, b) => b[1] - a[1])
              .map(([machine, count]) => (
                <li key={machine} className="flex justify-between">
                  <span className="text-slate-300">{machineName(machine)}</span>
                  <span className="tabular text-slate-100">
                    <Count value={count} />
                  </span>
                </li>
              ))}
          </ul>
        </Panel>
      </div>

      <div className="space-y-4">
        {result.warnings.map((warning) => (
          <Warning key={warning}>{warning}</Warning>
        ))}

        <Panel
          title="Production chain"
          subtitle="Each row is one step. Machine counts are exact — see the Efficiency tab for clock speeds."
        >
          {result.tree.recipe || result.tree.leafReason ? (
            <TreeView
              node={result.tree}
              options={options}
              onSetRecipe={setRecipe}
              onToggleImport={toggleImport}
              imported={imported}
            />
          ) : (
            <Empty>Nothing to build — pick a target item.</Empty>
          )}
        </Panel>

        <Panel title="Steps" subtitle="Aggregated across the whole chain">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                  <th className="py-2 pr-3 font-medium">Recipe</th>
                  <th className="py-2 pr-3 font-medium">Machine</th>
                  <th className="py-2 pr-3 text-right font-medium">Count</th>
                  <th className="py-2 pr-3 text-right font-medium">Output/min</th>
                  <th className="py-2 text-right font-medium">MW</th>
                </tr>
              </thead>
              <tbody>
                {result.steps.map((step) => (
                  <tr key={step.recipe.className} className="border-b border-slate-800/50">
                    <td className="py-2 pr-3">
                      <span className="text-slate-200">{step.recipe.name}</span>
                      {step.recipe.alternate && (
                        <span className="ml-2 rounded bg-sky-950 px-1.5 py-0.5 text-xs text-sky-300">
                          alt
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-400">{machineName(step.recipe.machine)}</td>
                    <td className="tabular py-2 pr-3 text-right text-slate-100">
                      <Count value={step.machines} />
                    </td>
                    <td className="tabular py-2 pr-3 text-right text-slate-300">
                      {fmt(step.outputRate, 2)}
                    </td>
                    <td className="tabular py-2 text-right text-slate-300">{fmt(step.power, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {suggestions.length > 0 && (
          <Panel
            title="Alternates worth chasing"
            subtitle="Hard drive recipes that would cut this plan's total raw resource intake, counting every ore and fluid together"
          >
            <ul className="space-y-2 text-sm">
              {suggestions.map((suggestion) => (
                <li
                  key={suggestion.recipe.className}
                  className="flex items-center justify-between gap-3 rounded border border-slate-800 px-3 py-2"
                >
                  <div>
                    <div className="text-slate-200">{suggestion.recipe.name}</div>
                    <div className="text-xs text-slate-500">for {itemName(suggestion.item)}</div>
                  </div>
                  <div className="text-right">
                    <div className="tabular text-emerald-400">
                      {fmt(suggestion.rawChange, 1)}% raw
                    </div>
                    <div
                      className={`tabular text-xs ${
                        suggestion.powerChange > 0 ? 'text-amber-400' : 'text-slate-500'
                      }`}
                    >
                      {suggestion.powerChange > 0 ? '+' : ''}
                      {fmt(suggestion.powerChange, 1)}% power
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  )
}

function RateList({ entries }: { entries: ReadonlyMap<ItemId, number> }) {
  const sorted = [...entries].filter(([, rate]) => rate > 1e-6).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return <Empty>None</Empty>

  return (
    <ul className="space-y-1 text-sm">
      {sorted.map(([item, rate]) => {
        const belt = planThroughput(rate, isLiquid(item))
        return (
          <li key={item} className="flex items-baseline justify-between gap-2">
            <span className="text-slate-300">{itemName(item)}</span>
            <span className="text-right">
              <span className="tabular text-slate-100">{fmt(rate, 2)}</span>
              <span className="ml-1 text-xs text-slate-500">
                /min
                {belt.singleLine && ` · ${isLiquid(item) ? 'pipe' : 'belt'} ${belt.singleLine.name}`}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function TreeView({
  node,
  options,
  onSetRecipe,
  onToggleImport,
  imported,
}: {
  node: TreeNode
  options: Parameters<typeof solve>[2]
  onSetRecipe: (item: ItemId, recipe: RecipeId) => void
  onToggleImport: (item: ItemId) => void
  imported: ReadonlySet<ItemId>
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const toggle = (key: string): void => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsed(next)
  }

  const render = (current: TreeNode, key: string): React.ReactNode => {
    const hasChildren = current.children.length > 0
    const isCollapsed = collapsed.has(key)
    const alternatives = current.recipe ? availableRecipes(current.item, options?.unlocked) : []
    const efficiency =
      current.recipe && current.machines > 0
        ? solveEfficiency(current.recipe, current.rate, current.item)
        : null

    return (
      <li key={key} className="relative">
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-1.5 hover:bg-slate-800/40"
          style={{ marginLeft: current.depth * 16 }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="w-4 shrink-0 text-slate-500 hover:text-slate-200"
              onClick={() => toggle(key)}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          <span className="font-medium text-slate-100">{itemName(current.item)}</span>
          <span className="tabular text-ficsit-400">{fmt(current.rate, 2)}/min</span>

          {current.creditedRate !== undefined && (
            <span
              className="tabular text-xs text-emerald-400"
              title={`This branch consumes ${fmt(current.grossRate ?? 0, 2)}/min, of which ${fmt(current.creditedRate, 2)}/min comes from a byproduct elsewhere in the plan.`}
            >
              ({fmt(current.grossRate ?? 0, 2)} − {fmt(current.creditedRate, 2)} from byproduct)
            </span>
          )}

          {current.recipe && (
            <>
              <span className="tabular text-xs text-slate-400">
                {Math.ceil(current.machines - 1e-9)}&times; {machineName(current.recipe.machine)}
                {efficiency && efficiency.options[0] && (
                  <span className="ml-1 text-slate-500">
                    @ {formatClock(efficiency.options[0].clock)}
                  </span>
                )}
              </span>
              <span className="tabular text-xs text-slate-500">{fmt(current.power, 1)} MW</span>
            </>
          )}

          {current.leafReason === 'raw' && (
            <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-xs text-emerald-400">raw</span>
          )}
          {current.leafReason === 'imported' && (
            <span className="rounded bg-sky-950 px-1.5 py-0.5 text-xs text-sky-300">imported</span>
          )}
          {current.leafReason === 'cycle' && (
            <span className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-400">loop</span>
          )}
          {current.leafReason === 'no-recipe' && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
              no recipe
            </span>
          )}

          {alternatives.length > 1 && current.recipe && (
            <select
              className="ml-auto max-w-[16rem] rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300"
              value={current.recipe.className}
              onChange={(event) => onSetRecipe(current.item, event.target.value)}
            >
              {alternatives.map((recipe) => (
                <option key={recipe.className} value={recipe.className}>
                  {recipe.name}
                  {recipe.alternate ? ' (alt)' : ''}
                </option>
              ))}
            </select>
          )}

          {current.leafReason !== 'raw' && (
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-sky-300"
              onClick={() => onToggleImport(current.item)}
              title="Treat this item as shipped in from another factory"
            >
              {imported.has(current.item) ? 'produce here' : 'import'}
            </button>
          )}
        </div>

        {current.byproducts.length > 0 && (
          <div
            className="px-2 text-xs text-slate-500"
            style={{ marginLeft: current.depth * 16 + 24 }}
          >
            byproduct:{' '}
            {current.byproducts
              .map((b) => `${itemName(b.item)} ${fmt(b.rate, 2)}/min`)
              .join(', ')}
          </div>
        )}

        {hasChildren && !isCollapsed && (
          <ul>{current.children.map((child, index) => render(child, `${key}.${index}`))}</ul>
        )}
      </li>
    )
  }

  return <ul className="text-sm">{render(node, 'root')}</ul>
}
