import { describe, expect, it } from 'vitest'

import {
  BELTS,
  bestUnlockedBelt,
  gameData,
  itemsById,
  recipesById,
  schematicByRecipe,
} from '../data/constants'
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
import {
  beltFor,
  describeBelt,
  extractorFor,
  isLiquid,
  minerOutput,
  nodeOptions,
  planNodes,
  planSplit,
  planThroughput,
  supportBuildingFor,
} from './logistics'
import { couponCost, nextCouponCost, surplusValue } from './sink'

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

  it('never proposes an even underclock above 100%, for any recipe or rate', () => {
    // The even-underclock option is exactMachines/ceil(exactMachines) and so is
    // always <= 100%. This replaces a test that asserted an unreachable warning
    // stayed undefined, which it always did.
    for (const recipe of gameData.recipes) {
      for (const rate of [1, 7, 13.3, 100, 999, 100_000]) {
        const even = solveEfficiency(recipe, rate).options[0]
        if (!even) continue
        expect(even.clock).toBeLessThanOrEqual(1 + 1e-9)
        expect(even.shards).toBe(0)
      }
    }
  })

  it('keeps every proposed clock within the 250% ceiling', () => {
    for (const recipe of gameData.recipes) {
      for (const rate of [3, 55, 617]) {
        for (const option of solveEfficiency(recipe, rate).options) {
          expect(option.clock).toBeLessThanOrEqual(2.5 + 1e-9)
        }
      }
    }
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

  it('reconciles tree leaves with the summary for every item, in both crediting modes', () => {
    // The check that was missing: with byproduct crediting on, the tree used to
    // show Water 90/min against a summary of 60/min for Aluminum Ingot.
    for (const credit of [false, true]) {
      for (const item of gameData.items) {
        if (gameData.resources.includes(item.className)) continue
        const result = solve(item.className, 60, { creditByproducts: credit })
        if (result.warnings.length > 0) continue

        const leaves = collectLeafRates(result.tree)
        for (const [raw, summaryRate] of result.rawResources) {
          const treeRate = leaves.get(raw) ?? 0
          expect(
            Math.abs(treeRate - summaryRate),
            `${item.name} / ${raw} (credit=${credit}): tree ${treeRate} vs summary ${summaryRate}`,
          ).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('shows the byproduct credit on the branch it applies to', () => {
    const result = solve('Desc_AluminumIngot_C', 60, { creditByproducts: true })
    close(result.rawResources.get(WATER)!, 60)

    const leaves = collectLeafRates(result.tree)
    close(leaves.get(WATER)!, 60)

    // The credited branch still reports what it gross-consumed, so the saving is
    // visible rather than silently absorbed.
    const credited = findNodes(result.tree, (n) => n.creditedRate !== undefined)
    expect(credited.length).toBeGreaterThan(0)
    for (const node of credited) {
      close(node.grossRate! - node.creditedRate!, node.rate)
    }
  })

  it('leaves rates untouched when nothing is credited', () => {
    const result = solve(REINFORCED_PLATE, 5, { creditByproducts: true })
    expect(findNodes(result.tree, (n) => n.creditedRate !== undefined)).toEqual([])
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

  it('picks the cheapest belt that carries a rate on one line', () => {
    expect(describeBelt(beltFor(60, false)!)).toBe('Mk.1')
    expect(describeBelt(beltFor(61, false)!)).toBe('Mk.2')
    expect(describeBelt(beltFor(780, false)!)).toBe('Mk.5')
    expect(describeBelt(beltFor(1200, false)!)).toBe('Mk.6')
  })

  it('runs parallel lines when one belt cannot carry the rate', () => {
    const run = beltFor(1500, false)!
    expect(run.tier.name).toBe('Mk.6')
    expect(run.lines).toBe(2)
    expect(run.needsParallel).toBe(true)
    expect(describeBelt(run)).toBe('2× Mk.6')
  })

  it('respects the best belt the player actually has', () => {
    // 270/min fits one Mk.3, but a player on Mk.2 needs three lines.
    expect(describeBelt(beltFor(270, false, 'Mk.3')!)).toBe('Mk.3')
    expect(describeBelt(beltFor(270, false, 'Mk.2')!)).toBe('3× Mk.2')
    expect(describeBelt(beltFor(270, false, 'Mk.1')!)).toBe('5× Mk.1')
  })

  it('never proposes a belt above the tier available', () => {
    for (const tier of BELTS) {
      for (const rate of [10, 200, 900, 5000]) {
        const run = beltFor(rate, false, tier.name)!
        expect(run.tier.rate).toBeLessThanOrEqual(tier.rate)
      }
    }
  })

  it('sends fluids down pipes regardless of the belt setting', () => {
    const run = beltFor(300, true, 'Mk.1')!
    expect(run.liquid).toBe(true)
    expect(describeBelt(run)).toBe('Pipe Mk.1')
    expect(describeBelt(beltFor(600, true, 'Mk.1')!)).toBe('Pipe Mk.2')
    expect(describeBelt(beltFor(1200, true)!)).toBe('2× Pipe Mk.2')
  })

  it('reports how full each line runs', () => {
    close(beltFor(60, false)!.utilisation, 1)
    close(beltFor(30, false)!.utilisation, 0.5)
    close(beltFor(1200, false, 'Mk.5')!.utilisation, 1200 / 1560)
  })

  it('has nothing to carry at zero', () => {
    expect(beltFor(0, false)).toBeNull()
    expect(beltFor(-5, false)).toBeNull()
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

  it('takes extractor power from the dataset, not a hand-written table', () => {
    for (const miner of gameData.miners) {
      const output = minerOutput(miner, 'normal', 1)
      expect(output.power).toBeCloseTo(miner.powerConsumption, 9)
    }
  })

  it('charges the Resource Well Extractor no power, and its Pressurizer 150 MW', () => {
    // The 150 MW belongs to the Pressurizer; quoting it per-extractor was a bug.
    const extractor = gameData.miners.find((m) => m.className === 'Desc_FrackingExtractor_C')!
    expect(extractor.powerConsumption).toBe(0)
    close(minerOutput(extractor, 'normal').power, 0)

    const support = supportBuildingFor(extractor)!
    expect(support.className).toBe('Desc_FrackingSmasher_C')
    expect(support.powerConsumption).toBe(150)

    // Every other extractor pays its own way.
    for (const miner of gameData.miners) {
      if (miner.className === 'Desc_FrackingExtractor_C') continue
      expect(supportBuildingFor(miner)).toBeNull()
      expect(miner.powerConsumption).toBeGreaterThan(0)
    }
  })

  it('scales extractor power by the clock exponent', () => {
    const mk3 = gameData.miners.find((m) => m.className === 'Desc_MinerMk3_C')!
    expect(mk3.powerConsumption).toBe(45)
    close(minerOutput(mk3, 'normal', 2.5).power, 45 * Math.pow(2.5, 1.321929), 1e-6)
  })

  it('flags when a miner overflows the chosen belt', () => {
    const mk3 = gameData.miners.find((m) => m.className === 'Desc_MinerMk3_C')!
    const output = minerOutput(mk3, 'pure', 1, BELTS.find((b) => b.name === 'Mk.5')!)
    expect(output.overflow).toBeUndefined()

    const overflowing = minerOutput(mk3, 'pure', 2.5, BELTS.find((b) => b.name === 'Mk.5')!)
    expect(overflowing.overflow).toContain('exceeds')
  })

  it('picks the belt tier the player has actually unlocked', () => {
    const mk3 = BELTS.find((b) => b.name === 'Mk.3')!
    expect(bestUnlockedBelt(new Set([mk3.schematic])).name).toBe('Mk.3')
    // Ticking a later milestone wins even if earlier ones are missing.
    expect(bestUnlockedBelt(new Set(BELTS.map((b) => b.schematic))).name).toBe('Mk.6')
    // Mk.1 is the floor: you always have it.
    expect(bestUnlockedBelt(new Set()).name).toBe('Mk.1')
  })

  it('plans nodes for a required extraction rate without needing shards', () => {
    const mk2 = gameData.miners.find((m) => m.className === 'Desc_MinerMk2_C')!
    // Mk.2 on a normal node is 120/min, so 270/min takes three at 75%.
    const normal = planNodes(mk2, 270, 'normal')!
    expect(normal.nodes).toBe(3)
    close(normal.clock, 0.75)
    close(normal.perNode, 90)

    // Pure doubles to 240/min, so two nodes at 56.25%.
    const pure = planNodes(mk2, 270, 'pure')!
    expect(pure.nodes).toBe(2)
    close(pure.clock, 270 / 480)
  })

  it('never over-extracts: node output always matches demand exactly', () => {
    const mk1 = gameData.miners.find((m) => m.className === 'Desc_MinerMk1_C')!
    for (const rate of [10, 60, 61, 150, 300, 901]) {
      for (const purity of ['impure', 'normal', 'pure'] as const) {
        const plan = planNodes(mk1, rate, purity)!
        close(plan.nodes * plan.perNode, rate, 1e-6)
      }
    }
  })

  it('leads with an arrangement that needs no power shards', () => {
    const mk1 = gameData.miners.find((m) => m.className === 'Desc_MinerMk1_C')!
    for (const rate of [10, 61, 150, 500, 901]) {
      for (const purity of ['impure', 'normal', 'pure'] as const) {
        expect(planNodes(mk1, rate, purity)!.clock).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  it('mentions saving a node by overclocking, when that is legal', () => {
    const mk2 = gameData.miners.find((m) => m.className === 'Desc_MinerMk2_C')!
    // 270/min over two pure nodes at 56.25%, or one pure node at 112.5%.
    const pure = planNodes(mk2, 270, 'pure')!
    expect(pure.couldOverclock).toEqual({ nodes: 1, clock: 270 / 240 })

    // A single node has nothing to save, so there is nothing to suggest.
    expect(planNodes(mk2, 100, 'pure')!.couldOverclock).toBeNull()
  })

  it('never suggests an overclock above the 250% ceiling', () => {
    const mk1 = gameData.miners.find((m) => m.className === 'Desc_MinerMk1_C')!
    for (const rate of [10, 61, 150, 500, 901]) {
      for (const purity of ['impure', 'normal', 'pure'] as const) {
        const over = planNodes(mk1, rate, purity)!.couldOverclock
        if (over) expect(over.clock).toBeLessThanOrEqual(2.5 + 1e-9)
      }
    }
  })

  it('offers node options ordered by how many nodes they take', () => {
    const mk2 = gameData.miners.find((m) => m.className === 'Desc_MinerMk2_C')!
    const options = nodeOptions(mk2, 270)
    expect(options.length).toBeGreaterThan(1)
    expect(options[0]!.purity).toBe('pure')
    for (let i = 1; i < options.length; i++) {
      expect(options[i]!.nodes).toBeGreaterThanOrEqual(options[i - 1]!.nodes)
    }
  })

  it('matches each raw resource to an extractor that handles it', () => {
    for (const item of gameData.resources) {
      const extractor = extractorFor(item)
      expect(extractor, `no extractor for ${item}`).not.toBeNull()
      if (isLiquid(item)) expect(extractor!.allowLiquids).toBe(true)
      else expect(extractor!.allowSolids).toBe(true)
    }
  })

  it('has nothing to plan for a zero rate', () => {
    const mk1 = gameData.miners.find((m) => m.className === 'Desc_MinerMk1_C')!
    expect(planNodes(mk1, 0, 'normal')).toBeNull()
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
  it('matches the published coupon costs', () => {
    // Groups of three, climbing quadratically by group — not doubling.
    expect([1, 2, 3].map(couponCost)).toEqual([500, 500, 500])
    expect([4, 5, 6].map(couponCost)).toEqual([1250, 1250, 1250])
    expect([7, 8, 9].map(couponCost)).toEqual([2000, 2000, 2000])
    expect([10, 11, 12].map(couponCost)).toEqual([3250, 3250, 3250])
  })

  it('follows 250*(ceil(n/3)-1)^2+1000 past the introductory coupons', () => {
    for (const n of [4, 17, 60, 199, 2998]) {
      expect(couponCost(n)).toBe(250 * Math.pow(Math.ceil(n / 3) - 1, 2) + 1000)
    }
  })

  it('flattens out after coupon 2998', () => {
    expect(couponCost(2999)).toBe(249_501_250)
    expect(couponCost(50_000)).toBe(249_501_250)
  })

  it('never reports a cheaper coupon than the one before it', () => {
    for (let n = 2; n <= 3200; n++) {
      expect(couponCost(n)).toBeGreaterThanOrEqual(couponCost(n - 1))
    }
  })

  it('asks for the next coupon, not the one just claimed', () => {
    expect(nextCouponCost(0)).toBe(500)
    expect(nextCouponCost(3)).toBe(1250)
    expect(nextCouponCost(9)).toBe(3250)
    // The old table silently capped at ten; the formula keeps going.
    expect(nextCouponCost(100)).toBe(couponCost(101))
  })

  it('values surplus byproducts at their sink rate', () => {
    const residuePoints = itemsById.get(HEAVY_OIL_RESIDUE)!.sinkPoints
    close(surplusValue(new Map([[HEAVY_OIL_RESIDUE, 10]])), residuePoints * 10)
  })

  it('gives water no sink value in a plan', () => {
    close(surplusValue(new Map([[WATER, 100]])), itemsById.get(WATER)!.sinkPoints * 100)
  })
})

/** Every node in a tree matching a predicate. */
function findNodes(
  node: import('./solve').TreeNode,
  predicate: (node: import('./solve').TreeNode) => boolean,
): import('./solve').TreeNode[] {
  const found: import('./solve').TreeNode[] = []
  const walk = (current: import('./solve').TreeNode): void => {
    if (predicate(current)) found.push(current)
    current.children.forEach(walk)
  }
  walk(node)
  return found
}

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
