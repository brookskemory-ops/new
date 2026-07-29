/**
 * Downloads the community Satisfactory data dump and slims it to the fields this
 * app actually uses, writing `src/data/game-data.json` (~100 KB instead of 1.7 MB).
 *
 * The output is committed to the repo, so neither CI nor the browser ever needs
 * network access. Re-run with `npm run build:data` when the upstream data updates.
 *
 * Source: https://github.com/greeny/SatisfactoryTools (MIT). Only the numeric game
 * data is used here; the upstream image assets are copyrighted by Coffee Stain
 * Studios and are deliberately not vendored.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SOURCE_URL =
  'https://raw.githubusercontent.com/greeny/SatisfactoryTools/master/data/data1.0.json'
const GAME_VERSION = '1.0'

const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/game-data.json')

/** Shape of the upstream dump — only the parts we read. */
interface RawStack {
  item: string
  amount: number
}
interface RawItem {
  slug: string
  name: string
  description: string
  sinkPoints: number
  className: string
  stackSize: number
  energyValue: number
  liquid: boolean
}
interface RawRecipe {
  slug: string
  name: string
  className: string
  alternate: boolean
  time: number
  forBuilding: boolean
  inMachine: boolean
  ingredients: RawStack[]
  products: RawStack[]
  producedIn: string[]
  isVariablePower: boolean
  minPower: number
  maxPower: number
}
interface RawBuilding {
  slug: string
  name: string
  className: string
  metadata?: {
    powerConsumption?: number
    powerConsumptionExponent?: number
    manufacturingSpeed?: number
  }
}
interface RawSchematic {
  className: string
  type: string
  name: string
  slug: string
  cost: RawStack[]
  unlock: { recipes: string[] }
  tier: number
}
interface RawGenerator {
  className: string
  fuel: string[]
  powerProduction: number
  powerProductionExponent: number
  waterToPowerRatio: number
}
interface RawMiner {
  className: string
  allowedResources: string[]
  allowLiquids: boolean
  allowSolids: boolean
  itemsPerCycle: number
  extractCycleTime: number
}
interface RawData {
  items: Record<string, RawItem>
  recipes: Record<string, RawRecipe>
  buildings: Record<string, RawBuilding>
  schematics: Record<string, RawSchematic>
  generators: Record<string, RawGenerator>
  miners: Record<string, RawMiner>
  resources: Record<string, { item: string; speed: number }>
}

