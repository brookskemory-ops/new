/**
 * Planner state that survives a reload and travels in the URL, so a factory
 * design can be bookmarked or pasted to someone else.
 *
 * The URL is the source of truth when one is present; otherwise the last plan is
 * restored from localStorage. Mirrors the persistence approach in `useUnlocks`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ItemId, RecipeId } from '../data/types'

const STORAGE_KEY = 'satisfactory-companion:plan'

export interface PlanState {
  target: ItemId
  rate: number
  creditByproducts: boolean
  respectUnlocks: boolean
  recipeChoices: Record<ItemId, RecipeId>
  imported: ItemId[]
}

export const DEFAULT_PLAN: PlanState = {
  target: 'Desc_IronPlateReinforced_C',
  rate: 30,
  creditByproducts: false,
  respectUnlocks: true,
  recipeChoices: {},
  imported: [],
}

/**
 * Serialised compactly — class names are long, so a plan with several overrides
 * would otherwise make an unwieldy URL. Keys are single letters.
 */
interface Encoded {
  t?: string
  r?: number
  c?: 1
  u?: 0
  o?: Record<string, string>
  i?: string[]
}

/** Class names all share these affixes; stripping them roughly halves the URL. */
const stripItem = (id: string): string => id.replace(/^Desc_/, '').replace(/_C$/, '')
const expandItem = (id: string): string => `Desc_${id}_C`
const stripRecipe = (id: string): string => id.replace(/^Recipe_/, '').replace(/_C$/, '')
const expandRecipe = (id: string): string => `Recipe_${id}_C`

export function encodePlan(plan: PlanState): string {
  const encoded: Encoded = {}
  if (plan.target !== DEFAULT_PLAN.target) encoded.t = stripItem(plan.target)
  if (plan.rate !== DEFAULT_PLAN.rate) encoded.r = plan.rate
  if (plan.creditByproducts) encoded.c = 1
  if (!plan.respectUnlocks) encoded.u = 0

  const overrides = Object.entries(plan.recipeChoices)
  if (overrides.length > 0) {
    encoded.o = Object.fromEntries(
      overrides.map(([item, recipe]) => [stripItem(item), stripRecipe(recipe)]),
    )
  }
  if (plan.imported.length > 0) encoded.i = plan.imported.map(stripItem)

  if (Object.keys(encoded).length === 0) return ''
  // base64url keeps the hash free of characters that need percent-encoding.
  return toBase64Url(JSON.stringify(encoded))
}

export function decodePlan(encoded: string): PlanState | null {
  if (!encoded) return null
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as Encoded
    if (typeof parsed !== 'object' || parsed === null) return null

    return {
      target: parsed.t ? expandItem(parsed.t) : DEFAULT_PLAN.target,
      rate: typeof parsed.r === 'number' && Number.isFinite(parsed.r) ? parsed.r : DEFAULT_PLAN.rate,
      creditByproducts: parsed.c === 1,
      respectUnlocks: parsed.u !== 0,
      recipeChoices: Object.fromEntries(
        Object.entries(parsed.o ?? {}).map(([item, recipe]) => [
          expandItem(item),
          expandRecipe(recipe),
        ]),
      ),
      imported: (parsed.i ?? []).map(expandItem),
    }
  } catch {
    // A truncated or hand-edited link should fall back, not crash the page.
    return null
  }
}

function toBase64Url(value: string): string {
  const base64 = btoa(unescape(encodeURIComponent(value)))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return decodeURIComponent(escape(atob(base64)))
}

function loadStored(): PlanState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? decodePlan(stored) : null
  } catch {
    return null
  }
}

/** Reads the plan payload out of a `#planner:<payload>` style hash. */
export function planFromHash(hash: string): PlanState | null {
  const payload = hash.replace(/^#/, '').split(':')[1]
  return payload ? decodePlan(payload) : null
}

export interface PlanController extends PlanState {
  set: <K extends keyof PlanState>(key: K, value: PlanState[K]) => void
  setRecipe: (item: ItemId, recipe: RecipeId | null) => void
  toggleImport: (item: ItemId) => void
  reset: () => void
  /** The shareable URL for the current plan. */
  shareUrl: () => string
}

export function usePlan(): PlanController {
  const [plan, setPlan] = useState<PlanState>(
    () => planFromHash(window.location.hash) ?? loadStored() ?? DEFAULT_PLAN,
  )

  // Skip the very first write so simply opening the app does not rewrite the URL.
  const mounted = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, encodePlan(plan))
    } catch {
      // Private browsing: the plan just will not persist.
    }

    if (!mounted.current) {
      mounted.current = true
      return
    }

    const payload = encodePlan(plan)
    const next = payload ? `#planner:${payload}` : '#planner'
    if (window.location.hash.startsWith('#planner') && window.location.hash !== next) {
      // replaceState keeps the back button from filling up with every keystroke.
      window.history.replaceState(null, '', next)
    }
  }, [plan])

  const set = useCallback(<K extends keyof PlanState>(key: K, value: PlanState[K]) => {
    setPlan((current) => ({ ...current, [key]: value }))
  }, [])

  const setRecipe = useCallback((item: ItemId, recipe: RecipeId | null) => {
    setPlan((current) => {
      const next = { ...current.recipeChoices }
      if (recipe === null) delete next[item]
      else next[item] = recipe
      return { ...current, recipeChoices: next }
    })
  }, [])

  const toggleImport = useCallback((item: ItemId) => {
    setPlan((current) => ({
      ...current,
      imported: current.imported.includes(item)
        ? current.imported.filter((i) => i !== item)
        : [...current.imported, item],
    }))
  }, [])

  const reset = useCallback(() => setPlan(DEFAULT_PLAN), [])

  const shareUrl = useCallback(() => {
    const payload = encodePlan(plan)
    const { origin, pathname } = window.location
    return `${origin}${pathname}${payload ? `#planner:${payload}` : '#planner'}`
  }, [plan])

  return { ...plan, set, setRecipe, toggleImport, reset, shareUrl }
}
