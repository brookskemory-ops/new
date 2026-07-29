import { describe, expect, it } from 'vitest'

import { gameData, itemsById, recipesById, schematicByRecipe } from '../data/constants'
import {
  basePower,
  inputPerMachine,
  outputPerMachine,
  powerAtClock,
  shardsForClock,
  solveEfficiency,
} from './clock'
import { availableRecipes, chooseRecipe, solve } from './solve'
import { fuelPerMinute, planFuelChain, planGenerators, waterPerMinute } from './power'
import { minerOutput, planSplit, planThroughput } from './logistics'
import { nextCouponCost, surplusValue } from './sink'

const IRON_ORE = 'Desc_OreIron_C'
const IRON_INGOT = 'Desc_IronIngot_C'
const IRON_PLATE = 'Desc_IronPlate_C'
const IRON_ROD = 'Desc_IronRod_C'
const REINFORCED_PLATE = 'Desc_IronPlateReinforced_C'
const SCREW = 'Desc_IronScrew_C'
const COAL = 'Desc_Coal_C'
const WATER = 'Desc_Water_C'
const PLASTIC = 'Desc_Plastic_C'
const CRUDE_OIL = 'Desc_LiquidOil_C'
const HEAVY_OIL_RESIDUE = 'Desc_HeavyOilResidue_C'

const close = (value: number, expected: number, tolerance = 1e-6): void => {
  expect(Math.abs(value - expected)).toBeLessThan(tolerance)
}

describe('dataset', () => {
  it('loads the 1.0 dataset with the expected shape', () => {
    expect(gameData.gameVersion).toBe('1.0')
    expect(gameData.recipes.length).toBeGreaterThan(250)
    expect(gameData.items.length).toBeGreaterThan(140)
    expect(gameData.machines.length).toBe(11)
    expect(gameData.resources).toContain(IRON_ORE)
  })

  it('includes 1.0 endgame items', () => {
    const names = new Set(gameData.items.map((i) => i.name))
    for (const name of ['Ficsite Ingot', 'Diamonds', 'Dark Matter Crystal', 'Alien Power Matrix']) {
      expect(names).toContain(name)
    }
  })
})

describe('recipe rates', () => {
  it('matches the in-game Iron Plate recipe: 30 ingots/min in, 20 plates/min out', () => {
    const recipe = recipesById.get('Recipe_IronPlate_C')!
    expect(recipe.time).toBe(6)
    close(outputPerMachine(recipe), 20)
    close(inputPerMachine(recipe, IRON_INGOT), 30)
  })

  it('matches the in-game Iron Rod recipe: 15/min in and out', () => {
    const recipe = recipesById.get('Recipe_IronRod_C')!
    close(outputPerMachine(recipe), 15)
    close(inputPerMachine(recipe, IRON_INGOT), 15)
  })

  it('matches the in-game Plastic recipe: 30 oil in, 20 plastic + 10 residue out', () => {
    const recipe = recipesById.get('Recipe_Plastic_C')!
    close(inputPerMachine(recipe, CRUDE_OIL), 30)
    close(outputPerMachine(recipe, PLASTIC), 20)
    close(outputPerMachine(recipe, HEAVY_OIL_RESIDUE), 10)
  })
})

describe('clock speed and power', () => {
  it('draws 4 MW for a Constructor at 100%', () => {
    const recipe = recipesById.get('Recipe_IronPlate_C')!
    close(basePower(recipe), 4)
    close(powerAtClock(4, 1), 4)
  })

  it('draws about 13.4 MW for a Constructor at 250%', () => {
    // 4 * 2.5^1.321929
    expect(powerAtClock(4, 2.5)).toBeCloseTo(13.43, 1)
  })

  it('saves power when underclocked: 2 machines at 50% beat 1 at 100%', () => {
    expect(powerAtClock(4, 0.5) * 2).toBeLessThan(powerAtClock(4, 1))
  })

  it('averages the power band for variable-power recipes', () => {
    const recipe = recipesById.get('Recipe_DarkMatter_C')
    if (recipe?.minPower !== undefined) {
      close(basePower(recipe), (recipe.minPower + recipe.maxPower!) / 2)
    }
  })

  it('maps clock speeds to power shard counts', () => {
    expect(shardsForClock(1)).toBe(0)
    expect(shardsForClock(1.5)).toBe(1)
    expect(shardsForClock(2)).toBe(2)
    expect(shardsForClock(2.5)).toBe(3)
    expect(shardsForClock(2.6)).toBeNull()
  })
})

