/**
 * The in-app tutorial. Written for someone who has just opened the tool for the
 * first time and may also be new to Satisfactory's ratio maths.
 */
import type { ReactNode } from 'react'

import { Panel } from '../components/ui'
import { gameData } from '../data/constants'

export function Guide({ onGoTo }: { onGoTo: (tab: string) => void }) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-8">
      <Panel>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">
          How to use this
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-slate-300">
          Satisfactory is a game of ratios. Every build comes down to the same question — how many
          machines, fed at what rate, drawing how much power. This tool answers that so you don't
          have to do it on paper.
        </p>
        <p className="mt-3 max-w-prose leading-relaxed text-slate-400">
          If you read one section, make it the next one.
        </p>
      </Panel>

      <Panel title="Start here">
        <ol className="space-y-4">
          <Step n={1} title="Pick what you want to build">
            On the <TabLink onGoTo={onGoTo} tab="planner">Planner</TabLink> tab, type an item into
            the search box — say <Code>Reinforced Iron Plate</Code>.
          </Step>
          <Step n={2} title="Say how fast you want it">
            Enter a rate in items per minute. <Code>30</Code> is a reasonable early target.
          </Step>
          <Step n={3} title="Read the answer">
            The production chain fills in: every intermediate step, how many machines each needs,
            and the ore the map has to supply. Alongside it, the totals — machines, megawatts, raw
            resources per minute.
          </Step>
        </ol>
        <p className="mt-4 border-t border-slate-800 pt-3 text-sm text-slate-400">
          That's the whole core loop. Everything else refines it.
        </p>
      </Panel>

      <Panel title="Reading the production chain">
        <p className="mb-3 max-w-prose text-sm leading-relaxed text-slate-300">
          Each row is one step in the chain, indented under whatever consumes it. A row reads:
        </p>
        <div className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/70 p-3">
          <div className="flex min-w-[30rem] items-center gap-3 text-sm whitespace-nowrap">
            <span className="font-medium text-slate-100">Iron Plate</span>
            <span className="tabular text-ficsit-400">180/min</span>
            <span className="text-xs text-slate-400">9× Constructor @ 100%</span>
            <span className="text-xs text-slate-500">36 MW</span>
          </div>
        </div>
        <dl className="mt-3 space-y-2 text-sm">
          <Def term="180/min">
            How much this branch needs. Not the whole factory's output — just what feeds the step
            above it.
          </Def>
          <Def term="9× Constructor">
            Machines required. Where the number isn't whole, the exact figure sits beside it —
            8 machines and a bit still means building 9.
          </Def>
          <Def term="@ 100%">
            The clock speed that runs them at full uptime with nothing idling.
          </Def>
          <Def term="36 MW">Power this step draws at that clock.</Def>
        </dl>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-slate-400">
          Rows tagged <Tag tone="raw">raw</Tag> are where the chain stops — ore or fluid straight
          from the map. Every row also has a recipe dropdown and an{' '}
          <span className="text-sky-300">import</span> link, covered below.
        </p>
      </Panel>

      <Panel title="The six tabs">
        <div className="grid gap-3 sm:grid-cols-2">
          <TabCard onGoTo={onGoTo} tab="planner" name="Planner">
            The centrepiece. Target item and rate in, full chain out. Start here.
          </TabCard>
          <TabCard onGoTo={onGoTo} tab="efficiency" name="Efficiency">
            Clock speed maths. Its best trick: tell it how much input you actually have and it
            works out the machine count and clock that wastes nothing.
          </TabCard>
          <TabCard onGoTo={onGoTo} tab="power" name="Power">
            How many generators for a target output, the fuel and water they need, and the factory
            required to make that fuel.
          </TabCard>
          <TabCard onGoTo={onGoTo} tab="logistics" name="Logistics">
            Belts, pipes, miners and splitters. Which belt tier carries a rate, what a node yields,
            whether a split divides cleanly.
          </TabCard>
          <TabCard onGoTo={onGoTo} tab="sink" name="Sink">
            What's worth feeding the AWESOME Sink, ranked by points per unit of ore spent.
          </TabCard>
          <TabCard onGoTo={onGoTo} tab="unlocks" name="Unlocks">
            Tick off what you've actually unlocked and the Planner stops suggesting things you
            can't build yet.
          </TabCard>
        </div>
      </Panel>

      <Panel title="Things worth understanding">
        <div className="space-y-5">
          <Concept title="Underclocking is nearly free; overclocking is expensive">
            <p>
              Power scales with clock speed raised to the power of{' '}
              <span className="tabular text-slate-200">1.321929</span>, not linearly. Two machines
              at 50% therefore use noticeably <em>less</em> power than one at 100% for the same
              output, while one at 250% costs about{' '}
              <span className="tabular text-amber-400">3.4×</span> the power for 2.5× the output.
            </p>
            <p>
              So: underclock to hit an exact ratio, and overclock only when floor space or a
              limited node matters more than power. The{' '}
              <TabLink onGoTo={onGoTo} tab="efficiency">Efficiency</TabLink> tab shows the trade
              for any recipe.
            </p>
          </Concept>

          <Concept title="Machine counts are exact, so ratios come out ugly">
            <p>
              The planner gives fractional machines because that's the honest answer. 6.25 Smelters
              means either 7 machines underclocked to 89.2857%, or 6 at full speed and one at 25%.
              Both run at full uptime; the first uses less power, the second is easier to build
              incrementally.
            </p>
          </Concept>

          <Concept title="Alternate recipes are the real optimisation">
            <p>
              Hard drives unlock alternate recipes, and some drastically cut ore use. The Planner
              lists which ones would help <em>your current plan</em> and by how much — so you know
              which drives are worth hunting rather than guessing.
            </p>
            <p className="text-slate-400">
              The percentage counts every raw resource together, so a recipe trading ore for oil can
              still show as a saving. Worth a glance at what it's actually swapping.
            </p>
          </Concept>

          <Concept title="Byproducts have to go somewhere">
            <p>
              Some recipes emit a second output — Plastic makes Heavy Oil Residue, nuclear fuel
              makes waste. Left alone these back up and stall the whole line.
            </p>
            <p>
              By default they're listed as <strong className="text-slate-200">surplus</strong> so
              you can plan to sink or store them. Tick{' '}
              <em>Feed byproducts back in</em> and the planner instead subtracts them from demand
              elsewhere, which is what you'd really plumb.
            </p>
          </Concept>

          <Concept title="Every row is a belt you have to build">
            <p>
              Each step shows the belt that carries it — <Tag tone="belt">Mk.4</Tag> style badges in
              the chain, and a full list in <strong className="text-slate-200">Belts &amp; pipes</strong>{' '}
              showing what feeds what.
            </p>
            <p>
              Set <em>Best belt you have</em> to the tier you've actually unlocked. Anything a
              single belt can't carry is flagged in amber as{' '}
              <span className="tabular">3× Mk.2</span> or similar — that's a splitter and parallel
              lines, not one belt. It's usually the cheapest signal that a design needs rethinking.
            </p>
            <p className="text-slate-400">
              Fluids ignore the setting and use pipes: Mk.1 moves 300 m³/min, Mk.2 moves 600.
            </p>
          </Concept>

          <Concept title="Import anything you're making somewhere else">
            <p>
              The <span className="text-sky-300">import</span> link on any row stops the chain
              expanding there and treats that item as shipped in. Useful when you already have a
              plate factory and only want to plan what's downstream of it.
            </p>
          </Concept>

          <Concept title="Your plan lives in the URL">
            <p>
              Target, rate, recipe choices and imports are all encoded into the address bar and
              saved in this browser. <em>Copy share link</em> puts that address on your clipboard —
              bookmark it, or send a factory design to someone else.
            </p>
          </Concept>
        </div>
      </Panel>

      <Panel title="Try these">
        <ul className="space-y-3 text-sm">
          <Example title="A starter smelting line">
            Planner → <Code>Iron Plate</Code> at <Code>20</Code>/min. One Smelter, one Constructor,
            30 ore a minute, 8 MW. The smallest complete chain in the game.
          </Example>
          <Example title="Sizing to a node you actually have">
            Efficiency → recipe <Code>Iron Ingot</Code>, size by <em>Input I have</em>,{' '}
            <Code>187.5</Code>/min — a pure node under a Mk.2 miner. It answers: 7 Smelters at
            89.2857%.
          </Example>
          <Example title="What a coal plant really costs">
            Power → Coal Generator, <Code>600</Code> MW. Eight generators, 120 coal a minute, 360 m³
            of water, three Water Extractors.
          </Example>
          <Example title="Whether your belt can cope">
            Logistics → <Code>780</Code>/min. Mk.5 carries it on one belt; anything less needs
            parallel lines.
          </Example>
        </ul>
      </Panel>

      <Panel title="About the numbers">
        <div className="space-y-3 text-sm leading-relaxed text-slate-300">
          <p>
            Recipe data is bundled from Satisfactory{' '}
            <span className="tabular text-slate-100">{gameData.gameVersion}</span> —{' '}
            {gameData.recipes.length} machine recipes across {gameData.items.length} items.
          </p>
          <p className="text-slate-400">
            The game is on 1.2. Neither 1.1 nor 1.2 changed any recipe, machine power, belt
            throughput or generator figure, so these numbers still hold; what's missing is newer
            content. If something looks wrong, trust the in-game recipe screen and say so — that
            would be a data problem, not a maths problem.
          </p>
        </div>
      </Panel>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ficsit-600 text-xs font-bold text-white">
        {n}
      </span>
      <div>
        <div className="font-medium text-slate-100">{title}</div>
        <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-slate-400">{children}</p>
      </div>
    </li>
  )
}

