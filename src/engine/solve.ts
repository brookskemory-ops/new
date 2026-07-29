/**
 * The production solver: given a target item and rate, work out every machine,
 * input rate and raw resource needed to sustain it.
 */
import { isRaw, recipesById, recipesByProduct, schematicByRecipe } from '../data/constants'
import type { ItemId, Recipe, RecipeId } from '../data/types'
import { basePower, inputPerMachine, outputPerMachine, powerAtClock } from './clock'

/** Rates below this are treated as zero, to keep floating point noise out of the output. */
const EPSILON = 1e-9

/** Guard against a recipe loop spinning forever. */
const MAX_ITERATIONS = 10_000

export interface SolveOptions {
  /** Force a specific recipe for an item, overriding the default choice. */
  recipeChoices?: Readonly<Record<ItemId, RecipeId>>
  /** Items treated as raw inputs because they are shipped in from elsewhere. */
  imported?: ReadonlySet<ItemId>
  /** Recipes available to the player. When omitted every recipe is fair game. */
  unlocked?: ReadonlySet<RecipeId>
  /**
   * Subtract byproducts from demand elsewhere in the plan instead of reporting
   * them as surplus. Matches how you would really plumb residue back in.
   */
  creditByproducts?: boolean
}

/** One node in the display tree. Items can appear more than once across branches. */
export interface TreeNode {
  item: ItemId
  /** Units per minute this branch needs, net of any byproduct credit. */
  rate: number
  /** Demand before byproduct crediting. Set only when a credit applied. */
  grossRate?: number
  /** How much of the gross a byproduct covered. Set only when a credit applied. */
  creditedRate?: number
  recipe: Recipe | null
  /** Fractional machine count for this branch alone. */
  machines: number
  /** MW drawn by this branch alone. */
  power: number
  /** Byproducts this branch emits, per minute. */
  byproducts: { item: ItemId; rate: number }[]
  children: TreeNode[]
  /** Why recursion stopped: raw resource, user-imported, or a detected loop. */
  leafReason?: 'raw' | 'imported' | 'cycle' | 'no-recipe'
  depth: number
}

/** Aggregated production of one recipe across the whole plan. */
export interface ProductionStep {
  recipe: Recipe
  /** Fractional machines needed in total. */
  machines: number
  /** Total MW at 100% clock. */
  power: number
  /** Primary product output per minute. */
  outputRate: number
  inputs: { item: ItemId; rate: number }[]
  outputs: { item: ItemId; rate: number }[]
}

export interface SolveResult {
  target: ItemId
  targetRate: number
  tree: TreeNode
  /** One entry per distinct recipe used, aggregated across the tree. */
  steps: ProductionStep[]
  /** Raw resources consumed per minute, by item. */
  rawResources: Map<ItemId, number>
  /** Items brought in from another factory, per minute. */
  imports: Map<ItemId, number>
  /** Byproducts left over after any crediting, per minute. */
  surplus: Map<ItemId, number>
  /** Machine counts by machine class name. */
  machineCounts: Map<string, number>
  /** Total MW at 100% clock. */
  totalPower: number
  warnings: string[]
}

/**
 * Picks the recipe to use for an item when the user has not chosen one.
 *
 * Prefers a recipe that makes the item as its primary product, that the player
 * has unlocked, and that is not an alternate — the same order of preference a
 * player following the milestone track would have available.
 */
export function chooseRecipe(
  item: ItemId,
  unlocked?: ReadonlySet<RecipeId>,
  overrides?: Readonly<Record<ItemId, RecipeId>>,
): Recipe | null {
  const override = overrides?.[item]
  if (override) {
    const recipe = recipesById.get(override)
    if (recipe) return recipe
  }

  const candidates = availableRecipes(item, unlocked)
  return candidates[0] ?? null
}

