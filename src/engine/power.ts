/**
 * Generator sizing and the fuel chains that feed them.
 */
import { gameData, itemsById } from '../data/constants'
import type { Generator, ItemId } from '../data/types'
import { solve } from './solve'
import type { SolveOptions } from './solve'

/**
 * Supplemental water is stored as a per-MW ratio. The game consumes
 * `power * ratio` per second in thousandths of a m³, so m³/min is
 * `power * ratio * 60 / 1000`.
 */
const WATER_RATIO_TO_M3_PER_MIN = 0.06

/** Water in m³/min a generator needs at 100% clock. */
export function waterPerMinute(generator: Generator, clock = 1): number {
  if (generator.waterToPowerRatio <= 0) return 0
  return generator.powerProduction * clock * generator.waterToPowerRatio * WATER_RATIO_TO_M3_PER_MIN
}

/**
 * Fuel burned per minute by one generator.
 *
 * Burn rate is simply power divided by the fuel's energy content: a 75 MW Coal
 * Generator on 300 MJ coal burns 75/300 * 60 = 15 coal/min.
 */
export function fuelPerMinute(generator: Generator, fuel: ItemId, clock = 1): number {
  const energy = itemsById.get(fuel)?.energyValue ?? 0
  if (energy <= 0) return 0
  return ((generator.powerProduction * clock) / energy) * 60
}

export interface GeneratorPlan {
  generator: Generator
  fuel: ItemId
  /** Whole generators to build. */
  count: number
  /** Clock speed for all of them, chosen so output matches the target exactly. */
  clock: number
  /** MW actually produced. */
  power: number
  fuelRate: number
  waterRate: number
  /** Byproduct produced per minute, e.g. Uranium Waste from nuclear fuel rods. */
  byproducts: { item: ItemId; rate: number }[]
}

/** Byproducts generators emit per unit of fuel burned. Not present in the upstream data. */
const GENERATOR_BYPRODUCTS: Record<ItemId, { item: ItemId; perFuel: number }> = {
  Desc_NuclearFuelRod_C: { item: 'Desc_NuclearWaste_C', perFuel: 50 },
  Desc_PlutoniumFuelRod_C: { item: 'Desc_PlutoniumWaste_C', perFuel: 10 },
}

/**
 * How many generators of a given type it takes to hit a target MW, and what
 * feeding them costs. Generators are underclocked evenly rather than left to run
 * at partial load, which is how you get an exact match with no wasted fuel.
 */
export function planGenerators(
  generator: Generator,
  fuel: ItemId,
  targetMW: number,
): GeneratorPlan {
  const exact = targetMW / generator.powerProduction
  const count = Math.max(1, Math.ceil(exact - 1e-9))
  const clock = exact / count

  const fuelRate = fuelPerMinute(generator, fuel, clock) * count
  const byproduct = GENERATOR_BYPRODUCTS[fuel]

  return {
    generator,
    fuel,
    count,
    clock,
    power: generator.powerProduction * clock * count,
    fuelRate,
    waterRate: waterPerMinute(generator, clock) * count,
    byproducts: byproduct ? [{ item: byproduct.item, rate: fuelRate * byproduct.perFuel }] : [],
  }
}

export interface FuelChain {
  plan: GeneratorPlan
  /** The factory needed to produce the fuel, when it is not a raw resource. */
  production: ReturnType<typeof solve> | null
  /** Total water including both the generators and the fuel factory. */
  totalWater: number
  /** MW the fuel factory itself consumes, which eats into the net output. */
  factoryPower: number
  /** Power actually available to the rest of the base. */
  netPower: number
}

/**
 * The full picture for a power plant: generators, the factory that feeds them,
 * and the net power left after that factory takes its cut.
 */
export function planFuelChain(
  generator: Generator,
  fuel: ItemId,
  targetMW: number,
  options: SolveOptions = {},
): FuelChain {
  const plan = planGenerators(generator, fuel, targetMW)

  const isRawFuel = gameData.resources.includes(fuel)
  const production = isRawFuel || plan.fuelRate <= 0 ? null : solve(fuel, plan.fuelRate, options)

  const factoryWater = production?.rawResources.get('Desc_Water_C') ?? 0
  const factoryPower = production?.totalPower ?? 0

  return {
    plan,
    production,
    totalWater: plan.waterRate + factoryWater,
    factoryPower,
    netPower: plan.power - factoryPower,
  }
}

/** Generators that can burn a given fuel. */
export function generatorsForFuel(fuel: ItemId): Generator[] {
  return gameData.generators.filter((g) => g.fuel.includes(fuel))
}

/** Every fuel any generator accepts, deduplicated. */
export function allFuels(): ItemId[] {
  const fuels = new Set<ItemId>()
  for (const generator of gameData.generators) {
    for (const fuel of generator.fuel) fuels.add(fuel)
  }
  return [...fuels]
}
