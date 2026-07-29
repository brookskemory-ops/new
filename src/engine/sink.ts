/**
 * AWESOME Sink economics: which item is actually worth feeding into the sink.
 */
import { gameData, itemsById, recipesByProduct } from '../data/constants'
import type { Item, ItemId } from '../data/types'
import { solve } from './solve'
import type { SolveOptions } from './solve'

/** The first three coupons are a flat introductory price. */
const INTRO_COUPON_COST = 500
const INTRO_COUPONS = 3

/** Past coupon 2,998 the price stops climbing and sits at this figure forever. */
const MAX_COUPON_COST = 249_501_250
const LAST_RISING_COUPON = 2998

/**
 * Points needed for the n-th coupon (1-indexed).
 *
 * Coupons come in groups of three, and the price climbs quadratically by group
 * rather than doubling: 500, 500, 500, then 1250, 1250, 1250, then 2000 and so on.
 */
export function couponCost(n: number): number {
  const index = Math.max(1, Math.floor(n))
  if (index <= INTRO_COUPONS) return INTRO_COUPON_COST
  if (index > LAST_RISING_COUPON) return MAX_COUPON_COST
  return 250 * Math.pow(Math.ceil(index / 3) - 1, 2) + 1000
}

/** The first ten coupon prices, for the reference table on the Sink tab. */
export const COUPON_THRESHOLDS: readonly number[] = Array.from({ length: 10 }, (_, i) =>
  couponCost(i + 1),
)

export interface SinkRanking {
  item: Item
  /** Sink value of one unit. */
  pointsPerUnit: number
  /** Points per minute if you sink everything one machine of its default recipe makes. */
  pointsPerMachineMinute: number
  /** Points earned per unit of raw ore spent making it. Null when it cannot be planned. */
  pointsPerRawUnit: number | null
}

/**
 * Ranks sinkable items by value. Points per unit tells you what to sink from a
 * chest; points per raw resource tells you what is worth building a factory for,
 * which is usually the more interesting number.
 */
export function rankSinkables(options: SolveOptions = {}, limit = 40): SinkRanking[] {
  const rankings: SinkRanking[] = []

  for (const item of gameData.items) {
    if (item.sinkPoints <= 0 || item.liquid) continue

    const recipes = recipesByProduct.get(item.className)
    if (!recipes || recipes.length === 0) continue

    let pointsPerMachineMinute = 0
    let pointsPerRawUnit: number | null = null

    try {
      // One reference machine's worth, so the two metrics stay comparable.
      const result = solve(item.className, 60, options)
      if (result.warnings.length === 0) {
        const rawTotal = sum(result.rawResources)
        pointsPerRawUnit = rawTotal > 0 ? (60 * item.sinkPoints) / rawTotal : null
      }
      const step = result.steps.find((s) => s.recipe.products[0]?.item === item.className)
      if (step && step.machines > 0) {
        pointsPerMachineMinute = (step.outputRate / step.machines) * item.sinkPoints
      }
    } catch {
      // An unsolvable item just loses its per-raw figure; the per-unit value stands.
    }

    rankings.push({
      item,
      pointsPerUnit: item.sinkPoints,
      pointsPerMachineMinute,
      pointsPerRawUnit,
    })
  }

  return rankings
    .sort((a, b) => (b.pointsPerRawUnit ?? 0) - (a.pointsPerRawUnit ?? 0))
    .slice(0, limit)
}

/** Points needed for the next coupon after `couponsAlreadyClaimed`. */
export function nextCouponCost(couponsAlreadyClaimed: number): number {
  return couponCost(Math.max(0, couponsAlreadyClaimed) + 1)
}

/** Minutes to earn the next coupon at a given points-per-minute rate. */
export function minutesToNextCoupon(pointsPerMinute: number, couponsClaimed: number): number | null {
  if (pointsPerMinute <= 0) return null
  return nextCouponCost(couponsClaimed) / pointsPerMinute
}

/** Total sink value per minute of a plan's surplus byproducts. */
export function surplusValue(surplus: ReadonlyMap<ItemId, number>): number {
  let total = 0
  for (const [item, rate] of surplus) {
    const points = itemsById.get(item)?.sinkPoints ?? 0
    total += points * rate
  }
  return total
}

function sum(map: ReadonlyMap<string, number>): number {
  let total = 0
  for (const value of map.values()) total += value
  return total
}
