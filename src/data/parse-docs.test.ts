import { describe, expect, it } from 'vitest'

import {
  DocsParseError,
  classNameOf,
  parseDocs,
  parseEnum,
  parseEnumList,
  parseProducedIn,
  parseStacks,
  validateGameData,
} from './parse-docs'

const ref = (path: string, name: string): string =>
  `"/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/${path}.${name}'"`

/**
 * A miniature docs file in the shape the game ships: grouped by NativeClass, with
 * structured values as Unreal property strings and fluid amounts in litres.
 */
const SAMPLE = JSON.stringify([
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGRecipe'",
    Classes: [
      {
        ClassName: 'Recipe_IronPlate_C',
        mDisplayName: 'Iron Plate',
        mIngredients: `((ItemClass=${ref('IronIngot/Desc_IronIngot', 'Desc_IronIngot_C')},Amount=3))`,
        mProduct: `((ItemClass=${ref('IronPlate/Desc_IronPlate', 'Desc_IronPlate_C')},Amount=2))`,
        mManufactoringDuration: '6.000000',
        mProducedIn: `(${ref('ConstructorMk1/Build_ConstructorMk1', 'Build_ConstructorMk1_C')})`,
      },
      {
        ClassName: 'Recipe_Plastic_C',
        mDisplayName: 'Plastic',
        // Crude Oil is a fluid, so the docs record 3000 litres for 3 m³.
        mIngredients: `((ItemClass=${ref('Oil/Desc_LiquidOil', 'Desc_LiquidOil_C')},Amount=3000))`,
        mProduct:
          `((ItemClass=${ref('Plastic/Desc_Plastic', 'Desc_Plastic_C')},Amount=2),` +
          `(ItemClass=${ref('Oil/Desc_HeavyOilResidue', 'Desc_HeavyOilResidue_C')},Amount=1000))`,
        mManufactoringDuration: '6.000000',
        mProducedIn: `(${ref('OilRefinery/Build_OilRefinery', 'Build_OilRefinery_C')})`,
      },
      {
        ClassName: 'Recipe_Alternate_CoatedIronPlate_C',
        mDisplayName: 'Alternate: Coated Iron Plate',
        mIngredients: `((ItemClass=${ref('IronIngot/Desc_IronIngot', 'Desc_IronIngot_C')},Amount=5))`,
        mProduct: `((ItemClass=${ref('IronPlate/Desc_IronPlate', 'Desc_IronPlate_C')},Amount=10))`,
        mManufactoringDuration: '8.000000',
        mProducedIn: `(${ref('AssemblerMk1/Build_AssemblerMk1', 'Build_AssemblerMk1_C')})`,
      },
      {
        ClassName: 'Recipe_DarkMatter_C',
        mDisplayName: 'Dark Matter Residue',
        mIngredients: `((ItemClass=${ref('Sam/Desc_SAMIngot', 'Desc_SAMIngot_C')},Amount=1))`,
        mProduct: `((ItemClass=${ref('Dark/Desc_DarkMatter', 'Desc_DarkMatter_C')},Amount=1))`,
        mManufactoringDuration: '6.000000',
        mProducedIn: `(${ref('Converter/Build_Converter', 'Build_Converter_C')})`,
        mVariablePowerConsumptionConstant: '250.000000',
        mVariablePowerConsumptionFactor: '500.000000',
      },
      {
        // Built by hand, not in a machine — must be ignored.
        ClassName: 'Recipe_Wall_C',
        mDisplayName: 'Wall',
        mIngredients: `((ItemClass=${ref('Concrete/Desc_Cement', 'Desc_Cement_C')},Amount=2))`,
        mProduct: `((ItemClass=${ref('Wall/Desc_Wall', 'Desc_Wall_C')},Amount=1))`,
        mManufactoringDuration: '1.000000',
        mProducedIn: '()',
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGItemDescriptor'",
    Classes: [
      {
        ClassName: 'Desc_IronPlate_C',
        mDisplayName: 'Iron Plate',
        mStackSize: 'EStackSize::SS_BIG',
        mResourceSinkPoints: '12',
        mForm: 'EResourceForm::RF_SOLID',
        mEnergyValue: '0.000000',
      },
      {
        ClassName: 'Desc_IronIngot_C',
        mDisplayName: 'Iron Ingot',
        mStackSize: 'EStackSize::SS_BIG',
        mResourceSinkPoints: '2',
        mForm: 'EResourceForm::RF_SOLID',
      },
      {
        ClassName: 'Desc_Plastic_C',
        mDisplayName: 'Plastic',
        mStackSize: 'EStackSize::SS_BIG',
        mResourceSinkPoints: '75',
        mForm: 'EResourceForm::RF_SOLID',
      },
      {
        ClassName: 'Desc_HeavyOilResidue_C',
        mDisplayName: 'Heavy Oil Residue',
        mStackSize: 'EStackSize::SS_FLUID',
        mForm: 'EResourceForm::RF_LIQUID',
      },
      {
        ClassName: 'Desc_SAMIngot_C',
        mDisplayName: 'Reanimated SAM',
        mStackSize: 'EStackSize::SS_MEDIUM',
      },
      { ClassName: 'Desc_DarkMatter_C', mDisplayName: 'Dark Matter Crystal', mStackSize: 'EStackSize::SS_MEDIUM' },
      { ClassName: 'Desc_Cement_C', mDisplayName: 'Concrete', mStackSize: 'EStackSize::SS_BIG' },
      { ClassName: 'Desc_Coal_C', mDisplayName: 'Coal', mStackSize: 'EStackSize::SS_BIG', mEnergyValue: '300.000000' },
      // Class-default objects duplicate real entries and must be skipped.
      { ClassName: 'Default__Desc_IronPlate_C', mDisplayName: 'Iron Plate' },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGResourceDescriptor'",
    Classes: [
      {
        ClassName: 'Desc_LiquidOil_C',
        mDisplayName: 'Crude Oil',
        mStackSize: 'EStackSize::SS_FLUID',
        mForm: 'EResourceForm::RF_LIQUID',
        mEnergyValue: '320.000000',
      },
      {
        ClassName: 'Desc_Water_C',
        mDisplayName: 'Water',
        mStackSize: 'EStackSize::SS_FLUID',
        mForm: 'EResourceForm::RF_LIQUID',
      },
      { ClassName: 'Desc_OreIron_C', mDisplayName: 'Iron Ore', mStackSize: 'EStackSize::SS_BIG' },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableManufacturer'",
    Classes: [
      {
        ClassName: 'Build_ConstructorMk1_C',
        mDisplayName: 'Constructor',
        mPowerConsumption: '4.000000',
        mPowerConsumptionExponent: '1.321929',
      },
      {
        ClassName: 'Build_AssemblerMk1_C',
        mDisplayName: 'Assembler',
        mPowerConsumption: '15.000000',
        mPowerConsumptionExponent: '1.321929',
      },
      {
        ClassName: 'Build_OilRefinery_C',
        mDisplayName: 'Refinery',
        mPowerConsumption: '30.000000',
        mPowerConsumptionExponent: '1.321929',
      },
    ],
  },
  {
    NativeClass:
      "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableManufacturerVariablePower'",
    Classes: [
      {
        ClassName: 'Build_Converter_C',
        mDisplayName: 'Converter',
        mPowerConsumption: '0.000000',
        mPowerConsumptionExponent: '1.321929',
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableGeneratorFuel'",
    Classes: [
      {
        ClassName: 'Build_GeneratorCoal_C',
        mDisplayName: 'Coal Generator',
        mPowerProduction: '75.000000',
        mDefaultFuelClasses: `(${ref('Coal/Desc_Coal', 'Desc_Coal_C')})`,
        mSupplementalResourceClass: ref('Water/Desc_Water', 'Desc_Water_C'),
        mSupplementalToPowerRatio: '10.000000',
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableResourceExtractor'",
    Classes: [
      {
        ClassName: 'Build_MinerMk1_C',
        mDisplayName: 'Miner Mk.1',
        mPowerConsumption: '5.000000',
        mAllowedResourceForms: '(EResourceForm::RF_SOLID)',
        mItemsPerCycle: '1',
        mExtractCycleTime: '1.000000',
      },
      {
        ClassName: 'Build_FrackingExtractor_C',
        mDisplayName: 'Resource Well Extractor',
        mPowerConsumption: '0.000000',
        mAllowedResourceForms: '(EResourceForm::RF_LIQUID,EResourceForm::RF_GAS)',
        mItemsPerCycle: '1000',
        mExtractCycleTime: '1.000000',
      },
      { ClassName: 'Default__Build_MinerMk1_C', mDisplayName: 'Miner Mk.1' },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableFrackingActivator'",
    Classes: [
      {
        ClassName: 'Build_FrackingSmasher_C',
        mDisplayName: 'Resource Well Pressurizer',
        mPowerConsumption: '150.000000',
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGSchematic'",
    Classes: [
      {
        ClassName: 'Schematic_2-1_C',
        mDisplayName: 'Part Assembly',
        mType: 'ESchematicType::EST_Milestone',
        mTechTier: '2',
        mCost: `((ItemClass=${ref('IronPlate/Desc_IronPlate', 'Desc_IronPlate_C')},Amount=150))`,
        // The real file inlines the unlock objects, each listing its recipes.
        mUnlocks:
          '((Class="/Script/FactoryGame.FGUnlockRecipe",mRecipes=(' +
          `${ref('Recipes/Recipe_Plastic', 'Recipe_Plastic_C')})))`,
      },
      {
        ClassName: 'Schematic_Alternate_CoatedIronPlate_C',
        mDisplayName: 'Alternate: Coated Iron Plate',
        mType: 'ESchematicType::EST_Alternate',
        mTechTier: '0',
        mCost: '()',
        mUnlocks:
          '((Class="/Script/FactoryGame.FGUnlockRecipe",mRecipes=(' +
          `${ref('Recipes/Recipe_Alternate_CoatedIronPlate', 'Recipe_Alternate_CoatedIronPlate_C')})))`,
      },
      {
        // Unlocks nothing we model, so it should be dropped.
        ClassName: 'Schematic_Customization_C',
        mDisplayName: 'Paint',
        mType: 'ESchematicType::EST_Customization',
        mTechTier: '1',
        mUnlocks: '()',
      },
    ],
  },
])

describe('Unreal property parsing', () => {
  it('pulls the class name out of every reference shape', () => {
    expect(classNameOf(ref('IronIngot/Desc_IronIngot', 'Desc_IronIngot_C'))).toBe('Desc_IronIngot_C')
    expect(classNameOf('/Game/FactoryGame/Build_ConstructorMk1.Build_ConstructorMk1_C')).toBe(
      'Build_ConstructorMk1_C',
    )
    expect(classNameOf('Desc_Coal_C')).toBe('Desc_Coal_C')
    expect(classNameOf('  "/Game/A.B_C"  ')).toBe('B_C')
  })

  it('parses ingredient lists and converts fluids from litres', () => {
    const isFluid = (item: string): boolean => item === 'Desc_LiquidOil_C'
    const stacks = parseStacks(
      `((ItemClass=${ref('a/Desc_LiquidOil', 'Desc_LiquidOil_C')},Amount=3000),` +
        `(ItemClass=${ref('b/Desc_IronIngot', 'Desc_IronIngot_C')},Amount=3))`,
      isFluid,
    )
    expect(stacks).toEqual([
      { item: 'Desc_LiquidOil_C', amount: 3 },
      { item: 'Desc_IronIngot_C', amount: 3 },
    ])
  })

  it('returns nothing for empty or malformed stack strings', () => {
    const none = (): boolean => false
    expect(parseStacks('', none)).toEqual([])
    expect(parseStacks('()', none)).toEqual([])
    expect(parseStacks(undefined, none)).toEqual([])
    expect(parseStacks('garbage', none)).toEqual([])
  })

  it('parses producedIn lists, keeping only buildings', () => {
    expect(
      parseProducedIn(`(${ref('a/Build_ConstructorMk1', 'Build_ConstructorMk1_C')})`),
    ).toEqual(['Build_ConstructorMk1_C'])
    expect(parseProducedIn('()')).toEqual([])
    expect(parseProducedIn('/Game/A.BP_WorkBench_C')).toEqual([])
  })

  it('reads enum values', () => {
    expect(parseEnum('EResourceForm::RF_LIQUID')).toBe('RF_LIQUID')
    expect(parseEnum('EStackSize::SS_BIG')).toBe('SS_BIG')
    expect(parseEnum(undefined)).toBe('')
    // A single-entry list still carries the surrounding parentheses.
    expect(parseEnum('(EResourceForm::RF_SOLID)')).toBe('RF_SOLID')
  })

  it('reads enum lists without dropping all but the last entry', () => {
    expect(parseEnumList('(EResourceForm::RF_LIQUID,EResourceForm::RF_GAS)')).toEqual([
      'RF_LIQUID',
      'RF_GAS',
    ])
    expect(parseEnumList('(EResourceForm::RF_SOLID)')).toEqual(['RF_SOLID'])
    expect(parseEnumList('()')).toEqual([])
    expect(parseEnumList(['EResourceForm::RF_SOLID'])).toEqual(['RF_SOLID'])
  })
})

describe('parseDocs', () => {
  const data = parseDocs(SAMPLE, '1.2-test')

  it('stamps the version it was told', () => {
    expect(data.gameVersion).toBe('1.2-test')
  })

  it('reads the Iron Plate recipe exactly as the game states it', () => {
    const recipe = data.recipes.find((r) => r.className === 'Recipe_IronPlate_C')!
    expect(recipe.time).toBe(6)
    expect(recipe.ingredients).toEqual([{ item: 'Desc_IronIngot_C', amount: 3 }])
    expect(recipe.products).toEqual([{ item: 'Desc_IronPlate_C', amount: 2 }])
    // Machines are stored by descriptor id, not the docs' Build_ id.
    expect(recipe.machine).toBe('Desc_ConstructorMk1_C')
  })

  it('converts fluid amounts from litres to cubic metres', () => {
    const plastic = data.recipes.find((r) => r.className === 'Recipe_Plastic_C')!
    expect(plastic.ingredients).toEqual([{ item: 'Desc_LiquidOil_C', amount: 3 }])
    expect(plastic.products).toEqual([
      { item: 'Desc_Plastic_C', amount: 2 },
      { item: 'Desc_HeavyOilResidue_C', amount: 1 },
    ])
  })

  it('flags alternate recipes', () => {
    expect(data.recipes.find((r) => r.className === 'Recipe_Alternate_CoatedIronPlate_C')!.alternate).toBe(true)
    expect(data.recipes.find((r) => r.className === 'Recipe_IronPlate_C')!.alternate).toBe(false)
  })

  it('carries the variable power band from the recipe', () => {
    const dark = data.recipes.find((r) => r.className === 'Recipe_DarkMatter_C')!
    expect(dark.minPower).toBe(250)
    expect(dark.maxPower).toBe(750)
  })

  it('ignores recipes that no machine builds', () => {
    expect(data.recipes.some((r) => r.className === 'Recipe_Wall_C')).toBe(false)
  })

  it('reads machine power and renames buildings to descriptor ids', () => {
    const constructor = data.machines.find((m) => m.className === 'Desc_ConstructorMk1_C')!
    expect(constructor.name).toBe('Constructor')
    expect(constructor.powerConsumption).toBe(4)
    expect(constructor.powerExponent).toBeCloseTo(1.321929, 6)
    expect(data.machines.every((m) => !m.className.startsWith('Build_'))).toBe(true)
  })

  it('reads generators with their fuel and water ratio', () => {
    const coal = data.generators.find((g) => g.className === 'Desc_GeneratorCoal_C')!
    expect(coal.powerProduction).toBe(75)
    expect(coal.fuel).toEqual(['Desc_Coal_C'])
    expect(coal.waterToPowerRatio).toBe(10)
  })

  it('reads extractors, including the zero-power well extractor', () => {
    const mk1 = data.miners.find((m) => m.className === 'Desc_MinerMk1_C')!
    expect(mk1.itemsPerMinute).toBe(60)
    expect(mk1.powerConsumption).toBe(5)
    expect(mk1.allowSolids).toBe(true)

    const well = data.miners.find((m) => m.className === 'Desc_FrackingExtractor_C')!
    expect(well.powerConsumption).toBe(0)
    expect(well.allowLiquids).toBe(true)
  })

  it('reads the Pressurizer that actually pays a well its power', () => {
    const pressurizer = data.supportBuildings.find((b) => b.className === 'Desc_FrackingSmasher_C')!
    expect(pressurizer.powerConsumption).toBe(150)
  })

  it('reads schematics with their tier, cost and unlocked recipes', () => {
    const milestone = data.schematics.find((s) => s.className === 'Schematic_2-1_C')!
    expect(milestone.kind).toBe('milestone')
    expect(milestone.tier).toBe(2)
    expect(milestone.recipes).toEqual(['Recipe_Plastic_C'])
    expect(milestone.cost).toEqual([{ item: 'Desc_IronPlate_C', amount: 150 }])

    const alternate = data.schematics.find(
      (s) => s.className === 'Schematic_Alternate_CoatedIronPlate_C',
    )!
    expect(alternate.kind).toBe('alternate')
    expect(alternate.recipes).toEqual(['Recipe_Alternate_CoatedIronPlate_C'])
  })

  it('drops schematics that unlock nothing we model', () => {
    expect(data.schematics.some((s) => s.className === 'Schematic_Customization_C')).toBe(false)
  })

  it('skips Unreal class-default objects', () => {
    expect(data.items.some((i) => i.className.startsWith('Default__'))).toBe(false)
    expect(data.miners.some((m) => m.className.includes('Default__'))).toBe(false)
    expect(data.items.filter((i) => i.className === 'Desc_IronPlate_C')).toHaveLength(1)
  })

  it('maps stack size enums to numbers', () => {
    expect(data.items.find((i) => i.className === 'Desc_IronPlate_C')!.stackSize).toBe(200)
    expect(data.items.find((i) => i.className === 'Desc_LiquidOil_C')!.stackSize).toBe(50_000)
  })

  it('marks fluids', () => {
    expect(data.items.find((i) => i.className === 'Desc_LiquidOil_C')!.liquid).toBe(true)
    expect(data.items.find((i) => i.className === 'Desc_IronPlate_C')!.liquid).toBe(false)
  })

  it('lists only raw resources the file actually contains', () => {
    expect(data.resources).toContain('Desc_OreIron_C')
    expect(data.resources).toContain('Desc_Water_C')
    expect(data.resources).not.toContain('Desc_OreUranium_C')
  })
})

describe('failure handling', () => {
  it('rejects a file that is not JSON', () => {
    expect(() => parseDocs('not json')).toThrow(DocsParseError)
  })

  it('rejects JSON that is not the docs shape', () => {
    expect(() => parseDocs('{"hello":"world"}')).toThrow(DocsParseError)
    expect(() => parseDocs('[]')).toThrow(DocsParseError)
  })

  it('tolerates a byte order mark left at the front', () => {
    expect(() => parseDocs('﻿' + SAMPLE)).not.toThrow()
  })

  it('reports every reason a thin dataset is unusable rather than the first', () => {
    const problems = validateGameData(parseDocs(SAMPLE))
    // The sample is deliberately tiny, so the count checks must all complain.
    expect(problems.length).toBeGreaterThan(3)
    expect(problems.join(' ')).toMatch(/items/)
    expect(problems.join(' ')).toMatch(/recipes/)
  })

  it('passes the values it does have, so real data is not flagged spuriously', () => {
    const problems = validateGameData(parseDocs(SAMPLE)).join(' ')
    // These come from the sample and are correct; only the counts should fail.
    expect(problems).not.toMatch(/Constructor draws/)
    expect(problems).not.toMatch(/Iron Plate takes/)
    expect(problems).not.toMatch(/Coal Generator produces/)
    expect(problems).not.toMatch(/Crude Oil/)
  })
})