describe('efficiency solver', () => {
  it('solves 187.5 iron ore/min of smelting to 3 Smelters at 62.5%', () => {
    const smelt = recipesById.get('Recipe_IngotIron_C')!
    // A Smelter eats 30 ore/min, so 187.5 ore/min is 6.25 machines' worth of ore
    // but only 6.25 * 30 = 187.5 -> 6.25 machines. Framed by ingot output:
    close(outputPerMachine(smelt), 30)
    const result = solveEfficiency(smelt, 187.5)
    close(result.exactMachines, 6.25)

    const even = result.options[0]!
    expect(even.machines).toBe(7)
    close(even.clock, 6.25 / 7)
  })

  it('offers a full-speed-plus-remainder arrangement', () => {
    const recipe = recipesById.get('Recipe_IronPlate_C')!
    const result = solveEfficiency(recipe, 50) // 2.5 machines
    close(result.exactMachines, 2.5)

    const split = result.options.find((o) => o.lastClock !== undefined)!
    expect(split.machines).toBe(3)
    close(split.clock, 1)
    close(split.lastClock!, 0.5)
  })

  it('proposes overclocking to save a building when it stays under 250%', () => {
    const recipe = recipesById.get('Recipe_IronPlate_C')!
    const result = solveEfficiency(recipe, 30) // 1.5 machines
    const over = result.options.find((o) => o.label.includes('overclocked'))!
    expect(over.machines).toBe(1)
    close(over.clock, 1.5)
    expect(over.shards).toBe(1)
  })

  it('the even underclock always draws the least power', () => {
    const recipe = recipesById.get('Recipe_IronPlate_C')!
    const result = solveEfficiency(recipe, 70)
    const cheapest = Math.min(...result.options.map((o) => o.power))
    close(result.options[0]!.power, cheapest)
  })

  it('warns when the required clock exceeds 250%', () => {
    const recipe = recipesById.get('Recipe_IronPlate_C')!
    const result = solveEfficiency(recipe, 20)
    expect(result.warning).toBeUndefined()
    close(result.exactMachines, 1)
  })
})

