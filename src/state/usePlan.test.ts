import { describe, expect, it } from 'vitest'

import { DEFAULT_PLAN, decodePlan, encodePlan, planFromHash } from './usePlan'
import type { PlanState } from './usePlan'

describe('plan encoding', () => {
  it('encodes the default plan to nothing, keeping the URL clean', () => {
    expect(encodePlan(DEFAULT_PLAN)).toBe('')
    expect(decodePlan('')).toBeNull()
  })

  it('omits a field that happens to match the default', () => {
    // "auto" is the default belt setting, so it must not bloat the URL.
    expect(encodePlan({ ...DEFAULT_PLAN, beltTier: 'auto' })).toBe('')
    expect(encodePlan({ ...DEFAULT_PLAN, beltTier: 'Mk.2' })).not.toBe('')
  })

  it('round-trips a fully customised plan', () => {
    const plan: PlanState = {
      target: 'Desc_ModularFrameHeavy_C',
      rate: 12.5,
      creditByproducts: true,
      respectUnlocks: false,
      recipeChoices: {
        Desc_IronIngot_C: 'Recipe_Alternate_IngotIron_C',
        Desc_Plastic_C: 'Recipe_Alternate_Plastic_1_C',
      },
      imported: ['Desc_Cable_C', 'Desc_Wire_C'],
      beltTier: 'Mk.3',
    }
    expect(decodePlan(encodePlan(plan))).toEqual(plan)
  })

  it('round-trips each field on its own', () => {
    const variations: Partial<PlanState>[] = [
      { target: 'Desc_Cable_C' },
      { rate: 0 },
      { rate: 1234.5678 },
      { creditByproducts: true },
      { respectUnlocks: false },
      { recipeChoices: { Desc_Screw_C: 'Recipe_Alternate_Screw_C' } },
      { imported: ['Desc_Coal_C'] },
      { beltTier: 'Mk.1' },
      { beltTier: 'Mk.5' },
    ]
    for (const variation of variations) {
      const plan = { ...DEFAULT_PLAN, ...variation }
      expect(decodePlan(encodePlan(plan))).toEqual(plan)
    }
  })

  it('produces a URL-safe payload with no characters needing escaping', () => {
    const plan: PlanState = {
      ...DEFAULT_PLAN,
      target: 'Desc_ModularFrameHeavy_C',
      recipeChoices: { Desc_IronIngot_C: 'Recipe_Alternate_IngotIron_C' },
      imported: ['Desc_Cable_C'],
    }
    const payload = encodePlan(plan)
    expect(payload).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(encodeURIComponent(payload)).toBe(payload)
  })

  it('reads a plan out of a hash and ignores the tab prefix', () => {
    const plan = { ...DEFAULT_PLAN, rate: 99 }
    const payload = encodePlan(plan)
    expect(planFromHash(`#planner:${payload}`)).toEqual(plan)
    expect(planFromHash('#planner')).toBeNull()
    expect(planFromHash('#logistics')).toBeNull()
    expect(planFromHash('')).toBeNull()
  })

  it('falls back rather than throwing on a corrupted link', () => {
    expect(decodePlan('not-valid-base64!!')).toBeNull()
    expect(decodePlan(btoa('{"t":'))).toBeNull()
    expect(decodePlan(btoa('null'))).toBeNull()
    expect(planFromHash('#planner:garbage')).toBeNull()
  })

  it('keeps a shared link short', () => {
    const plan: PlanState = {
      ...DEFAULT_PLAN,
      target: 'Desc_ModularFrameHeavy_C',
      rate: 60,
      recipeChoices: {
        Desc_IronIngot_C: 'Recipe_Alternate_IngotIron_C',
        Desc_Plastic_C: 'Recipe_Alternate_Plastic_1_C',
        Desc_Rubber_C: 'Recipe_Alternate_Rubber_C',
      },
      imported: ['Desc_Cable_C'],
    }
    expect(encodePlan(plan).length).toBeLessThan(300)
  })
})
