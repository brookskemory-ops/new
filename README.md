# 🃏 The Dealer Below

**A deckbuilding roguelike where the dungeon holds a deck of its own.**

You descend with a deck of cards and a lantern. The dungeon — the Dealer — plays back:
every round it reveals a **tell**, a face-up card from its own deck, and after its
creatures act, it plays that card against you. Cave-ins, hexes, reinforcements,
darkness that steals your draw.

The twist is that its deck is a real deck, and you can fight it directly:

- **Snuff** its tell before it resolves
- **Unravel** and burn cards off the top of its deck — burned cards are gone for the whole fight
- **Bind** its hand so it skips rounds
- **Mirror** its own card back against its creatures
- Empty its deck entirely and it stands exhausted while you work

Meanwhile, the Dealer **learns**: as you descend, it pens new and nastier cards into
its deck. Certain events let you burn its cards *permanently* — or tempt you into
trades that make it stronger.

Built with vanilla HTML5/JS/Canvas, chunky pixel art, no dependencies, no build step.
One-time-purchase philosophy: no ads, no pay-to-win, ever.

## ▶️ Play it

Open `index.html` in any browser — that's it. Or enable GitHub Pages
(**Settings → Pages → Deploy from branch → `main` / root**) and play at
`https://brookskemory-ops.github.io/new/` on any device, including your phone.

## 🎮 How to play

- Each turn: 3 ⚡ energy, draw 5. Click a card to play it (click an enemy if it needs a target).
- Enemy **intents** (⚔ numbers) show what's coming. Block absorbs damage but expires.
- The Dealer's panel (right) shows its deck size and its current **tell** — that card
  resolves after the enemies act. Plan around it, or destroy it.
- Fights reward gold and a card. Elites and the boss are marked. Rest heals.
  The Pale Merchant sells cards and card removal.
- Act I ends at **The Table**, where the Dealer plays **two tells per round**.

## 🗺️ Roadmap

- **v0.1 (this)** — Act I: 10 floors, 27 player cards, 13 Dealer cards, 6 enemies,
  elite + boss, 3 events, shop, run stats
- v0.2 — card upgrades at rest sites, potions/trinkets (relics), more events,
  sound (WebAudio), damage numbers + hit animations, save/resume mid-run
- v0.3 — Act II with a second Dealer archetype (aggressive vs controlling decks),
  branching map instead of linear floors, unlockable cards
- v0.4 — second playable character, ascension-style difficulty ladder, daily seed runs
- v1.0 — balance pass from playtesting, Steam packaging (Electron), itch.io release

## 🧱 Project layout

```
index.html        entry point
css/style.css     all styling (dark, torchlit, CSS-only effects)
js/sprites.js     16×16 pixel sprite maps + canvas renderer
js/data.js        cards, Dealer cards, enemies, encounters, events
js/combat.js      combat engine + combat screen
js/game.js        run state, floors, events, shop, rewards, screens
```