/** Every recipe the player could use for an item, best default first. */
export function availableRecipes(item: ItemId, unlocked?: ReadonlySet<RecipeId>): Recipe[] {
  const all = recipesByProduct.get(item) ?? []
  const usable = all.filter((r) => !unlocked || isUnlocked(r.className, unlocked))

  // Recipes where the item is the main product come first; falling back to
  // byproduct-only producers covers things like Dissolved Silica.
  const primary = usable.filter((r) => r.products[0]?.item === item)
  const pool = primary.length > 0 ? primary : usable

  return [...pool].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
}

/** Lower is a better default. */
function score(recipe: Recipe): number {
  let value = 0
  // Unpackaging is a valid recipe but never what someone means by "make Fuel".
  if (/Unpackage/i.test(recipe.className)) value += 100
  if (recipe.alternate) value += 10
  value += recipe.ingredients.length
  return value
}

/** A recipe with no schematic gating it is available from the first minute of a save. */
export function isUnlocked(recipe: RecipeId, unlocked: ReadonlySet<RecipeId>): boolean {
  if (!schematicByRecipe.has(recipe)) return true
  return unlocked.has(recipe)
}

export function solve(target: ItemId, targetRate: number, options: SolveOptions = {}): SolveResult {
  const { recipeChoices, imported, unlocked, creditByproducts = false } = options

  const warnings: string[] = []
  const chosen = new Map<ItemId, Recipe | null>()
  const recipeFor = (item: ItemId): Recipe | null => {
    if (!chosen.has(item)) chosen.set(item, chooseRecipe(item, unlocked, recipeChoices))
    return chosen.get(item) ?? null
  }

  const isLeaf = (item: ItemId): TreeNode['leafReason'] | null => {
    if (imported?.has(item)) return 'imported'
    if (isRaw(item)) return 'raw'
    if (!recipeFor(item)) return 'no-recipe'
    return null
  }

  const aggregate = solveFlows(target, targetRate, recipeFor, isLeaf, creditByproducts, warnings)

  /**
   * The share of an item's demand that genuinely had to be produced. Below 1 when
   * byproducts covered part of it; the tree scales branches by this so its leaf
   * totals reconcile with the summary instead of contradicting it.
   */
  const netFactor = (item: ItemId): number => {
    const gross = aggregate.gross.get(item) ?? 0
    if (gross <= EPSILON) return 1
    const net = aggregate.net.get(item) ?? 0
    return Math.min(1, Math.max(0, net / gross))
  }

  const tree = buildTree(target, targetRate, recipeFor, isLeaf, netFactor, warnings)

  const machineCounts = new Map<string, number>()
  let totalPower = 0
  for (const step of aggregate.steps) {
    machineCounts.set(
      step.recipe.machine,
      (machineCounts.get(step.recipe.machine) ?? 0) + step.machines,
    )
    totalPower += step.power
  }

  return {
    target,
    targetRate,
    tree,
    steps: aggregate.steps.sort((a, b) => b.machines - a.machines),
    rawResources: aggregate.raws,
    imports: aggregate.imports,
    surplus: aggregate.surplus,
    machineCounts,
    totalPower,
    warnings,
  }
}

/**
 * Aggregated flow solve. Demand is relaxed item by item until nothing is
 * outstanding, so an intermediate shared by several branches is counted once.
 */
