/**
 * Game constants that are not present in the upstream data dump, plus derived
 * lookups over the dataset.
 */
import rawData from './game-data.json'
import type { GameData, Item, ItemId, Machine, MachineId, Recipe, RecipeId } from './types'

export const gameData = rawData as GameData

// ---------------------------------------------------------------------------
// Logistics constants
// ---------------------------------------------------------------------------

export interface BeltTier {
  name: string
  /** Items per minute. */
  rate: number
}

export const BELTS: BeltTier[] = [
  { name: 'Mk.1', rate: 60 },
  { name: 'Mk.2', rate: 120 },
  { name: 'Mk.3', rate: 270 },
  { name: 'Mk.4', rate: 480 },
  { name: 'Mk.5', rate: 780 },
  { name: 'Mk.6', rate: 1200 },
]

export const PIPES: BeltTier[] = [
  { name: 'Mk.1', rate: 300 },
  { name: 'Mk.2', rate: 600 },
]

/** Multiplier applied to a miner's base rate by node purity. */
export const PURITY = {
  impure: 0.5,
  normal: 1,
  pure: 2,
} as const

export type Purity = keyof typeof PURITY

// ---------------------------------------------------------------------------
// Clock speed constants
// ---------------------------------------------------------------------------

/** Power draw scales with clock speed raised to this exponent. */
export const POWER_EXPONENT = 1.321929

/** Maximum clock speed, reached with three Power Shards. */
export const MAX_CLOCK = 2.5

/** Clock speed unlocked by each number of Power Shards slotted into a machine. */
export const SHARD_CLOCKS = [1, 1.5, 2, 2.5] as const

/**
 * A Somersloop doubles output but multiplies power draw by this exponent's base.
 * Production scales linearly with sloops; power scales by (1 + sloops/max)^2.
 */
export const SOMERSLOOP_POWER_EXPONENT = 2

/** How many Somersloops each machine can hold. */
export const SOMERSLOOP_SLOTS: Record<MachineId, number> = {
  Desc_SmelterMk1_C: 1,
  Desc_ConstructorMk1_C: 1,
  Desc_FoundryMk1_C: 2,
  Desc_AssemblerMk1_C: 2,
  Desc_OilRefinery_C: 2,
  Desc_Packager_C: 2,
  Desc_ManufacturerMk1_C: 4,
  Desc_Blender_C: 4,
  Desc_HadronCollider_C: 4,
  Desc_Converter_C: 4,
  Desc_QuantumEncoder_C: 4,
}

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

export const itemsById: ReadonlyMap<ItemId, Item> = new Map(
  gameData.items.map((item) => [item.className, item]),
)

export const recipesById: ReadonlyMap<RecipeId, Recipe> = new Map(
  gameData.recipes.map((recipe) => [recipe.className, recipe]),
)

export const machinesById: ReadonlyMap<MachineId, Machine> = new Map(
  gameData.machines.map((machine) => [machine.className, machine]),
)

export const rawResources: ReadonlySet<ItemId> = new Set(gameData.resources)

/** Every recipe that produces a given item, primary product or byproduct. */
export const recipesByProduct: ReadonlyMap<ItemId, Recipe[]> = (() => {
  const map = new Map<ItemId, Recipe[]>()
  for (const recipe of gameData.recipes) {
    for (const product of recipe.products) {
      const list = map.get(product.item)
      if (list) list.push(recipe)
      else map.set(product.item, [recipe])
    }
  }
  return map
})()

/** Which schematic unlocks a given recipe. Recipes absent here are available from the start. */
export const schematicByRecipe: ReadonlyMap<RecipeId, string> = (() => {
  const map = new Map<RecipeId, string>()
  for (const schematic of gameData.schematics) {
    for (const recipe of schematic.recipes) {
      if (!map.has(recipe)) map.set(recipe, schematic.className)
    }
  }
  return map
})()

export function itemName(id: ItemId): string {
  return itemsById.get(id)?.name ?? id
}

export function machineName(id: MachineId): string {
  return machinesById.get(id)?.name ?? id
}

/** True for items produced by a machine rather than extracted from the map. */
export function isRaw(id: ItemId): boolean {
  return rawResources.has(id)
}