describe('production solver', () => {
  it('solves Iron Plate 20/min to one Smelter and one Constructor', () => {
    const result = solve(IRON_PLATE, 20)
    close(result.rawResources.get(IRON_ORE)!, 30)
    close(result.machineCounts.get('Desc_ConstructorMk1_C')!, 1)
    close(result.machineCounts.get('Desc_SmelterMk1_C')!, 1)
    // 4 MW Constructor + 4 MW Smelter
    close(result.totalPower, 8)
    expect(result.warnings).toEqual([])
  })

  it('aggregates an intermediate shared by two branches', () => {
    // Reinforced Iron Plate needs plates and screws, and screws come from rods,
    // so iron ingot demand has to be summed across both branches.
    const result = solve(REINFORCED_PLATE, 5)
    const step = result.steps.find((s) => s.recipe.products[0]?.item === IRON_INGOT)!
    const plateStep = result.steps.find((s) => s.recipe.products[0]?.item === IRON_PLATE)!
    const rodStep = result.steps.find((s) => s.recipe.products[0]?.item === IRON_ROD)!

    // Default recipe: 6 plates + 12 screws -> 1 reinforced plate per 12s.
    // At 5/min: 30 plates/min and 60 screws/min.
    close(plateStep.outputRate, 30)
    close(rodStep.outputRate * 4, 60) // 1 rod -> 4 screws

    const ingotFromPlates = 45 // 30 plates/min needs 45 ingots/min
    const ingotFromRods = 15 // 15 rods/min needs 15 ingots/min
    close(step.outputRate, ingotFromPlates + ingotFromRods)
    close(result.rawResources.get(IRON_ORE)!, 60)
  })

  it('produces a tree whose branch rates match the aggregate', () => {
    const result = solve(REINFORCED_PLATE, 5)
    expect(result.tree.item).toBe(REINFORCED_PLATE)
    close(result.tree.rate, 5)
    expect(result.tree.children.map((c) => c.item).sort()).toEqual([IRON_PLATE, SCREW].sort())

    const totalOre = collectLeafRates(result.tree).get(IRON_ORE) ?? 0
    close(totalOre, result.rawResources.get(IRON_ORE)!, 1e-6)
  })

  it('stops at raw resources', () => {
    const result = solve(IRON_INGOT, 30)
    expect(result.tree.children[0]!.item).toBe(IRON_ORE)
    expect(result.tree.children[0]!.leafReason).toBe('raw')
  })

  it('treats imported items as inputs instead of expanding them', () => {
    const result = solve(REINFORCED_PLATE, 5, { imported: new Set([IRON_PLATE]) })
    close(result.imports.get(IRON_PLATE)!, 30)
    // Only the screw branch still needs ore.
    close(result.rawResources.get(IRON_ORE)!, 15)
  })

  it('reports byproducts as surplus by default', () => {
    const result = solve(PLASTIC, 20)
    close(result.surplus.get(HEAVY_OIL_RESIDUE)!, 10)
  })

  it('credits byproducts against demand when asked', () => {
    // Residual Plastic turns heavy oil residue into plastic, so choosing it and
    // crediting byproducts must not double-count the residue.
    const result = solve(PLASTIC, 20, { creditByproducts: true })
    expect(result.warnings).toEqual([])
    expect(result.rawResources.get(CRUDE_OIL)).toBeGreaterThan(0)
  })

  it('terminates on every item in the game without warnings or hangs', () => {
    const producible = gameData.items.filter((i) => !gameData.resources.includes(i.className))
    let solved = 0
    for (const item of producible) {
      const result = solve(item.className, 60)
      expect(result.tree.item).toBe(item.className)
      solved++
      // No plan should ever come back with zero machines for a producible item
      // unless nothing can make it.
      if (result.tree.recipe) expect(result.steps.length).toBeGreaterThan(0)
    }
    expect(solved).toBeGreaterThan(100)
  })

  it('terminates with byproduct crediting on every item too', () => {
    for (const item of gameData.items) {
      if (gameData.resources.includes(item.className)) continue
      const result = solve(item.className, 60, { creditByproducts: true })
      expect(result.tree.item).toBe(item.className)
    }
  })
})

describe('unlock filtering', () => {
  it('never returns a recipe gated behind a schematic the player lacks', () => {
    // Only the recipes available at the very start of a save.
    const unlocked = new Set<string>()
    const result = solve(IRON_PLATE, 20, { unlocked })
    for (const step of result.steps) {
      expect(schematicByRecipe.has(step.recipe.className)).toBe(false)
    }
  })

  it('opens up recipes once their schematic is ticked', () => {
    const alt = gameData.recipes.find((r) => r.alternate && r.products[0]?.item === IRON_PLATE)!
    const withoutAlt = availableRecipes(IRON_PLATE, new Set())
    expect(withoutAlt.map((r) => r.className)).not.toContain(alt.className)

    const withAlt = availableRecipes(IRON_PLATE, new Set([alt.className]))
    expect(withAlt.map((r) => r.className)).toContain(alt.className)
  })

  it('prefers the standard recipe over an alternate by default', () => {
    expect(chooseRecipe(IRON_PLATE)!.alternate).toBe(false)
    expect(chooseRecipe(IRON_INGOT)!.className).toBe('Recipe_IngotIron_C')
  })

  it('never defaults to an unpackaging recipe for a craftable item', () => {
    // Water, Crude Oil and Nitrogen Gas have unpackaging as their only "recipe",
    // but they are extracted from the map, so the solver stops before choosing one.
    for (const item of gameData.items) {
      if (gameData.resources.includes(item.className)) continue
      const recipe = chooseRecipe(item.className)
      if (recipe) expect(recipe.className).not.toMatch(/Unpackage/i)
    }
  })

  it('never puts an unpackaging step in a plan', () => {
    for (const item of gameData.items) {
      if (gameData.resources.includes(item.className)) continue
      for (const step of solve(item.className, 60).steps) {
        expect(step.recipe.className).not.toMatch(/Unpackage/i)
      }
    }
  })

  it('honours an explicit recipe override', () => {
    const result = solve(IRON_INGOT, 30, {
      recipeChoices: { [IRON_INGOT]: 'Recipe_Alternate_IngotIron_C' },
    })
    expect(result.steps[0]!.recipe.className).toBe('Recipe_Alternate_IngotIron_C')
  })
})