function solveFlows(
  target: ItemId,
  targetRate: number,
  recipeFor: (item: ItemId) => Recipe | null,
  isLeaf: (item: ItemId) => TreeNode['leafReason'] | null,
  creditByproducts: boolean,
  warnings: string[],
): {
  steps: ProductionStep[]
  raws: Map<ItemId, number>
  imports: Map<ItemId, number>
  surplus: Map<ItemId, number>
  /** Total demand raised for each item, before any byproduct credit. */
  gross: Map<ItemId, number>
  /** The part of that demand that actually had to be produced or extracted. */
  net: Map<ItemId, number>
} {
  /** Outstanding demand per item. Negative means surplus available to consume. */
  const demand = new Map<ItemId, number>([[target, targetRate]])
  const raws = new Map<ItemId, number>()
  const imports = new Map<ItemId, number>()
  const machinesByRecipe = new Map<RecipeId, number>()
  const surplusMap = new Map<ItemId, number>()

  // Gross counts every unit ever asked for; net counts only the units that had to
  // be made or mined. They differ exactly where a byproduct covered the demand.
  const gross = new Map<ItemId, number>([[target, targetRate]])
  const net = new Map<ItemId, number>()
  const addGross = (item: ItemId, rate: number): void => {
    gross.set(item, (gross.get(item) ?? 0) + rate)
  }

  let iterations = 0
  for (;;) {
    if (++iterations > MAX_ITERATIONS) {
      warnings.push(
        'Recipe loop did not settle after 10,000 passes. Mark one of the looping items ' +
          'as imported to break the cycle.',
      )
      break
    }

    // Take the next item with real outstanding demand.
    let next: ItemId | undefined
    for (const [item, amount] of demand) {
      if (amount > EPSILON) {
        next = item
        break
      }
    }
    if (next === undefined) break

    const outstanding = demand.get(next) ?? 0
    demand.set(next, 0)
    net.set(next, (net.get(next) ?? 0) + outstanding)

    const leaf = isLeaf(next)
    if (leaf === 'raw') {
      raws.set(next, (raws.get(next) ?? 0) + outstanding)
      continue
    }
    if (leaf === 'imported' || leaf === 'no-recipe') {
      imports.set(next, (imports.get(next) ?? 0) + outstanding)
      continue
    }

    const recipe = recipeFor(next)
    if (!recipe) continue

    const perMachine = outputPerMachine(recipe, next)
    if (perMachine <= EPSILON) continue

    const machines = outstanding / perMachine
    machinesByRecipe.set(recipe.className, (machinesByRecipe.get(recipe.className) ?? 0) + machines)

    for (const ingredient of recipe.ingredients) {
      const rate = machines * inputPerMachine(recipe, ingredient.item)
      demand.set(ingredient.item, (demand.get(ingredient.item) ?? 0) + rate)
      addGross(ingredient.item, rate)
    }

    for (const product of recipe.products) {
      if (product.item === next) continue
      const rate = machines * outputPerMachine(recipe, product.item)
      if (creditByproducts) {
        // A negative demand is surplus that later demand can draw down.
        demand.set(product.item, (demand.get(product.item) ?? 0) - rate)
      } else {
        surplusMap.set(product.item, (surplusMap.get(product.item) ?? 0) + rate)
      }
    }
  }

  // Anything still negative after crediting is genuine leftover.
  if (creditByproducts) {
    for (const [item, amount] of demand) {
      if (amount < -EPSILON) surplusMap.set(item, (surplusMap.get(item) ?? 0) - amount)
    }
  }

  const steps: ProductionStep[] = []
  for (const [recipeId, machines] of machinesByRecipe) {
    const recipe = recipesById.get(recipeId)
    if (!recipe) continue
    steps.push({
      recipe,
      machines,
      power: machines * powerAtClock(basePower(recipe), 1, 0, recipe.machine),
      outputRate: machines * outputPerMachine(recipe),
      inputs: recipe.ingredients.map((i) => ({
        item: i.item,
        rate: machines * inputPerMachine(recipe, i.item),
      })),
      outputs: recipe.products.map((p) => ({
        item: p.item,
        rate: machines * outputPerMachine(recipe, p.item),
      })),
    })
  }

  return { steps, raws, imports, surplus: surplusMap, gross, net }
}

/**
 * Builds the display tree. Each branch carries its own share of the total, and a
 * repeated item under its own ancestry is cut off as a cycle rather than recursed.
 *
 * Branch rates are net of any byproduct credit, spread proportionally across the
 * branches that consume the item, so the tree's leaves add up to the same raw
 * resource totals the summary reports.
 */
