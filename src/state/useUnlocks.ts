/**
 * Tracks which schematics the player has unlocked, persisted to localStorage so
 * the planner only ever proposes recipes you can actually build.
 */
import { useCallback, useMemo, useState } from 'react'

import { gameData } from '../data/constants'
import type { RecipeId } from '../data/types'

const STORAGE_KEY = 'satisfactory-companion:unlocks'

function load(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return new Set()
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function save(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // Private browsing or a full quota: the app still works, it just forgets.
  }
}

export interface UnlockState {
  /** Schematic class names the player has completed. */
  schematics: ReadonlySet<string>
  /** Recipes those schematics make available. */
  unlockedRecipes: ReadonlySet<RecipeId>
  /** True when nothing has been ticked, in which case the planner ignores unlocks. */
  trackingDisabled: boolean
  toggle: (schematic: string) => void
  setMany: (schematics: string[], unlocked: boolean) => void
  /** Ticks every milestone and MAM node up to and including a tier. */
  unlockThroughTier: (tier: number) => void
  reset: () => void
  unlockAll: () => void
}

export function useUnlocks(): UnlockState {
  const [schematics, setSchematics] = useState<ReadonlySet<string>>(load)

  const update = useCallback((next: ReadonlySet<string>) => {
    setSchematics(next)
    save(next)
  }, [])

  const toggle = useCallback(
    (schematic: string) => {
      const next = new Set(schematics)
      if (next.has(schematic)) next.delete(schematic)
      else next.add(schematic)
      update(next)
    },
    [schematics, update],
  )

  const setMany = useCallback(
    (ids: string[], unlocked: boolean) => {
      const next = new Set(schematics)
      for (const id of ids) {
        if (unlocked) next.add(id)
        else next.delete(id)
      }
      update(next)
    },
    [schematics, update],
  )

  const unlockThroughTier = useCallback(
    (tier: number) => {
      const next = new Set(schematics)
      for (const schematic of gameData.schematics) {
        if (schematic.kind === 'milestone' && schematic.tier <= tier) next.add(schematic.className)
      }
      update(next)
    },
    [schematics, update],
  )

  const reset = useCallback(() => update(new Set()), [update])

  const unlockAll = useCallback(
    () => update(new Set(gameData.schematics.map((s) => s.className))),
    [update],
  )

  const unlockedRecipes = useMemo(() => {
    const recipes = new Set<RecipeId>()
    for (const schematic of gameData.schematics) {
      if (!schematics.has(schematic.className)) continue
      for (const recipe of schematic.recipes) recipes.add(recipe)
    }
    return recipes
  }, [schematics])

  return {
    schematics,
    unlockedRecipes,
    trackingDisabled: schematics.size === 0,
    toggle,
    setMany,
    unlockThroughTier,
    reset,
    unlockAll,
  }
}