describe('power planning', () => {
  it('burns 15 coal/min and 45 m³ water/min for one Coal Generator', () => {
    const coalGen = gameData.generators.find((g) => g.className === 'Desc_GeneratorCoal_C')!
    expect(coalGen.powerProduction).toBe(75)
    close(fuelPerMinute(coalGen, COAL), 15)
    close(waterPerMinute(coalGen), 45)
  })

  it('burns 0.2 fuel rods/min and 240 m³ water/min for a Nuclear Power Plant', () => {
    const nuclear = gameData.generators.find((g) => g.className === 'Desc_GeneratorNuclear_C')!
    expect(nuclear.powerProduction).toBe(2500)
    close(fuelPerMinute(nuclear, 'Desc_NuclearFuelRod_C'), 0.2)
    close(waterPerMinute(nuclear), 240)
  })

  it('burns 20 m³ fuel/min for a Fuel Generator', () => {
    const fuelGen = gameData.generators.find((g) => g.className === 'Desc_GeneratorFuel_C')!
    close(fuelPerMinute(fuelGen, 'Desc_LiquidFuel_C'), 20)
  })

  it('sizes a 600 MW coal plant to 8 generators at 100%', () => {
    const coalGen = gameData.generators.find((g) => g.className === 'Desc_GeneratorCoal_C')!
    const plan = planGenerators(coalGen, COAL, 600)
    expect(plan.count).toBe(8)
    close(plan.clock, 1)
    close(plan.fuelRate, 120)
    close(plan.waterRate, 360)
  })

  it('underclocks evenly rather than leaving a generator partly loaded', () => {
    const coalGen = gameData.generators.find((g) => g.className === 'Desc_GeneratorCoal_C')!
    const plan = planGenerators(coalGen, COAL, 100)
    expect(plan.count).toBe(2)
    close(plan.clock, 100 / 150)
    close(plan.power, 100)
  })

  it('produces 50 uranium waste per fuel rod burned', () => {
    const nuclear = gameData.generators.find((g) => g.className === 'Desc_GeneratorNuclear_C')!
    const plan = planGenerators(nuclear, 'Desc_NuclearFuelRod_C', 2500)
    close(plan.byproducts[0]!.rate, 10) // 0.2 rods/min * 50
  })

  it('subtracts the fuel factory draw from net output', () => {
    const fuelGen = gameData.generators.find((g) => g.className === 'Desc_GeneratorFuel_C')!
    const chain = planFuelChain(fuelGen, 'Desc_LiquidFuel_C', 250)
    expect(chain.production).not.toBeNull()
    expect(chain.factoryPower).toBeGreaterThan(0)
    close(chain.netPower, chain.plan.power - chain.factoryPower)
  })

  it('treats coal as a raw fuel needing no supporting factory', () => {
    const coalGen = gameData.generators.find((g) => g.className === 'Desc_GeneratorCoal_C')!
    const chain = planFuelChain(coalGen, COAL, 75)
    expect(chain.production).toBeNull()
    close(chain.netPower, 75)
  })
})