function buildTree(
  target: ItemId,
  targetRate: number,
  recipeFor: (item: ItemId) => Recipe | null,
  isLeaf: (item: ItemId) => TreeNode['leafReason'] | null,
  netFactor: (item: ItemId) => number,
  warnings: string[],
): TreeNode {
  const reportedCycles = new Set<string>()

  const build = (item: ItemId, rate: number, path: ReadonlySet<ItemId>, depth: number): TreeNode => {
    const node: TreeNode = {
      item,
      rate,
      recipe: null,
      machines: 0,
      power: 0,
      byproducts: [],
      children: [],
      depth,
    }

    const leaf = isLeaf(item)
    if (leaf) {
      node.leafReason = leaf
      return node
    }

    if (path.has(item)) {
      node.leafReason = 'cycle'
      if (!reportedCycles.has(item)) {
        reportedCycles.add(item)
        warnings.push(
          `${item} feeds back into its own production chain; that branch is shown as an ` +
            'input rather than expanded further.',
        )
      }
      return node
    }

    const recipe = recipeFor(item)
    if (!recipe) {
      node.leafReason = 'no-recipe'
      return node
    }

    const perMachine = outputPerMachine(recipe, item)
    if (perMachine <= EPSILON) {
      node.leafReason = 'no-recipe'
      return node
    }

    node.recipe = recipe
    node.machines = rate / perMachine
    node.power = node.machines * powerAtClock(basePower(recipe), 1, 0, recipe.machine)
    node.byproducts = recipe.products
      .filter((p) => p.item !== item)
      .map((p) => ({ item: p.item, rate: node.machines * outputPerMachine(recipe, p.item) }))

    const nextPath = new Set(path).add(item)
    node.children = recipe.ingredients.map((ingredient) => {
      const grossRate = node.machines * inputPerMachine(recipe, ingredient.item)
      const factor = netFactor(ingredient.item)
      const child = build(ingredient.item, grossRate * factor, nextPath, depth + 1)
      if (factor < 1 - EPSILON) {
        child.grossRate = grossRate
        child.creditedRate = grossRate - child.rate
      }
      return child
    })

    return node
  }

  return build(target, targetRate, new Set(), 0)
}

/** Alternate recipes that would cut raw resource use for the current plan. */
export interface AlternateSuggestion {
  recipe: Recipe
  item: ItemId
  /** Percentage change in total raw resource units per minute. Negative is an improvement. */
  rawChange: number
  powerChange: number
}

/**
 * Compares the current plan against swapping in each locked or unused alternate,
 * so you can see which hard drive would actually be worth chasing.
 */
export function suggestAlternates(
  result: SolveResult,
  options: SolveOptions = {},
): AlternateSuggestion[] {
  const baselineRaw = totalOf(result.rawResources)
  const suggestions: AlternateSuggestion[] = []

  // Only items actually produced in the plan are worth re-evaluating.
  const producedItems = new Set(result.steps.map((s) => s.recipe.products[0]?.item ?? ''))

  for (const item of producedItems) {
    if (!item) continue
    const current = result.steps.find((s) => s.recipe.products[0]?.item === item)?.recipe
    for (const candidate of recipesByProduct.get(item) ?? []) {
      if (!candidate.alternate || candidate.className === current?.className) continue
      if (candidate.products[0]?.item !== item) continue

      const trial = solve(result.target, result.targetRate, {
        ...options,
        // Ignore unlock state: the point is to reveal what a new alternate would buy.
        unlocked: undefined,
        recipeChoices: { ...options.recipeChoices, [item]: candidate.className },
      })

      const rawChange = percentChange(baselineRaw, totalOf(trial.rawResources))
      const powerChange = percentChange(result.totalPower, trial.totalPower)
      if (rawChange < -0.5) {
        suggestions.push({ recipe: candidate, item, rawChange, powerChange })
      }
    }
  }

  return suggestions.sort((a, b) => a.rawChange - b.rawChange)
}

function totalOf(map: ReadonlyMap<ItemId, number>): number {
  let sum = 0
  for (const value of map.values()) sum += value
  return sum
}

function percentChange(from: number, to: number): number {
  if (from <= EPSILON) return 0
  return ((to - from) / from) * 100
}
