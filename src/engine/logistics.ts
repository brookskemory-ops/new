/**
 * Belts, pipes, miners and splitter ratios.
 */
import { BELTS, PIPES, PURITY, gameData, itemsById } from '../data/constants'
import type { BeltTier, Purity } from '../data/constants'
import type { ItemId, Miner, SupportBuilding } from '../data/types'
import { MAX_CLOCK, POWER_EXPONENT } from '../data/constants'

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

export interface BeltRun {
  tier: BeltTier
  /** Parallel lines of that tier needed to carry the rate. */
  lines: number
  /** How full each line runs, 0-1. Low numbers mean a tier is overkill. */
  utilisation: number
  liquid: boolean
  /** True when one line is not enough and the run has to be split. */
  needsParallel: boolean
}

/**
 * What it takes to actually move a rate, given the best belt you have unlocked.
 *
 * Fluids ignore the belt limit and use pipes, picking the cheapest tier that
 * carries the rate — a pipe is a pipe regardless of belt progression.
 *
 * @param maxBeltTier Name of the best belt available, e.g. "Mk.3". Omit for Mk.6.
 */
export function beltFor(rate: number, liquid: boolean, maxBeltTier?: string): BeltRun | null {
  if (rate <= 1e-9) return null

  const tiers = liquid ? PIPES : BELTS
  const capped = liquid
    ? tiers
    : tiers.slice(0, Math.max(1, tiers.findIndex((t) => t.name === maxBeltTier) + 1 || tiers.length))

  // Prefer a tier that carries it on one line; otherwise run the best available
  // in parallel.
  const single = capped.find((tier) => rate <= tier.rate + 1e-9)
  const tier = single ?? capped[capped.length - 1]
  if (!tier) return null

  const lines = Math.ceil(rate / tier.rate - 1e-9)
  return {
    tier,
    lines,
    utilisation: rate / (lines * tier.rate),
    liquid,
    needsParallel: lines > 1,
  }
}

/** Formats a belt run the way you'd say it out loud: "2× Mk.5" or just "Mk.3". */
export function describeBelt(run: BeltRun): string {
  const label = run.liquid ? `Pipe ${run.tier.name}` : run.tier.name
  return run.lines > 1 ? `${run.lines}× ${label}` : label
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

export interface NodePlan {
  miner: Miner
  purity: Purity
  /** Whole nodes of this purity needed. */
  nodes: number
  /** Clock every miner runs at to hit the rate exactly, without over-extracting. */
  clock: number
  /** Extraction per node at that clock. */
  perNode: number
  /** MW drawn by all of them together. */
  power: number
  /**
   * A shard-funded alternative using one fewer node, when that stays within the
   * 250% ceiling. Null when overclocking would not save a node.
   */
  couldOverclock: { nodes: number; clock: number } | null
}

/**
 * Which nodes to hook a miner up to for a required extraction rate.
 *
 * Answers the practical question — "I need 270 iron ore a minute, what do I put
 * a miner on?" — for each purity, so you can match it against what is near you.
 */
export function planNodes(miner: Miner, rate: number, purity: Purity): NodePlan | null {
  if (rate <= 1e-9) return null

  const base = (miner.allowLiquids ? miner.itemsPerMinute / 1000 : miner.itemsPerMinute) * PURITY[purity]
  if (base <= 0) return null

  // Enough nodes to hit the rate without overclocking, then underclock evenly so
  // nothing over-extracts. Overclocking a miner costs Power Shards, so the
  // shard-free arrangement is the one to lead with.
  const nodes = Math.max(1, Math.ceil(rate / base - 1e-9))
  const clock = rate / (nodes * base)

  // Where one fewer node would still work within the 250% ceiling, it is worth
  // knowing about — a spare node is sometimes harder to come by than shards.
  const fewer = nodes - 1
  const overclock = fewer > 0 ? rate / (fewer * base) : Infinity
  const couldOverclock =
    overclock <= MAX_CLOCK + 1e-9 ? { nodes: fewer, clock: overclock } : null

  return {
    miner,
    purity,
    nodes,
    clock,
    perNode: base * clock,
    power: nodes * miner.powerConsumption * Math.pow(clock, POWER_EXPONENT),
    couldOverclock,
  }
}

/** Node options for a rate across every purity, fewest nodes first. */
export function nodeOptions(miner: Miner, rate: number): NodePlan[] {
  const purities: Purity[] = ['pure', 'normal', 'impure']
  return purities
    .map((purity) => planNodes(miner, rate, purity))
    .filter((plan): plan is NodePlan => plan !== null)
    .sort((a, b) => a.nodes - b.nodes)
}

/** The extractor that handles a given raw resource. */
export function extractorFor(item: ItemId, minerTier?: string): Miner | null {
  const liquid = isLiquid(item)
  const candidates = gameData.miners.filter((m) => {
    if (m.allowedResources.length > 0) return m.allowedResources.includes(item)
    return liquid ? m.allowLiquids : m.allowSolids
  })
  if (candidates.length === 0) return null

  const named = minerTier ? candidates.find((m) => m.className === minerTier) : undefined
  // Default to the best tier, which is what most players will be using.
  return named ?? [...candidates].sort((a, b) => b.itemsPerMinute - a.itemsPerMinute)[0]!
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
