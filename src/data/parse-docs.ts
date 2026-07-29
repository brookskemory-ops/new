/**
 * Parses the `Docs.json` / `en-US.json` file that ships with Satisfactory into
 * the slim dataset this app uses.
 *
 * Pure TypeScript with no Node APIs, so the same code serves the build script,
 * the browser file picker and the desktop app.
 *
 * The game writes these files UTF-16 encoded, nests everything as
 * `[{ NativeClass, Classes: [...] }]`, and stores structured values as Unreal
 * property strings like `((ItemClass="…Desc_IronIngot_C",Amount=3))`.
 */
import type { GameData, ItemId, Recipe, RecipeId, Stack } from './types'

/** Native classes we read, grouped by what they become. */
const RECIPE_CLASS = 'FGRecipe'
const SCHEMATIC_CLASS = 'FGSchematic'

const ITEM_CLASSES = [
  'FGItemDescriptor',
  'FGResourceDescriptor',
  'FGItemDescriptorBiomass',
  'FGItemDescriptorNuclearFuel',
  'FGItemDescriptorPowerBoosterFuel',
  'FGConsumableDescriptor',
  'FGEquipmentDescriptor',
  'FGPowerShardDescriptor',
  'FGAmmoTypeProjectile',
  'FGAmmoTypeInstantHit',
  'FGAmmoTypeSpreadshot',
]

const MACHINE_CLASSES = ['FGBuildableManufacturer', 'FGBuildableManufacturerVariablePower']

const GENERATOR_CLASSES = ['FGBuildableGeneratorFuel', 'FGBuildableGeneratorNuclear']

const EXTRACTOR_CLASSES = [
  'FGBuildableResourceExtractor',
  'FGBuildableWaterPump',
  'FGBuildableFrackingExtractor',
]

const SUPPORT_CLASSES = ['FGBuildableWaterPump', 'FGBuildableFrackingActivator']

/** `mStackSize` is an enum rather than a number. */
const STACK_SIZES: Record<string, number> = {
  SS_ONE: 1,
  SS_SMALL: 50,
  SS_MEDIUM: 100,
  SS_BIG: 200,
  SS_HUGE: 500,
  SS_FLUID: 50_000,
}

/**
 * Fluids are stored in litres throughout the docs while the game's UI — and this
 * app — works in cubic metres.
 */
const LITRES_PER_CUBIC_METRE = 1000

/** Raw resources cannot be crafted; the docs do not flag them, so we list them. */
const RAW_RESOURCES: ItemId[] = [
  'Desc_OreIron_C',
  'Desc_OreCopper_C',
  'Desc_Stone_C',
  'Desc_Coal_C',
  'Desc_OreGold_C',
  'Desc_RawQuartz_C',
  'Desc_Sulfur_C',
  'Desc_OreBauxite_C',
  'Desc_OreUranium_C',
  'Desc_LiquidOil_C',
  'Desc_NitrogenGas_C',
  'Desc_Water_C',
  'Desc_SAM_C',
]

interface DocsEntry {
  ClassName?: string
  [key: string]: unknown
}

interface DocsGroup {
  NativeClass: string
  Classes: DocsEntry[]
}

export class DocsParseError extends Error {}

// ---------------------------------------------------------------------------
// Unreal property string parsing
// ---------------------------------------------------------------------------

/**
 * Pulls the class name out of an Unreal object reference.
 *
 * These arrive in several shapes depending on the field and game version, e.g.
 * `"/Script/Engine.BlueprintGeneratedClass'/Game/…/Desc_IronIngot.Desc_IronIngot_C'"`
 * or a bare `/Game/…/Build_ConstructorMk1.Build_ConstructorMk1_C`. In every case
 * the part after the final full stop is what we want.
 */