async function main(): Promise<void> {
  console.log(`Fetching ${SOURCE_URL} ...`)
  const response = await fetch(SOURCE_URL)
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }
  const raw = (await response.json()) as RawData

  // Recipes that a machine can actually run. Building/hand recipes are dropped:
  // the planner only cares about automated production.
  const recipes = Object.values(raw.recipes)
    .filter((r) => r.inMachine && !r.forBuilding && r.producedIn.length > 0)
    .map((r) => ({
      className: r.className,
      name: r.name,
      slug: r.slug,
      alternate: r.alternate,
      // Seconds per craft at 100% clock.
      time: r.time,
      machine: r.producedIn[0]!,
      ingredients: r.ingredients.map((i) => ({ item: i.item, amount: i.amount })),
      products: r.products.map((p) => ({ item: p.item, amount: p.amount })),
      // Converter / Particle Accelerator / Quantum Encoder draw a power range that
      // depends on the recipe rather than a flat figure on the building.
      ...(r.isVariablePower ? { minPower: r.minPower, maxPower: r.maxPower } : {}),
    }))
    .sort((a, b) => a.className.localeCompare(b.className))

  // Only keep items that appear somewhere in a machine recipe, plus raw resources.
  const usedItems = new Set<string>(Object.values(raw.resources).map((r) => r.item))
  for (const recipe of recipes) {
    for (const { item } of recipe.ingredients) usedItems.add(item)
    for (const { item } of recipe.products) usedItems.add(item)
  }
  for (const generator of Object.values(raw.generators)) {
    for (const fuel of generator.fuel) usedItems.add(fuel)
  }

  const items = Object.values(raw.items)
    .filter((i) => usedItems.has(i.className))
    .map((i) => ({
      className: i.className,
      name: i.name,
      slug: i.slug,
      sinkPoints: i.sinkPoints,
      stackSize: i.stackSize,
      energyValue: i.energyValue,
      liquid: i.liquid,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Machines referenced by at least one recipe, with their power draw.
  const machineIds = new Set(recipes.map((r) => r.machine))
  const machines = Object.values(raw.buildings)
    .filter((b) => machineIds.has(b.className))
    .map((b) => ({
      className: b.className,
      name: b.name,
      slug: b.slug,
      powerConsumption: b.metadata?.powerConsumption ?? 0,
      powerExponent: b.metadata?.powerConsumptionExponent || 1.321929,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Schematics drive unlock tracking: milestones and alternate recipe research.
  const buildingNames = new Map(
    Object.values(raw.buildings).map((b) => [b.className, b.name] as const),
  )
  const schematics = Object.values(raw.schematics)
    .filter(
      (s) =>
        (s.type === 'EST_Milestone' || s.type === 'EST_Alternate' || s.type === 'EST_MAM') &&
        s.unlock.recipes.length > 0,
    )
    .map((s) => ({
      className: s.className,
      name: s.name,
      slug: s.slug,
      kind:
        s.type === 'EST_Milestone'
          ? ('milestone' as const)
          : s.type === 'EST_Alternate'
            ? ('alternate' as const)
            : ('mam' as const),
      tier: s.tier,
      recipes: s.unlock.recipes,
      cost: s.cost.map((c) => ({ item: c.item, amount: c.amount })),
    }))
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))

  const generators = Object.values(raw.generators)
    .map((g) => ({
      className: g.className,
      name: buildingNames.get(g.className) ?? g.className,
      fuel: g.fuel,
      powerProduction: g.powerProduction,
      powerExponent: g.powerProductionExponent,
      waterToPowerRatio: g.waterToPowerRatio,
    }))
    .sort((a, b) => a.powerProduction - b.powerProduction)

  const buildingPower = new Map(
    Object.values(raw.buildings).map(
      (b) => [b.className, b.metadata?.powerConsumption ?? 0] as const,
    ),
  )

  const miners = Object.values(raw.miners).map((m) => ({
    className: m.className,
    name: buildingNames.get(m.className) ?? m.className,
    allowedResources: m.allowedResources,
    allowLiquids: m.allowLiquids,
    allowSolids: m.allowSolids,
    // Extraction rate per minute at 100% clock on a normal-purity node.
    itemsPerMinute: (m.itemsPerCycle / m.extractCycleTime) * 60,
    // Taken from the data rather than a hand-written table: the Resource Well
    // Extractor really does draw 0 MW, with its 150 MW sitting on the Pressurizer.
    powerConsumption: buildingPower.get(m.className) ?? 0,
  }))

  // Extractors that feed or support miners but run no recipe of their own.
  const SUPPORT_BUILDINGS = ['Desc_WaterPump_C', 'Desc_FrackingSmasher_C']
  const supportBuildings = Object.values(raw.buildings)
    .filter((b) => SUPPORT_BUILDINGS.includes(b.className))
    .map((b) => ({
      className: b.className,
      name: b.name,
      powerConsumption: b.metadata?.powerConsumption ?? 0,
    }))

  const resources = Object.values(raw.resources).map((r) => r.item)

  const output = {
    gameVersion: GAME_VERSION,
    source: SOURCE_URL,
    items,
    recipes,
    machines,
    schematics,
    generators,
    miners,
    supportBuildings,
    resources,
  }

  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 0)}\n`)

  const kb = Math.round(JSON.stringify(output).length / 1024)
  console.log(
    `Wrote ${OUT_PATH}\n` +
      `  ${items.length} items, ${recipes.length} recipes ` +
      `(${recipes.filter((r) => r.alternate).length} alternate), ${machines.length} machines,\n` +
      `  ${schematics.length} schematics, ${generators.length} generators, ` +
      `${miners.length} miners, ${resources.length} raw resources — ${kb} KB`,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
