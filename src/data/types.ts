/** Types for the slimmed dataset produced by `scripts/build-data.ts`. */

/** An item class name, e.g. `Desc_IronIngot_C`. */
export type ItemId = string
/** A recipe class name, e.g. `Recipe_IronPlate_C`. */
export type RecipeId = string
/** A machine class name, e.g. `Desc_ConstructorMk1_C`. */
export type MachineId = string

export interface Stack {
  item: ItemId
  amount: number
}

export interface Item {
  className: ItemId
  name: string
  slug: string
  /** AWESOME Sink value per unit. 0 means the item cannot be sunk. */
  sinkPoints: number
  stackSize: number
  /** Megajoules released when burned as fuel; 0 for non-fuels. Per m³ for liquids. */
  energyValue: number
  liquid: boolean
}

export interface Recipe {
  className: RecipeId
  name: string
  slug: string
  /** True for recipes unlocked from hard drives rather than milestones. */
  alternate: boolean
  /** Seconds per craft at 100% clock speed. */
  time: number
  machine: MachineId
  ingredients: Stack[]
  /** First entry is the primary product; any others are byproducts. */
  products: Stack[]
  /** Present only for variable-power machines (Converter, Particle Accelerator, Quantum Encoder). */
  minPower?: number
  maxPower?: number
}

export interface Machine {
  className: MachineId
  name: string
  slug: string
  /** MW at 100% clock. 0 for machines whose draw is defined per recipe. */
  powerConsumption: number
  /** Clock speed exponent applied to power draw, 1.321929 for every production machine. */
  powerExponent: number
}

export interface Schematic {
  className: string
  name: string
  slug: string
  kind: 'milestone' | 'alternate' | 'mam'
  /** Tier this unlock belongs to; 0 for hard-drive alternates and most MAM research. */
  tier: number
  recipes: RecipeId[]
  cost: Stack[]
}

export interface Generator {
  className: string
  name: string
  fuel: ItemId[]
  /** MW at 100% clock. */
  powerProduction: number
  powerExponent: number
  /** Supplemental water per MW; multiply by 0.06 for m³/min. Zero if none needed. */
  waterToPowerRatio: number
}

export interface Miner {
  className: string
  name: string
  allowedResources: ItemId[]
  allowLiquids: boolean
  allowSolids: boolean
  /**
   * Extraction per minute at 100% clock on a normal-purity node. Liquid extractors
   * report thousandths of a m³, so divide by 1000 for m³/min.
   */
  itemsPerMinute: number
  /** MW at 100% clock. The Resource Well Extractor draws 0 — its Pressurizer pays the cost. */
  powerConsumption: number
}

/** Extractors that support production but run no recipe of their own. */
export interface SupportBuilding {
  className: string
  name: string
  /** MW at 100% clock. */
  powerConsumption: number
}

export interface GameData {
  gameVersion: string
  source: string
  items: Item[]
  recipes: Recipe[]
  machines: Machine[]
  schematics: Schematic[]
  generators: Generator[]
  miners: Miner[]
  supportBuildings: SupportBuilding[]
  /** Item ids that can be extracted straight from the map. */
  resources: ItemId[]
}
