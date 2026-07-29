/** Progression tracker: tick off what you have unlocked so the planner stays honest. */
import { useMemo, useState } from 'react'

import { Button, Empty, Panel, Select, Stat, fmt } from '../components/ui'
import { gameData, itemName, machineName, recipesById } from '../data/constants'
import type { Schematic } from '../data/types'
import type { UnlockState } from '../state/useUnlocks'

type Tab = 'milestones' | 'alternates' | 'mam'

export function Unlocks({ unlocks }: { unlocks: UnlockState }) {
  const [tab, setTab] = useState<Tab>('milestones')
  const [search, setSearch] = useState('')

  const grouped = useMemo(() => {
    const byKind: Record<Tab, Schematic[]> = { milestones: [], alternates: [], mam: [] }
    for (const schematic of gameData.schematics) {
      if (schematic.kind === 'milestone') byKind.milestones.push(schematic)
      else if (schematic.kind === 'alternate') byKind.alternates.push(schematic)
      else byKind.mam.push(schematic)
    }
    return byKind
  }, [])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = grouped[tab]
    if (!needle) return list
    return list.filter((s) => s.name.toLowerCase().includes(needle))
  }, [grouped, tab, search])

  const byTier = useMemo(() => {
    const map = new Map<number, Schematic[]>()
    for (const schematic of visible) {
      const list = map.get(schematic.tier)
      if (list) list.push(schematic)
      else map.set(schematic.tier, [schematic])
    }
    return [...map].sort((a, b) => a[0] - b[0])
  }, [visible])

  const unlockedCount = gameData.schematics.filter((s) => unlocks.schematics.has(s.className)).length

  return (
    <div className="space-y-4">
      <Panel
        title="Progression"
        subtitle="The planner only proposes recipes you have unlocked. With nothing ticked it falls back to using everything."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Unlocked" value={`${unlockedCount} / ${gameData.schematics.length}`} />
            <Stat label="Recipes available" value={unlocks.unlockedRecipes.size} />
            <Stat
              label="Alternates found"
              value={grouped.alternates.filter((s) => unlocks.schematics.has(s.className)).length}
            />
            <Stat
              label="Tracking"
              value={unlocks.trackingDisabled ? 'off' : 'on'}
              tone={unlocks.trackingDisabled ? 'warn' : 'good'}
            />
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select
              value=""
              onChange={(value) => {
                if (value !== '') unlocks.unlockThroughTier(Number.parseInt(value, 10))
              }}
              options={[
                { value: '', label: 'Unlock through tier…' },
                ...[...new Set(grouped.milestones.map((m) => m.tier))]
                  .sort((a, b) => a - b)
                  .map((tier) => ({ value: String(tier), label: `Tier ${tier}` })),
              ]}
            />
            <Button onClick={unlocks.unlockAll}>Unlock all</Button>
            <Button variant="ghost" onClick={unlocks.reset}>
              Reset
            </Button>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex rounded-md border border-slate-700 p-0.5">
            {(
              [
                ['milestones', `Milestones (${grouped.milestones.length})`],
                ['alternates', `Alternates (${grouped.alternates.length})`],
                ['mam', `MAM research (${grouped.mam.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                  tab === key ? 'bg-ficsit-600 text-white' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            type="search"
            placeholder="Search…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="ml-auto w-56 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-ficsit-500"
          />
        </div>

        {byTier.length === 0 ? (
          <Empty>Nothing matches “{search}”.</Empty>
        ) : (
          <div className="space-y-6">
            {byTier.map(([tier, schematics]) => {
              const ids = schematics.map((s) => s.className)
              const allOn = ids.every((id) => unlocks.schematics.has(id))
              return (
                <div key={tier}>
                  <div className="mb-2 flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-ficsit-400">
                      {tab === 'milestones' ? `Tier ${tier}` : tier > 0 ? `Tier ${tier}` : 'Research'}
                    </h3>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-slate-200"
                      onClick={() => unlocks.setMany(ids, !allOn)}
                    >
                      {allOn ? 'clear all' : 'select all'}
                    </button>
                  </div>

                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {schematics.map((schematic) => (
                      <SchematicCard
                        key={schematic.className}
                        schematic={schematic}
                        checked={unlocks.schematics.has(schematic.className)}
                        onToggle={() => unlocks.toggle(schematic.className)}
                      />
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}

function SchematicCard({
  schematic,
  checked,
  onToggle,
}: {
  schematic: Schematic
  checked: boolean
  onToggle: () => void
}) {
  const recipes = schematic.recipes
    .map((id) => recipesById.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))

  return (
    <li>
      <label
        className={`block cursor-pointer rounded-md border px-3 py-2 transition ${
          checked
            ? 'border-ficsit-700 bg-ficsit-950/30'
            : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
        }`}
      >
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 accent-ficsit-500"
            checked={checked}
            onChange={onToggle}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-100">{schematic.name}</div>

            {recipes.length > 0 && (
              <div className="mt-1 text-xs text-slate-500">
                {recipes
                  .slice(0, 3)
                  .map((r) => `${r.name} (${machineName(r.machine)})`)
                  .join(', ')}
                {recipes.length > 3 && ` +${recipes.length - 3} more`}
              </div>
            )}

            {schematic.cost.length > 0 && (
              <div className="mt-1 text-xs text-slate-600">
                cost: {schematic.cost.map((c) => `${fmt(c.amount, 0)} ${itemName(c.item)}`).join(', ')}
              </div>
            )}
          </div>
        </div>
      </label>
    </li>
  )
}
