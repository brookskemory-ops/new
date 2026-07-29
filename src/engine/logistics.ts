/**
 * Belts, pipes, miners and splitter ratios.
 */
import { BELTS, PIPES, PURITY, gameData, itemsById } from '../data/constants'
import type { BeltTier, Purity } from '../data/constants'
import type { ItemId, Miner, SupportBuilding } from '../data/types'
import { POWER_EXPONENT } from '../data/constants'

export interface ThroughputPlan {
  /** The cheapest tier that carries the whole rate on one line, if one exists. */
  singleLine: BeltTier | null
  /** How many lines of each tier the rate needs. */
  perTier: { tier: BeltTier; lines: number; utilisation: number }[]
  liquid: boolean
}

/**
 * Which belt or pipe tier to run, and how many lines, for a given rate.
 * Liquids use pipes and are measured in m³/min.
 */
export function planThroughput(rate: number, liquid: boolean): ThroughputPlan {
  const tiers = liquid ? PIPES : BELTS
  const perTier = tiers.map((tier) => {
    const lines = rate <= 0 ? 0 : Math.ceil(rate / tier.rate - 1e-9)
    return {
      tier,
      lines,
      utilisation: lines > 0 ? rate / (lines * tier.rate) : 0,
    }
  })
  const singleLine = tiers.find((tier) => rate <= tier.rate + 1e-9) ?? null
  return { singleLine, perTier, liquid }
}

/** True when an item travels by pipe rather than belt. */
export function isLiquid(item: ItemId): boolean {
  return itemsById.get(item)?.liquid ?? false
}

export interface MinerOutput {
  miner: Miner
  purity: Purity
  clock: number
  /** Extraction per minute — items for ore, m³ for liquids. */
  rate: number
  /** MW drawn at this clock. */
  power: number
  /** Belt tier needed to carry the output, null if even Mk.6 cannot. */
  belt: BeltTier | null
  /** Set when output exceeds what the chosen belt tier can carry. */
  overflow?: string
}

/**
 * Extraction rate for a node, given the miner tier, node purity and clock speed —
 * and whether the belt you plan to use can actually keep up.
 */
export function minerOutput(
  miner: Miner,
  purity: Purity,
  clock = 1,
  beltTier?: BeltTier,
): MinerOutput {
  // Liquid extractors report thousandths of a m³ per minute.
  const base = miner.allowLiquids ? miner.itemsPerMinute / 1000 : miner.itemsPerMinute
  const rate = base * PURITY[purity] * clock

  const tiers = miner.allowLiquids ? PIPES : BELTS
  const belt = beltTier ?? tiers.find((tier) => rate <= tier.rate + 1e-9) ?? null

  const power = miner.powerConsumption * Math.pow(clock, POWER_EXPONENT)

  return {
    miner,
    purity,
    clock,
    rate,
    power,
    belt,
    overflow:
      belt && rate > belt.rate + 1e-9
        ? `${round(rate)}/min exceeds ${belt.name} (${belt.rate}/min) — ${round(rate - belt.rate)}/min would back up.`
        : undefined,
  }
}

/**
 * The building that actually pays the power bill for an extractor that reports
 * none of its own. A Resource Well is one 150 MW Pressurizer driving several
 * free Extractors, so quoting the Extractor alone understates the well.
 */
export function supportBuildingFor(miner: Miner): SupportBuilding | null {
  if (miner.className !== 'Desc_FrackingExtractor_C') return null
  return gameData.supportBuildings.find((b) => b.className === 'Desc_FrackingSmasher_C') ?? null
}

/** Solid-ore miners, ordered by tier. */
export function solidMiners(): Miner[] {
  return gameData.miners.filter((m) => m.allowSolids).sort((a, b) => a.itemsPerMinute - b.itemsPerMinute)
}

/** Liquid extractors, ordered by rate. */
export function liquidExtractors(): Miner[] {
  return gameData.miners.filter((m) => m.allowLiquids).sort((a, b) => a.itemsPerMinute - b.itemsPerMinute)
}

export interface SplitPlan {
  /** Input rate being divided. */
  input: number
  /** Number of equal outputs requested. */
  ways: number
  /** Rate on each output. */
  perOutput: number
  /** How to build it out of 2- and 3-way splitters. */
  recipe: string
  /** True when the split needs no smart splitters or looping back. */
  clean: boolean
}

/**
 * Even splits are cheap when the divisor factors into 2s and 3s, and awkward
 * otherwise — a 5-way split needs a loop-back, which is worth knowing before you
 * build it.
 */
export function planSplit(input: number, ways: number): SplitPlan {
  const perOutput = ways > 0 ? input / ways : 0
  const factors = factorise(ways)
  const clean = factors !== null

  const recipe = clean
    ? describeFactors(factors)
    : `${ways}-way needs a balancer: split into ${ways} and merge the remainder back into the input ` +
      `(no combination of 2- and 3-way splitters divides evenly by ${ways}).`

  return { input, ways, perOutput, recipe, clean }
}

/** Breaks a number into 2s and 3s, or returns null if it has another prime factor. */
function factorise(n: number): { twos: number; threes: number } | null {
  if (n < 1 || !Number.isInteger(n)) return null
  let value = n
  let twos = 0
  let threes = 0
  while (value % 2 === 0) {
    value /= 2
    twos++
  }
  while (value % 3 === 0) {
    value /= 3
    threes++
  }
  return value === 1 ? { twos, threes } : null
}

function describeFactors({ twos, threes }: { twos: number; threes: number }): string {
  const parts: string[] = []
  if (threes > 0) parts.push(`${threes} stage${threes === 1 ? '' : 's'} of 3-way splitters`)
  if (twos > 0) parts.push(`${twos} stage${twos === 1 ? '' : 's'} of 2-way splitters`)
  if (parts.length === 0) return 'No splitting needed.'
  return `Chain ${parts.join(' then ')}.`
}

function round(value: number): number {
  return Math.round(value * 10000 + Number.EPSILON) / 10000
}