function Def({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="tabular w-32 shrink-0 font-medium text-ficsit-400">{term}</dt>
      <dd className="max-w-prose leading-relaxed text-slate-400">{children}</dd>
    </div>
  )
}

function Concept({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="font-medium text-slate-100">{title}</h3>
      <div className="mt-1 max-w-prose space-y-2 text-sm leading-relaxed text-slate-400">
        {children}
      </div>
    </div>
  )
}

function Example({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2">
      <div className="font-medium text-slate-200">{title}</div>
      <p className="mt-0.5 leading-relaxed text-slate-400">{children}</p>
    </li>
  )
}

function TabCard({
  onGoTo,
  tab,
  name,
  children,
}: {
  onGoTo: (tab: string) => void
  tab: string
  name: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onGoTo(tab)}
      className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-left transition hover:border-ficsit-700 hover:bg-ficsit-950/20"
    >
      <div className="font-medium text-ficsit-400">{name}</div>
      <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{children}</p>
    </button>
  )
}

function TabLink({
  onGoTo,
  tab,
  children,
}: {
  onGoTo: (tab: string) => void
  tab: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onGoTo(tab)}
      className="font-medium text-ficsit-400 underline decoration-dotted underline-offset-2 transition hover:text-ficsit-300"
    >
      {children}
    </button>
  )
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200">{children}</code>
  )
}

function Tag({ children, tone }: { children: ReactNode; tone: 'raw' | 'belt' }) {
  const tones = {
    raw: 'bg-emerald-950 text-emerald-400',
    belt: 'bg-slate-800 text-slate-300',
  }
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
}
