/**
 * Clock speed, power and efficiency maths.
 *
 * Overclocking a machine multiplies its output linearly but its power draw by
 * `clock ^ 1.321929`, which is why underclocking is the cheap way to hit an exact
 * ratio and overclocking is the expensive way to save floor space.
 */
import {
  MAX_CLOCK,
  POWER_EXPONENT,
  SHARD_CLOCKS,
  SOMERSLOOP_POWER_EXPONENT,
  SOMERSLOOP_SLOTS,
  machinesById,
} from '../data/constants'
import type { MachineId, Recipe } from '../data/types'

/** Base MW draw of the machine running a recipe, at 100% clock and no sloops. */
export function basePower(recipe: Recipe): number {
  // Variable-power machines carry the figure on the recipe rather than the building.
  // The draw cycles between the two bounds, so the mean is what a power grid sees.
  if (recipe.minPower !== undefined && recipe.maxPower !== undefined) {
    return (recipe.minPower + recipe.maxPower) / 2
  }
  return machinesById.get(recipe.machine)?.powerConsumption ?? 0
}

/**
 * Power draw of a single machine.
 *
 * @param clock 1 = 100%, 2.5 = 250%.
 * @param somersloops Number of Somersloops installed, which squares the draw at full slots.
 */
export function powerAtClock(base: number, clock: number, somersloops = 0, machine?: MachineId): number {
  const scaled = base * Math.pow(clock, POWER_EXPONENT)
  if (somersloops <= 0) return scaled
  const slots = (machine && SOMERSLOOP_SLOTS[machine]) || 1
  const amplification = 1 + Math.min(somersloops, slots) / slots
  return scaled * Math.pow(amplification, SOMERSLOOP_POWER_EXPONENT)
}

/** Output multiplier from Somersloops: 1 sloop in a 2-slot machine is 1.5x. */
export function somersloopMultiplier(somersloops: number, machine: MachineId): number {
  if (somersloops <= 0) return 1
  const slots = SOMERSLOOP_SLOTS[machine] ?? 1
  return 1 + Math.min(somersloops, slots) / slots
}

/** Crafts per minute for one machine at 100% clock. */
export function craftsPerMinute(recipe: Recipe): number {
  return 60 / recipe.time
}

/** Units of `itemId` a single machine produces per minute at 100% clock. */
export function outputPerMachine(recipe: Recipe, itemId?: string): number {
  const product = itemId
    ? recipe.products.find((p) => p.item === itemId)
    : recipe.products[0]
  return (product?.amount ?? 0) * craftsPerMinute(recipe)
}

/** Units of `itemId` a single machine consumes per minute at 100% clock. */
export function inputPerMachine(recipe: Recipe, itemId: string): number {
  const ingredient = recipe.ingredients.find((i) => i.item === itemId)
  return (ingredient?.amount ?? 0) * craftsPerMinute(recipe)
}

/** Fewest Power Shards that reach a clock speed, or null if it is above 250%. */
export function shardsForClock(clock: number): number | null {
  const index = SHARD_CLOCKS.findIndex((c) => clock <= c + 1e-9)
  return index === -1 ? null : index
}

export interface ClockOption {
  /** How many machines to build. */
  machines: number
  /** Clock speed for every machine, or for all but the last one. */
  clock: number
  /** Clock speed of the final machine when it differs from the rest. */
  lastClock?: number
  /** Total MW drawn by this arrangement. */
  power: number
  /** Power Shards needed in total, or null when a clock exceeds 250%. */
  shards: number | null
  label: string
}

export interface EfficiencySolution {
  /** Machines needed if every one ran at exactly 100%. Usually fractional. */
  exactMachines: number
  /** Throughput the arrangement achieves, items/min. */
  throughput: number
  options: ClockOption[]
  /** Set when the required clock is above 250% even at whole-machine counts. */
  warning?: string
}

/**
 * The question this tool exists to answer: given a rate you can actually supply
 * (or want to produce), how many machines and at what clock speed run at 100%
 * uptime with nothing idling and nothing backing up?
 *
 * Returns both practical arrangements — an even underclock across N machines, and
 * N-1 machines at full speed with one picking up the remainder — plus an
 * overclocked option when it would save buildings.
 */
export function solveEfficiency(
  recipe: Recipe,
  targetRate: number,
  itemId?: string,
): EfficiencySolution {
  const perMachine = outputPerMachine(recipe, itemId)
  const base = basePower(recipe)

  if (perMachine <= 0 || targetRate <= 0) {
    return { exactMachines: 0, throughput: 0, options: [] }
  }

  const exactMachines = targetRate / perMachine
  const wholeMachines = Math.ceil(exactMachines - 1e-9)
  const options: ClockOption[] = []

  // Option A: build the ceiling count and underclock every machine evenly. Costs
  // the least power because the exponent works in your favour below 100%.
  const evenClock = exactMachines / wholeMachines
  options.push({
    machines: wholeMachines,
    clock: evenClock,
    power: wholeMachines * powerAtClock(base, evenClock, 0, recipe.machine),
    shards: evenClock <= 1 + 1e-9 ? 0 : shardsForClock(evenClock),
    label: `${wholeMachines} machine${wholeMachines === 1 ? '' : 's'} at ${formatClock(evenClock)}`,
  })

  // Option B: run full machines at 100% and let one mop up the remainder. Easier
  // to build incrementally, and the full-speed machines are drop-in copies.
  const fullMachines = Math.floor(exactMachines + 1e-9)
  const remainder = exactMachines - fullMachines
  if (remainder > 1e-9 && fullMachines > 0) {
    options.push({
      machines: fullMachines + 1,
      clock: 1,
      lastClock: remainder,
      power:
        fullMachines * powerAtClock(base, 1, 0, recipe.machine) +
        powerAtClock(base, remainder, 0, recipe.machine),
      shards: 0,
      label: `${fullMachines} at 100% + 1 at ${formatClock(remainder)}`,
    })
  }

  // Option C: overclock to save buildings, when that is legal (<= 250%).
  if (wholeMachines > 1) {
    const fewer = wholeMachines - 1
    const overClock = exactMachines / fewer
    if (overClock <= MAX_CLOCK + 1e-9) {
      const shardsEach = shardsForClock(overClock) ?? 0
      options.push({
        machines: fewer,
        clock: overClock,
        power: fewer * powerAtClock(base, overClock, 0, recipe.machine),
        shards: shardsEach * fewer,
        label: `${fewer} machine${fewer === 1 ? '' : 's'} at ${formatClock(overClock)} (overclocked)`,
      })
    }
  }

  const warning =
    evenClock > MAX_CLOCK + 1e-9
      ? `Needs ${formatClock(evenClock)} which is above the 250% maximum.`
      : undefined

  return { exactMachines, throughput: targetRate, options, warning }
}

/** Formats a clock multiplier as the percentage the game shows, e.g. 0.6667 -> "66.6667%". */
export function formatClock(clock: number): string {
  return `${round(clock * 100, 4)}%`
}

/** Rounds to a fixed number of decimals without trailing zeros. */
export function round(value: number, decimals = 4): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor + Number.EPSILON) / factor
}
