/** Factory planner: target item and rate in, full production chain out. */
import { useMemo, useState } from 'react'

import { ItemPicker } from '../components/ItemPicker'
import {
  Button,
  Callout,
  Count,
  Empty,
  Field,
  NumberInput,
  Panel,
  Select,
  Stat,
  Warning,
  fmt,
} from '../components/ui'
import { BELTS, itemName, machineName } from '../data/constants'
import type { ItemId, RecipeId } from '../data/types'
import { formatClock, solveEfficiency } from '../engine/clock'
import { beltFor, describeBelt, isLiquid } from '../engine/logistics'
import { availableRecipes, solve, suggestAlternates } from '../engine/solve'
import type { TreeNode } from '../engine/solve'
import type { UnlockState } from '../state/useUnlocks'
import { usePlan } from '../state/usePlan'

const WELCOME_KEY = 'satisfactory-companion:welcomed'

export function Planner({ unlocks, onGoTo }: { unlocks: UnlockState; onGoTo: (tab: string) => void }) {
  const plan = usePlan()
  const [welcomed, setWelcomed] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) === 'yes'
    } catch {
      return false
    }
  })

  const dismissWelcome = (): void => {
    setWelcomed(true)
    try {
      localStorage.setItem(WELCOME_KEY, 'yes')
    } catch {
      // Private browsing: the note will just come back next time.
    }
  }
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

  const beltRuns = useMemo(() => collectBeltRuns(result.tree, plan.beltTier), [result, plan.beltTier])
  const parallelRuns = beltRuns.filter((run) => run.belt?.needsParallel).length

  return (
    <div className="space-y-4">
      {!welcomed && (
        <Callout id="welcome" title="New here? Two things and you're away." onDismiss={dismissWelcome}>
          <p>
            Set a target item and a rate. The production chain then tells you every machine, input
            rate and megawatt it takes to sustain it — that's the whole idea.
          </p>
          <p>
            <button
              type="button"
              onClick={() => onGoTo('guide')}
              className="font-medium text-ficsit-400 underline decoration-dotted underline-offset-2 hover:text-ficsit-300"
            >
              Read the guide
            </button>{' '}
            for the concepts behind the numbers — clock speeds, alternates, byproducts.
          </p>
        </Callout>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-4">
        <Panel
          title="Target"
          help={
            <>
              <p>
                Everything starts here. Choose what you want to come out of the factory and how
                fast, in units per minute.
              </p>
              <p>
                <strong className="text-slate-200">Feed byproducts back in</strong> subtracts
                second outputs — like the Heavy Oil Residue that Plastic makes — from demand
                elsewhere, instead of listing them as surplus you have to deal with.
              </p>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Item">
              <ItemPicker value={target} onChange={(item) => plan.set('target', item)} />
            </Field>
            <Field label="Rate" hint={isLiquid(target) ? 'cubic metres per minute' : 'items per minute'}>
              <NumberInput value={rate} onChange={(value) => plan.set('rate', value)} min={0} />
            </Field>

            <Field
              label="Best belt you have"
              hint="Caps what the planner proposes; anything faster runs in parallel lines."
            >
              <Select
                value={plan.beltTier}
                onChange={(value) => plan.set('beltTier', value)}
                options={BELTS.map((belt) => ({
                  value: belt.name,
                  label: `Conveyor ${belt.name} — ${belt.rate}/min`,
                }))}
              />
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

        <Panel
          title="Belts & pipes"
          subtitle={`Every run in the chain, at ${plan.beltTier} and below`}
          help={
            <>
              <p>
                One row per connection in the chain — what has to travel, how fast, and the belt
                that carries it. Runs needing more than one line are flagged, since those need a
                splitter and a second belt.
              </p>
              <p>
                Fluids ignore the belt setting and use pipes: Mk.1 carries 300 m³/min, Mk.2 carries
                600.
              </p>
            </>
          }
        >
          {parallelRuns > 0 && (
            <p className="mb-3 rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-300">
              {parallelRuns} run{parallelRuns === 1 ? '' : 's'} exceed{parallelRuns === 1 ? 's' : ''}{' '}
              a single {plan.beltTier} belt and will need splitting across parallel lines.
            </p>
          )}
          <BeltList runs={beltRuns} />
        </Panel>

        <Panel title="Raw resources" subtitle="What the map has to supply">
          <RateList entries={result.rawResources} beltTier={plan.beltTier} />
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
              beltTier={plan.beltTier}
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
    </div>
  )
}

function RateList({
  entries,
  beltTier,
}: {
  entries: ReadonlyMap<ItemId, number>
  beltTier?: string
}) {
  const sorted = [...entries].filter(([, rate]) => rate > 1e-6).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return <Empty>None</Empty>

  return (
    <ul className="space-y-1 text-sm">
      {sorted.map(([item, rate]) => {
        const run = beltFor(rate, isLiquid(item), beltTier)
        return (
          <li key={item} className="flex items-baseline justify-between gap-2">
            <span className="text-slate-300">{itemName(item)}</span>
            <span className="text-right">
              <span className="tabular text-slate-100">{fmt(rate, 2)}</span>
              <span className="ml-1 text-xs text-slate-500">
                /min{run && ` · ${describeBelt(run)}`}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** One belt or pipe run: a link in the chain that physically has to be built. */
interface BeltRunRow {
  item: ItemId
  rate: number
  /** What consumes it, or null for the factory's final output. */
  into: ItemId | null
  belt: ReturnType<typeof beltFor>
}

/**
 * Walks the tree collecting every flow. Each node is one item travelling into
 * whatever sits above it, which is exactly one belt run on the factory floor.
 * Identical flows into the same consumer are merged; the same item feeding two
 * different steps stays separate, because that really is two belts.
 */
function collectBeltRuns(root: TreeNode, beltTier: string): BeltRunRow[] {
  const runs = new Map<string, BeltRunRow>()

  const add = (item: ItemId, rate: number, into: ItemId | null): void => {
    if (rate <= 1e-9) return
    const key = `${item}->${into ?? 'output'}`
    const existing = runs.get(key)
    if (existing) existing.rate += rate
    else runs.set(key, { item, rate, into, belt: null })
  }

  add(root.item, root.rate, null)
  const walk = (node: TreeNode): void => {
    for (const child of node.children) {
      add(child.item, child.rate, node.item)
      walk(child)
    }
  }
  walk(root)

  return [...runs.values()]
    .map((run) => ({ ...run, belt: beltFor(run.rate, isLiquid(run.item), beltTier) }))
    .sort((a, b) => b.rate - a.rate)
}

function BeltList({ runs }: { runs: BeltRunRow[] }) {
  if (runs.length === 0) return <Empty>Nothing to move.</Empty>

  return (
    <ul className="space-y-1.5 text-sm">
      {runs.map((run) => (
        <li key={`${run.item}->${run.into ?? 'out'}`} className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-slate-300">
            {itemName(run.item)}
            <span className="text-xs text-slate-600">
              {run.into ? ` → ${itemName(run.into)}` : ' → output'}
            </span>
          </span>
          <span className="tabular shrink-0 text-xs text-slate-500">{fmt(run.rate, 1)}/min</span>
          {run.belt && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                run.belt.needsParallel
                  ? 'bg-amber-950 text-amber-400'
                  : run.belt.liquid
                    ? 'bg-sky-950 text-sky-300'
                    : 'bg-slate-800 text-slate-300'
              }`}
              title={`${fmt(run.belt.utilisation * 100, 0)}% of capacity`}
            >
              {describeBelt(run.belt)}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function TreeView({
  node,
  options,
  onSetRecipe,
  onToggleImport,
  imported,
  beltTier,
}: {
  node: TreeNode
  options: Parameters<typeof solve>[2]
  onSetRecipe: (item: ItemId, recipe: RecipeId) => void
  onToggleImport: (item: ItemId) => void
  imported: ReadonlySet<ItemId>
  beltTier: string
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
    const isImported = imported.has(current.item)
    const belt = beltFor(current.rate, isLiquid(current.item), beltTier)

    return (
      <li key={key}>
        <div className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-1.5 transition hover:bg-slate-800/40">
          {/* Identity: what this step makes and how much of it. */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {hasChildren ? (
              <button
                type="button"
                className="w-4 shrink-0 rounded text-slate-500 transition hover:text-slate-100"
                onClick={() => toggle(key)}
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${itemName(current.item)}`}
              >
                {isCollapsed ? '▸' : '▾'}
              </button>
            ) : (
              <span className="w-4 shrink-0" aria-hidden="true" />
            )}

            <span className="truncate font-medium text-slate-100">{itemName(current.item)}</span>
            <span className="tabular shrink-0 text-ficsit-400">{fmt(current.rate, 2)}/min</span>

            {belt && (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                  belt.needsParallel
                    ? 'bg-amber-950 text-amber-400'
                    : belt.liquid
                      ? 'bg-sky-950 text-sky-300'
                      : 'bg-slate-800 text-slate-400'
                }`}
                title={
                  belt.needsParallel
                    ? `${describeBelt(belt)} — one line cannot carry ${fmt(current.rate, 1)}/min, so this run has to be split`
                    : `${describeBelt(belt)} at ${fmt(belt.utilisation * 100, 0)}% of capacity`
                }
              >
                {describeBelt(belt)}
              </span>
            )}

            {current.leafReason === 'raw' && <Tag tone="raw">raw</Tag>}
            {current.leafReason === 'imported' && <Tag tone="import">imported</Tag>}
            {current.leafReason === 'cycle' && <Tag tone="warn">loop</Tag>}
            {current.leafReason === 'no-recipe' && <Tag tone="muted">no recipe</Tag>}

            {isCollapsed && hasChildren && (
              <span className="shrink-0 text-xs text-slate-600">
                {countDescendants(current)} steps hidden
              </span>
            )}
          </div>

          {/* Cost: machines and power for this branch. */}
          {current.recipe && (
            <div className="tabular flex shrink-0 items-center gap-3 text-xs">
              <span className="text-slate-400">
                {Math.ceil(current.machines - 1e-9)}&times;{' '}
                <span className="text-slate-500">{machineName(current.recipe.machine)}</span>
                {efficiency?.options[0] && (
                  <span className="ml-1 text-slate-600">
                    @ {formatClock(efficiency.options[0].clock)}
                  </span>
                )}
              </span>
              <span className="w-16 text-right text-slate-500">{fmt(current.power, 1)} MW</span>
            </div>
          )}

          {/* Controls: stay quiet until the row is hovered or focused. */}
          <div className="flex shrink-0 items-center gap-2 opacity-60 transition group-focus-within:opacity-100 group-hover:opacity-100">
            {alternatives.length > 1 && current.recipe && (
              <select
                className="max-w-[14rem] rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-600"
                value={current.recipe.className}
                aria-label={`Recipe for ${itemName(current.item)}`}
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
                className={`rounded px-1.5 py-0.5 text-xs transition ${
                  isImported
                    ? 'bg-sky-950 text-sky-300 hover:bg-sky-900'
                    : 'text-slate-500 hover:bg-slate-800 hover:text-sky-300'
                }`}
                onClick={() => onToggleImport(current.item)}
                title={
                  isImported
                    ? `Go back to producing ${itemName(current.item)} in this factory`
                    : `Treat ${itemName(current.item)} as shipped in from another factory, and stop expanding this branch`
                }
              >
                {isImported ? 'produce here' : 'import'}
              </button>
            )}
          </div>
        </div>

        {current.creditedRate !== undefined && (
          <p className="ml-8 text-xs text-emerald-400/90">
            {fmt(current.grossRate ?? 0, 2)}/min needed, {fmt(current.creditedRate, 2)}/min of it
            covered by a byproduct elsewhere
          </p>
        )}

        {current.byproducts.length > 0 && (
          <p className="ml-8 text-xs text-slate-500">
            also makes{' '}
            {current.byproducts.map((b) => `${itemName(b.item)} ${fmt(b.rate, 2)}/min`).join(', ')}
          </p>
        )}

        {hasChildren && !isCollapsed && (
          // Nesting draws the hierarchy, so depth needs no inline indentation and
          // deep chains cannot push the row off the side of the panel.
          <ul className="ml-[0.65rem] border-l border-slate-800 pl-3">
            {current.children.map((child, index) => render(child, `${key}.${index}`))}
          </ul>
        )}
      </li>
    )
  }

  return <ul className="text-sm">{render(node, 'root')}</ul>
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'raw' | 'import' | 'warn' | 'muted'
}) {
  const tones = {
    raw: 'bg-emerald-950 text-emerald-400',
    import: 'bg-sky-950 text-sky-300',
    warn: 'bg-amber-950 text-amber-400',
    muted: 'bg-slate-800 text-slate-400',
  }
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
  )
}

/** How many steps a collapsed branch is hiding. */
function countDescendants(node: TreeNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0)
}
