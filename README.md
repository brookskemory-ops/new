# Satisfactory Companion

A factory planner and calculator suite for [Satisfactory](https://www.satisfactorygame.com/).
Built to sit on a second monitor (or a phone) while you play, so you can stop
doing ratio arithmetic on paper.

Everything runs in the browser. The game data is bundled into the page, so it
works offline once loaded and there is no backend to run.

## What it does

**Planner** — Pick a target item and a rate, get the whole production chain:
every recipe, exact machine counts, input rates at each step, total power draw,
and the raw ore and fluid the map has to supply. You can override the recipe at
any node, mark an item as "imported" when you're shipping it in from another
factory, and choose whether byproducts get fed back in or listed as surplus. It
also flags which hard-drive alternates would actually cut this plan's resource
use, so you know which ones are worth chasing.

**Efficiency** — The clock speed maths. How many machines and at what clock to
run at exactly 100% uptime with nothing idling and nothing backing up — sized
either from the output you want or from the input you already have. Power scales
with `clock ^ 1.321929`, so it shows you the three real arrangements (even
underclock, full-speed-plus-remainder, overclocked) with the power cost of each.
Also covers Power Shards and Somersloop amplification.

**Power** — How many coal, fuel or nuclear generators for a target MW, the fuel
and water they need, the factory required to make that fuel, and the net power
left after that factory takes its own cut. Includes nuclear waste output.

**Logistics** — Belt and pipe throughput (how many lines, which tier, at what
utilisation), extractor output for any node purity × miner tier × clock, and
splitter ratios — including a warning when a split doesn't divide cleanly into
2s and 3s and needs a balancer.

**Sink** — AWESOME Sink rankings by points per unit of raw resource spent, which
is the number that matters when you're building a factory purely to feed the
sink, plus the coupon cost curve.

**Unlocks** — Tick off the milestones, MAM research and alternate recipes you've
actually unlocked. The planner then only proposes recipes you can build. Stored
in your browser; with nothing ticked it falls back to using every recipe.

## Running it

```bash
npm install
npm run dev      # local dev server
npm run test     # unit tests
npm run build    # production build into dist/
npm run preview  # serve the production build
```

## Desktop app

There's a Tauri shell, so it also builds as a native Windows app — about 10 MB,
using the WebView2 runtime already on Windows 10 and 11.

```bash
npm run tauri:dev    # desktop app in dev mode
npm run tauri:build  # installers into src-tauri/target/release/bundle/
```

Building a Windows binary has to happen on Windows, so
`.github/workflows/release.yml` does it on a Windows runner. Run it by hand from
the Actions tab to get an installer as a downloadable artifact, or push a `v*`
tag to publish a release.

**Windows will show a SmartScreen warning the first time you run it** — the
installer isn't code signed, which needs a paid certificate. Choose *More info*
then *Run anyway*.

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. That needs Pages set to "GitHub Actions" as its
source once, under repository Settings → Pages.

The site is built for a project-site path (`/new/`). Serving from a domain root
instead just needs `BASE_PATH=/ npm run build`.

## How it's put together

```
scripts/build-data.ts   downloads the upstream game data and slims it
src/data/               the bundled dataset, its types, and constants
src/engine/             all calculation logic — pure TypeScript, no React
src/features/           one module per tab
src/components/         shared UI pieces
```

The engine is deliberately kept free of React so it can be tested directly.
`src/engine/engine.test.ts` covers it, including checks against hand-verified
in-game values (a Constructor draws 4 MW at 100% and 13.43 MW at 250%; an Iron
Plate Constructor takes 30 ingots/min and makes 20 plates/min; a Coal Generator
burns 15 coal/min and 45 m³ water/min) and an exhaustive pass that solves every
producible item in the game to prove nothing hangs on a recipe loop.

## Game data

Recipe data covers Satisfactory **1.0** and is bundled at
`src/data/game-data.json` — 152 items, 276 machine recipes, all machines,
generators, extractors and 208 unlock schematics.

To rebuild it from the community dump:

```bash
npm run build:data
```

The committed output means CI and the browser never need network access.

### Getting data for the version you're playing

The game is on 1.2 and the bundled data is 1.0. Neither 1.1 nor 1.2 changed any
recipe, machine power, throughput or generator figure — I checked both sets of
patch notes — so the numbers here are still right. What's missing is 1.2's new
content, such as the Fluid Truck Station.

No public dataset exists past 1.0, but your game ships its own. Point the build
script at it:

```bash
npm run build:data -- --docs "C:\Program Files\Epic Games\SatisfactoryEarlyAccess\CommunityResources\Docs\en-US.json"
```

Steam installs put it under
`steamapps\common\Satisfactory\CommunityResources\Docs` instead.

The parser checks its own output before writing — item and recipe counts, a
Constructor at 4 MW, Iron Plate at 6 s for 3 ingots, a Coal Generator at 75 MW,
and Plastic consuming 3 m³ of oil so fluid units can't silently be off by 1000.
If any check fails it writes nothing and tells you what looked wrong, rather than
leaving you with a tool that computes confident nonsense.

It's tested against a real game docs export, but only you can run it against a
genuine 1.2 file — if it rejects yours, send me the message and I'll fix the
parser.

## Credits

Game data derived from
[greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools) (MIT).
Only the numeric recipe data is used; that project's image assets are
copyrighted by Coffee Stain Studios and are deliberately not included here.

Satisfactory is a trademark of Coffee Stain Studios. This is an unofficial
fan-made tool with no affiliation.