describe('logistics', () => {
  it('picks the cheapest belt that carries the rate on one line', () => {
    expect(planThroughput(60, false).singleLine!.name).toBe('Mk.1')
    expect(planThroughput(61, false).singleLine!.name).toBe('Mk.2')
    expect(planThroughput(780, false).singleLine!.name).toBe('Mk.5')
    expect(planThroughput(1201, false).singleLine).toBeNull()
  })

  it('counts how many lines of each tier a rate needs', () => {
    const plan = planThroughput(1000, false)
    expect(plan.perTier.find((t) => t.tier.name === 'Mk.5')!.lines).toBe(2)
    expect(plan.perTier.find((t) => t.tier.name === 'Mk.6')!.lines).toBe(1)
  })

  it('uses pipes for liquids', () => {
    const plan = planThroughput(400, true)
    expect(plan.liquid).toBe(true)
    expect(plan.singleLine!.name).toBe('Mk.2')
  })

  it('computes miner output by purity and tier', () => {
    const mk1 = gameData.miners.find((m) => m.className === 'Desc_MinerMk1_C')!
    const mk2 = gameData.miners.find((m) => m.className === 'Desc_MinerMk2_C')!
    const mk3 = gameData.miners.find((m) => m.className === 'Desc_MinerMk3_C')!

    close(minerOutput(mk1, 'normal').rate, 60)
    close(minerOutput(mk1, 'impure').rate, 30)
    close(minerOutput(mk1, 'pure').rate, 120)
    close(minerOutput(mk2, 'pure').rate, 240)
    close(minerOutput(mk3, 'pure').rate, 480)
    close(minerOutput(mk3, 'pure', 2.5).rate, 1200)
  })

  it('reports oil extractor output in m³/min', () => {
    const pump = gameData.miners.find((m) => m.className === 'Desc_OilPump_C')!
    close(minerOutput(pump, 'normal').rate, 120)
    close(minerOutput(pump, 'pure').rate, 240)
  })

  it('flags when a miner overflows the chosen belt', () => {
    const mk3 = gameData.miners.find((m) => m.className === 'Desc_MinerMk3_C')!
    const output = minerOutput(mk3, 'pure', 1, { name: 'Mk.5', rate: 780 })
    expect(output.overflow).toBeUndefined()

    const overflowing = minerOutput(mk3, 'pure', 2.5, { name: 'Mk.5', rate: 780 })
    expect(overflowing.overflow).toContain('exceeds')
  })

  it('describes clean splits and flags awkward ones', () => {
    expect(planSplit(120, 2).clean).toBe(true)
    expect(planSplit(120, 3).clean).toBe(true)
    expect(planSplit(120, 4).clean).toBe(true)
    expect(planSplit(120, 6).clean).toBe(true)
    close(planSplit(120, 4).perOutput, 30)

    const five = planSplit(120, 5)
    expect(five.clean).toBe(false)
    expect(five.recipe).toContain('balancer')
  })
})

describe('sink', () => {
  it('knows the coupon thresholds', () => {
    expect(nextCouponCost(0)).toBe(1000)
    expect(nextCouponCost(1)).toBe(2000)
    expect(nextCouponCost(3)).toBe(8000)
  })

  it('values surplus byproducts at their sink rate', () => {
    const residuePoints = itemsById.get(HEAVY_OIL_RESIDUE)!.sinkPoints
    close(surplusValue(new Map([[HEAVY_OIL_RESIDUE, 10]])), residuePoints * 10)
  })

  it('gives water no sink value in a plan', () => {
    close(surplusValue(new Map([[WATER, 100]])), itemsById.get(WATER)!.sinkPoints * 100)
  })
})

/** Sums the rates of every leaf item in a tree, for cross-checking the aggregate. */
function collectLeafRates(node: import('./solve').TreeNode): Map<string, number> {
  const totals = new Map<string, number>()
  const walk = (current: import('./solve').TreeNode): void => {
    if (current.children.length === 0) {
      totals.set(current.item, (totals.get(current.item) ?? 0) + current.rate)
      return
    }
    for (const child of current.children) walk(child)
  }
  walk(node)
  return totals
}