export function classNameOf(reference: string): string {
  const cleaned = reference.trim().replace(/^"|"$/g, '').replace(/'$/, '')
  const tail = cleaned.split('.').pop() ?? cleaned
  return tail.replace(/["')\s]+$/g, '')
}

/**
 * Parses an ingredient or product list.
 *
 * The value looks like
 * `((ItemClass="…Desc_IronIngot_C",Amount=3),(ItemClass="…Desc_Water_C",Amount=1000))`.
 * Rather than write a full grammar we match each `ItemClass`/`Amount` pair, which
 * survives the quoting and nesting variations between game versions.
 */
export function parseStacks(value: unknown, isFluid: (item: ItemId) => boolean): Stack[] {
  if (typeof value !== 'string' || value.trim() === '') return []

  const stacks: Stack[] = []
  const pattern = /ItemClass\s*=\s*(.+?)\s*,\s*Amount\s*=\s*([0-9.eE+-]+)/g

  for (const match of value.matchAll(pattern)) {
    const item = classNameOf(match[1] ?? '')
    const amount = Number.parseFloat(match[2] ?? '')
    if (!item || !Number.isFinite(amount)) continue
    stacks.push({
      item,
      amount: isFluid(item) ? amount / LITRES_PER_CUBIC_METRE : amount,
    })
  }

  return stacks
}

/** Parses `mProducedIn`, a parenthesised list of building references. */
export function parseProducedIn(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((part) => classNameOf(part))
    .filter((name) => name.startsWith('Build_'))
}

/** Reads an enum-valued field, e.g. `EResourceForm::RF_LIQUID` -> `RF_LIQUID`. */
export function parseEnum(value: unknown): string {
  if (typeof value !== 'string') return ''
  const tail = value.split('::').pop() ?? ''
  // Enums inside a list arrive wrapped in the list's parentheses.
  return tail.replace(/[()"'\s]/g, '')
}

/**
 * Reads a list of enums such as `(EResourceForm::RF_LIQUID,EResourceForm::RF_GAS)`.
 * Splitting on the comma has to happen before the `::`, or every entry but the
 * last is lost.
 */
export function parseEnumList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => parseEnum(entry)).filter(Boolean)
  if (typeof value !== 'string') return []
  return value
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((part) => parseEnum(part))
    .filter(Boolean)
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// ---------------------------------------------------------------------------
// Document parsing
// ---------------------------------------------------------------------------

/** Groups the docs by native class, tolerating the long `/Script/…` prefixes. */
function groupByNativeClass(raw: unknown): Map<string, DocsEntry[]> {
  if (!Array.isArray(raw)) {
    throw new DocsParseError(
      'Expected the docs file to be a JSON array of { NativeClass, Classes } groups. ' +
        'Check you selected en-US.json from the game\'s CommunityResources/Docs folder.',
    )
  }

  const groups = new Map<string, DocsEntry[]>()
  for (const group of raw as DocsGroup[]) {
    if (!group || typeof group.NativeClass !== 'string' || !Array.isArray(group.Classes)) continue
    const name = classNameOf(group.NativeClass)
    const existing = groups.get(name)
    if (existing) existing.push(...group.Classes)
    else groups.set(name, [...group.Classes])
  }

  if (groups.size === 0) {
    throw new DocsParseError('No recognisable class groups found in the docs file.')
  }
  return groups
}

/**
 * Turns the game's docs into the slim dataset.
 *
 * @param text Decoded file contents. Callers handle the UTF-16 decoding, since
 *   how you read bytes differs between Node, the browser and the desktop shell.
 * @param gameVersion Version label to stamp on the output.
 */
export function parseDocs(text: string, gameVersion = 'unknown'): GameData {
  let raw: unknown
  try {
    // A UTF-8 or UTF-16 BOM left in place would break JSON.parse.
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch (error) {
    throw new DocsParseError(
      `The docs file is not valid JSON (${(error as Error).message}). ` +
        'If you copied it out of the game folder, make sure it was not truncated.',
    )
  }

  const groups = groupByNativeClass(raw)
  const entriesFor = (names: string[]): DocsEntry[] => {
    const seen = new Set<string>()
    const entries: DocsEntry[] = []
    for (const name of names) {
      for (const entry of groups.get(name) ?? []) {
        const className = str(entry.ClassName)
        if (!className || isDefaultObject(className) || seen.has(className)) continue
        seen.add(className)
        entries.push(entry)
      }
    }
    return entries
  }

  // Items first: recipes need to know which are fluids to convert their amounts.
  const itemEntries = entriesFor(ITEM_CLASSES)
  const fluidItems = new Set<ItemId>()
  for (const entry of itemEntries) {
    const form = parseEnum(entry.mForm)
    if (form === 'RF_LIQUID' || form === 'RF_GAS') fluidItems.add(str(entry.ClassName))
  }
  const isFluid = (item: ItemId): boolean => fluidItems.has(item)

  const items = itemEntries
    .filter((entry) => str(entry.ClassName))
    .map((entry) => {
      const className = str(entry.ClassName)
      return {
        className,
        name: str(entry.mDisplayName) || className,
        slug: slugify(str(entry.mDisplayName) || className),
        sinkPoints: Math.max(0, num(entry.mResourceSinkPoints)),
        stackSize: STACK_SIZES[parseEnum(entry.mStackSize)] ?? 0,
        energyValue: num(entry.mEnergyValue),
        liquid: fluidItems.has(className),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const machineEntries = entriesFor(MACHINE_CLASSES)
  // Keyed by the docs' Build_ id, since that is what mProducedIn references.
  const machineBuildIds = new Set(machineEntries.map((entry) => str(entry.ClassName)))

  // Recipes made in a production building. Hand and build recipes are dropped:
  // the planner only models automated production.
  const recipes: Recipe[] = []
  for (const entry of groups.get(RECIPE_CLASS) ?? []) {
    const className = str(entry.ClassName)
    const producedIn = parseProducedIn(entry.mProducedIn).filter((id) => machineBuildIds.has(id))
    if (!className || producedIn.length === 0) continue

    const ingredients = parseStacks(entry.mIngredients, isFluid)
    const products = parseStacks(entry.mProduct, isFluid)
    const time = num(entry.mManufactoringDuration)
    if (products.length === 0 || time <= 0) continue

    const name = str(entry.mDisplayName) || className
    const constant = num(entry.mVariablePowerConsumptionConstant)
    const factor = num(entry.mVariablePowerConsumptionFactor)

    recipes.push({
      className,
      name,
      slug: slugify(name),
      alternate: className.includes('Alternate') || name.startsWith('Alternate:'),
      time,
      machine: toDescriptorId(producedIn[0]!),
      ingredients,
      products,
      // Variable-power machines cycle between these bounds rather than drawing a
      // flat figure, so both ends are carried through.
      ...(factor > 0 ? { minPower: constant, maxPower: constant + factor } : {}),
    })
  }
  recipes.sort((a, b) => a.className.localeCompare(b.className))

  const usedMachines = new Set(recipes.map((r) => r.machine))
  const machines = machineEntries
    .filter((entry) => usedMachines.has(toDescriptorId(str(entry.ClassName))))
    .map((entry) => {
      const className = toDescriptorId(str(entry.ClassName))
      return {
        className,
        name: str(entry.mDisplayName) || className,
        slug: slugify(str(entry.mDisplayName) || className),
        powerConsumption: num(entry.mPowerConsumption),
        powerExponent: num(entry.mPowerConsumptionExponent, 1.321929) || 1.321929,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const generators = entriesFor(GENERATOR_CLASSES)
    .map((entry) => {
      const className = toDescriptorId(str(entry.ClassName))
      return {
        className,
        name: str(entry.mDisplayName) || className,
        fuel: parseFuelClasses(entry.mDefaultFuelClasses),
        powerProduction: num(entry.mPowerProduction),
        powerExponent: num(entry.mPowerProductionExponent, 1.3) || 1.3,
        waterToPowerRatio: num(entry.mSupplementalToPowerRatio),
      }
    })
    .filter((g) => g.powerProduction > 0 && g.fuel.length > 0)
    .sort((a, b) => a.powerProduction - b.powerProduction)

  const miners = entriesFor(EXTRACTOR_CLASSES)
    .map((entry) => {
      const className = toDescriptorId(str(entry.ClassName))
      const forms = parseEnumList(entry.mAllowedResourceForms)
      const cycleTime = num(entry.mExtractCycleTime)
      const perCycle = num(entry.mItemsPerCycle)
      return {
        className,
        name: str(entry.mDisplayName) || className,
        allowedResources: parseAllowedResources(entry.mAllowedResources),
        allowLiquids: forms.includes('RF_LIQUID') || forms.includes('RF_GAS'),
        allowSolids: forms.includes('RF_SOLID'),
        itemsPerMinute: cycleTime > 0 ? (perCycle / cycleTime) * 60 : 0,
        powerConsumption: num(entry.mPowerConsumption),
      }
    })
    .filter((m) => m.itemsPerMinute > 0)

  const supportBuildings = entriesFor(SUPPORT_CLASSES)
    .map((entry) => ({
      className: toDescriptorId(str(entry.ClassName)),
      name: str(entry.mDisplayName) || str(entry.ClassName),
      powerConsumption: num(entry.mPowerConsumption),
    }))
    .filter((b) => b.className)

  const recipeIds = new Set(recipes.map((r) => r.className))
  const schematics = (groups.get(SCHEMATIC_CLASS) ?? [])
    .map((entry) => {
      const type = parseEnum(entry.mType)
      const className = str(entry.ClassName)
      return {
        className,
        name: str(entry.mDisplayName) || className,
        slug: slugify(str(entry.mDisplayName) || className),
        kind:
          type === 'EST_Milestone'
            ? ('milestone' as const)
            : type === 'EST_Alternate'
              ? ('alternate' as const)
              : ('mam' as const),
        tier: num(entry.mTechTier),
        recipes: parseUnlockedRecipes(entry.mUnlocks).filter((id) => recipeIds.has(id)),
        cost: parseStacks(entry.mCost, isFluid),
        type,
      }
    })
    .filter(
      (s) =>
        s.recipes.length > 0 &&
        (s.type === 'EST_Milestone' || s.type === 'EST_Alternate' || s.type === 'EST_MAM'),
    )
    .map(({ type: _type, ...rest }) => rest)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))

  const knownItems = new Set(items.map((i) => i.className))

  return {
    gameVersion,
    source: 'Game docs file',
    items,
    recipes,
    machines,
    schematics,
    generators,
    miners,
    supportBuildings,
    resources: RAW_RESOURCES.filter((id) => knownItems.has(id)),
  }
}

/** `mDefaultFuelClasses` is a parenthesised list of item references. */
function parseFuelClasses(value: unknown): ItemId[] {
  if (typeof value !== 'string') return []
  return value
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((part) => classNameOf(part))
    .filter((name) => name.startsWith('Desc_'))
}

function parseAllowedResources(value: unknown): ItemId[] {
  if (typeof value !== 'string') return []
  return value
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((part) => classNameOf(part))
    .filter((name) => name.startsWith('Desc_'))
}

/** Unlock entries carry a `mRecipes` list of recipe references. */
function parseUnlockedRecipes(value: unknown): RecipeId[] {
  if (typeof value !== 'string') return []
  const found: RecipeId[] = []
  for (const match of value.matchAll(/Recipe[A-Za-z0-9_]*_C/g)) {
    const name = match[0]
    if (name.startsWith('Recipe_') && !found.includes(name)) found.push(name)
  }
  return found
}

/**
 * Buildings appear in the docs as `Build_ConstructorMk1_C`, but the rest of this
 * app refers to them by their descriptor name, `Desc_ConstructorMk1_C`. Keeping
 * the descriptor form means the engine, the Somersloop slot table and every saved
 * plan carry on working unchanged.
 */
function toDescriptorId(buildId: string): string {
  return buildId.startsWith('Build_') ? `Desc_${buildId.slice('Build_'.length)}` : buildId
}

/**
 * The docs include Unreal's class-default objects alongside the real entries.
 * They duplicate everything and would double every count.
 */
function isDefaultObject(className: string): boolean {
  return className.startsWith('Default__')
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Sanity-checks a parsed dataset before anything relies on it, so a format change
 * fails loudly instead of quietly producing a tool that computes nonsense.
 */
export function validateGameData(data: GameData): string[] {
  const problems: string[] = []

  if (data.items.length < 100) problems.push(`Only ${data.items.length} items found, expected 100+.`)
  if (data.recipes.length < 200) {
    problems.push(`Only ${data.recipes.length} machine recipes found, expected 200+.`)
  }
  if (data.machines.length < 8) {
    problems.push(`Only ${data.machines.length} production machines found, expected 8+.`)
  }
  if (data.generators.length < 3) {
    problems.push(`Only ${data.generators.length} generators found, expected 3+.`)
  }
  if (data.miners.length < 3) {
    problems.push(`Only ${data.miners.length} extractors found, expected 3+.`)
  }
  if (data.resources.length < 10) {
    problems.push(`Only ${data.resources.length} raw resources found, expected 10+.`)
  }
  if (data.schematics.length < 50) {
    problems.push(`Only ${data.schematics.length} unlock schematics found, expected 50+.`)
  }

  // A handful of values that have been stable since 1.0. If these drift, the
  // parser is misreading fields rather than the game having been rebalanced.
  const constructor = data.machines.find((m) => m.className === 'Desc_ConstructorMk1_C')
  if (!constructor) problems.push('Constructor not found.')
  else if (Math.abs(constructor.powerConsumption - 4) > 0.01) {
    problems.push(`Constructor draws ${constructor.powerConsumption} MW, expected 4.`)
  }

  const ironPlate = data.recipes.find((r) => r.className === 'Recipe_IronPlate_C')
  if (!ironPlate) problems.push('Iron Plate recipe not found.')
  else {
    if (Math.abs(ironPlate.time - 6) > 0.01) {
      problems.push(`Iron Plate takes ${ironPlate.time}s, expected 6.`)
    }
    if (Math.abs((ironPlate.ingredients[0]?.amount ?? 0) - 3) > 0.01) {
      problems.push('Iron Plate should consume 3 Iron Ingots.')
    }
    if (Math.abs((ironPlate.products[0]?.amount ?? 0) - 2) > 0.01) {
      problems.push('Iron Plate should produce 2 plates.')
    }
  }

  const coal = data.generators.find((g) => g.className === 'Desc_GeneratorCoal_C')
  if (!coal) problems.push('Coal Generator not found.')
  else if (Math.abs(coal.powerProduction - 75) > 0.01) {
    problems.push(`Coal Generator produces ${coal.powerProduction} MW, expected 75.`)
  }

  // Fluid amounts are the easiest thing to get wrong by a factor of 1000.
  const plastic = data.recipes.find((r) => r.className === 'Recipe_Plastic_C')
  if (plastic) {
    const oil = plastic.ingredients.find((i) => i.item === 'Desc_LiquidOil_C')
    if (!oil || Math.abs(oil.amount - 3) > 0.01) {
      problems.push(
        `Plastic should consume 3 m³ of Crude Oil per craft, got ${oil?.amount ?? 'nothing'}. ` +
          'Fluid amounts may not have been converted from litres.',
      )
    }
  }

  return problems
}
