/* The Dealer Below — all game data: player cards, dealer cards, enemies, encounters, events */

/* ---------- Player cards ----------
   effect(api, target) — api is provided by combat.js.
   target is an enemy object when targeting === 'enemy', else null. */

const CARDS = {
  // Starters
  strike:   { name: 'Strike', type: 'attack', cost: 1, rarity: 'starter', targeting: 'enemy',
              text: 'Deal 6 damage.',
              effect: (a, t) => a.dmg(t, 6) },
  guard:    { name: 'Guard', type: 'skill', cost: 1, rarity: 'starter', targeting: 'none',
              text: 'Gain 5 Block.',
              effect: (a) => a.block(5) },
  snuff:    { name: 'Snuff', type: 'skill', cost: 1, rarity: 'common', targeting: 'none',
              text: "Destroy the Dealer's tell. It fumbles this round.",
              effect: (a) => a.destroyTell() },

  // Commons
  heavyblow:  { name: 'Heavy Blow', type: 'attack', cost: 2, rarity: 'common', targeting: 'enemy',
                text: 'Deal 13 damage.',
                effect: (a, t) => a.dmg(t, 13) },
  twincut:    { name: 'Twin Cut', type: 'attack', cost: 1, rarity: 'common', targeting: 'enemy',
                text: 'Deal 4 damage twice.',
                effect: (a, t) => { a.dmg(t, 4); a.dmg(t, 4); } },
  gravespike: { name: 'Grave Spike', type: 'attack', cost: 0, rarity: 'common', targeting: 'enemy',
                text: 'Deal 4 damage.',
                effect: (a, t) => a.dmg(t, 4) },
  pyre:       { name: 'Pyre', type: 'attack', cost: 1, rarity: 'common', targeting: 'all',
                text: 'Deal 5 damage to ALL enemies.',
                effect: (a) => a.aoe(5) },
  venomfang:  { name: 'Venom Fang', type: 'attack', cost: 1, rarity: 'common', targeting: 'enemy',
                text: 'Deal 4 damage. Apply 3 Poison.',
                effect: (a, t) => { a.dmg(t, 4); a.poison(t, 3); } },
  sidestep:   { name: 'Sidestep', type: 'skill', cost: 0, rarity: 'common', targeting: 'none',
                text: 'Gain 4 Block.',
                effect: (a) => a.block(4) },
  bulwark:    { name: 'Bulwark', type: 'skill', cost: 2, rarity: 'common', targeting: 'none',
                text: 'Gain 13 Block.',
                effect: (a) => a.block(13) },
  secondwind: { name: 'Second Wind', type: 'skill', cost: 1, rarity: 'common', targeting: 'none',
                text: 'Draw 2 cards. Gain 2 Block.',
                effect: (a) => { a.draw(2); a.block(2); } },
  unravel:    { name: 'Unravel', type: 'skill', cost: 1, rarity: 'common', targeting: 'none',
                text: "Burn the top 2 cards of the Dealer's deck. Draw 1 card.",
                effect: (a) => { a.burnDealer(2); a.draw(1); } },

  // Uncommons
  lanternstrike: { name: 'Lantern Strike', type: 'attack', cost: 1, rarity: 'uncommon', targeting: 'enemy',
                   text: 'Deal 8 damage. Deals 13 instead if the Dealer has no tell.',
                   effect: (a, t) => a.dmg(t, a.dealerHasTell() ? 8 : 13) },
  bounty:        { name: 'Bounty', type: 'attack', cost: 1, rarity: 'uncommon', targeting: 'enemy',
                   text: 'Deal 8 damage. If this kills, gain 10 Gold.',
                   effect: (a, t) => { const dead = a.dmg(t, 8); if (dead) a.gold(10); } },
  dirge:         { name: 'Dirge', type: 'skill', cost: 1, rarity: 'uncommon', targeting: 'none',
                   text: 'Apply 2 Weak to ALL enemies.',
                   effect: (a) => a.applyAll('weak', 2) },
  oilflask:      { name: 'Oil Flask', type: 'skill', cost: 0, rarity: 'uncommon', targeting: 'none', exhaust: true,
                   text: 'Gain 1 Energy. Exhaust.',
                   effect: (a) => a.energy(1) },
  pilfer:        { name: 'Pilfer', type: 'skill', cost: 1, rarity: 'uncommon', targeting: 'none',
                   text: "Destroy the Dealer's tell. Gain 10 Gold.",
                   effect: (a) => { a.destroyTell(); a.gold(10); } },
  bind:          { name: 'Bind', type: 'skill', cost: 2, rarity: 'uncommon', targeting: 'none',
                   text: 'The Dealer skips its next 2 rounds.',
                   effect: (a) => a.stunDealer(2) },
  cleansingflame:{ name: 'Cleansing Flame', type: 'skill', cost: 1, rarity: 'uncommon', targeting: 'none',
                   text: 'Exhaust all Curses in your hand. Gain 5 Block for each.',
                   effect: (a) => a.cleanseCurses(5) },
  waxward:       { name: 'Wax Ward', type: 'power', cost: 1, rarity: 'uncommon', targeting: 'none',
                   text: 'Whenever the Dealer plays a card, gain 4 Block.',
                   effect: (a) => a.power('waxward') },
  scavengerseye: { name: "Scavenger's Eye", type: 'power', cost: 1, rarity: 'uncommon', targeting: 'none',
                   text: 'Whenever you destroy or burn a Dealer card, draw 1 card.',
                   effect: (a) => a.power('scavengerseye') },

  // Rares
  mirrorofash: { name: 'Mirror of Ash', type: 'skill', cost: 2, rarity: 'rare', targeting: 'none',
                 text: 'The tell strikes the dungeon instead: its effect is turned against the enemies.',
                 effect: (a) => a.mirrorTell() },
  kindledblade:{ name: 'Kindled Blade', type: 'power', cost: 2, rarity: 'rare', targeting: 'none',
                 text: 'Gain 3 Strength.',
                 effect: (a) => a.strength(3) },
  reaperstoll: { name: "Reaper's Toll", type: 'attack', cost: 2, rarity: 'rare', targeting: 'all',
                 text: 'Deal 8 damage to ALL enemies. Apply 1 Vulnerable to ALL enemies.',
                 effect: (a) => { a.aoe(8); a.applyAll('vuln', 1); } },
  hundredcuts: { name: 'Hundred Cuts', type: 'attack', cost: 3, rarity: 'rare', targeting: 'enemy',
                 text: 'Deal 3 damage 6 times.',
                 effect: (a, t) => { for (let i = 0; i < 6; i++) a.dmg(t, 3); } },
  extinguish:  { name: 'Extinguish', type: 'skill', cost: 3, rarity: 'rare', targeting: 'none', exhaust: true,
                 text: "Burn the top 4 cards of the Dealer's deck. It skips a round. Exhaust.",
                 effect: (a) => { a.burnDealer(4); a.stunDealer(1); } },

  // Curse
  rot: { name: 'Rot', type: 'curse', cost: -1, rarity: 'curse', targeting: 'none',
         text: 'Unplayable. If Rot is in your hand at the end of turn, take 2 damage.',
         effect: null },
};

const STARTER_DECK = ['strike','strike','strike','strike','strike','guard','guard','guard','guard','snuff'];

const CARD_POOL = Object.keys(CARDS).filter(id =>
  ['common','uncommon','rare'].includes(CARDS[id].rarity));

function randomPoolCard(rng) {
  const roll = rng();
  const rarity = roll < 0.60 ? 'common' : roll < 0.90 ? 'uncommon' : 'rare';
  const pool = CARD_POOL.filter(id => CARDS[id].rarity === rarity);
  return pool[Math.floor(rng() * pool.length)];
}

/* ---------- Dealer cards ----------
   effect(api) hurts the player; invert(api) is what Mirror of Ash does instead. */

const DEALER_CARDS = {
  cavein:   { name: 'Cave-In', tier: 1, text: 'The ceiling groans. Deal 7 damage to you.',
              effect: (a) => a.dmgPlayer(7),
              invert: (a) => a.aoeTrue(7) },
  sharpen:  { name: 'Sharpen', tier: 1, text: 'All enemies gain 2 Strength.',
              effect: (a) => a.buffEnemies('str', 2),
              invert: (a) => a.strength(2) },
  boneward: { name: 'Bone Ward', tier: 1, text: 'All enemies gain 7 Block.',
              effect: (a) => a.buffEnemies('block', 7),
              invert: (a) => a.block(7) },
  hex:      { name: 'Hex', tier: 1, text: 'Shuffle a Rot into your discard pile.',
              effect: (a) => a.addCurse(1),
              invert: (a) => a.applyAll('poison', 4) },
  gloom:    { name: 'Gloom', tier: 1, text: 'You draw 1 fewer card next turn.',
              effect: (a) => a.drawDelta(-1),
              invert: (a) => a.drawDelta(1) },
  siphon:   { name: 'Siphon', tier: 1, text: 'You have 1 less Energy next turn.',
              effect: (a) => a.energyDelta(-1),
              invert: (a) => a.energyDelta(1) },
  rattle:   { name: 'Rattle', tier: 1, text: 'Raise a Boneling from the floor.',
              effect: (a) => a.summon('boneling'),
              invert: (a) => a.dmgRandomEnemyTrue(9) },
  mend:     { name: 'Mend', tier: 1, text: 'All enemies heal 4.',
              effect: (a) => a.healEnemies(4),
              invert: (a) => a.healPlayer(4) },

  deepcavein: { name: 'Deep Cave-In', tier: 2, text: 'The dark comes down. Deal 11 damage to you.',
                effect: (a) => a.dmgPlayer(11),
                invert: (a) => a.aoeTrue(11) },
  frenzy:     { name: 'Frenzy', tier: 2, text: 'All enemies gain 3 Strength.',
                effect: (a) => a.buffEnemies('str', 3),
                invert: (a) => a.strength(3) },
  doublehex:  { name: 'Double Hex', tier: 2, text: 'Shuffle 2 Rots into your discard pile.',
                effect: (a) => a.addCurse(2),
                invert: (a) => a.applyAll('poison', 6) },
  drought:    { name: 'Drought', tier: 2, text: '1 less Energy and 1 fewer card next turn.',
                effect: (a) => { a.energyDelta(-1); a.drawDelta(-1); },
                invert: (a) => { a.energyDelta(1); a.drawDelta(1); } },
  gravebloom: { name: 'Grave Bloom', tier: 2, text: 'All enemies heal 8 and gain 4 Block.',
                effect: (a) => { a.healEnemies(8); a.buffEnemies('block', 4); },
                invert: (a) => { a.healPlayer(8); a.block(4); } },
};

const DEALER_BASE_DECK = ['cavein','sharpen','boneward','hex','gloom','siphon','rattle','mend'];
const DEALER_TIER2 = Object.keys(DEALER_CARDS).filter(id => DEALER_CARDS[id].tier === 2);

/* ---------- Enemies ----------
   moves: { name, kind: 'attack'|'defend'|'buff'|'debuff'|'drain', dmg?, times?, block?, apply? }
   ai(enemy, turn, rng) -> move index */

const ENEMIES = {
  boneling: {
    name: 'Boneling', sprite: 'boneling', hp: [13, 16],
    moves: [
      { name: 'Claw', kind: 'attack', dmg: 5 },
      { name: 'Rake', kind: 'attack', dmg: 8 },
      { name: 'Rattle', kind: 'defend', block: 5 },
    ],
    ai: (e, turn, rng) => { const r = rng(); return r < 0.5 ? 0 : r < 0.8 ? 1 : 2; },
  },
  rothound: {
    name: 'Rot Hound', sprite: 'rothound', hp: [24, 28],
    moves: [
      { name: 'Bite', kind: 'attack', dmg: 7 },
      { name: 'Howl', kind: 'buff', apply: { str: 2 } },
      { name: 'Lunge', kind: 'attack', dmg: 11 },
    ],
    ai: (e, turn, rng) => (turn % 3 === 2 ? 2 : rng() < 0.7 ? 0 : 1),
  },
  gravewisp: {
    name: 'Gravewisp', sprite: 'gravewisp', hp: [18, 20],
    moves: [
      { name: 'Chill', kind: 'attack', dmg: 3, apply: { weak: 2 } },
      { name: 'Drain', kind: 'drain', dmg: 6, heal: 3 },
      { name: 'Wail', kind: 'debuff', apply: { vuln: 2 } },
    ],
    ai: (e, turn, rng) => (turn === 0 ? 2 : rng() < 0.5 ? 0 : 1),
  },
  cultist: {
    name: 'Cultist of the Deck', sprite: 'cultist', hp: [22, 26],
    moves: [
      { name: 'Chant', kind: 'buff', apply: { str: 3 } },
      { name: 'Sacrificial Knife', kind: 'attack', dmg: 6 },
    ],
    ai: (e, turn) => (turn === 0 ? 0 : 1),
  },
  deckwarden: {
    name: 'Deck Warden', sprite: 'deckwarden', hp: [48, 48], elite: true,
    passive: 'zealous', passiveText: 'Zealous: gains 2 Strength whenever you disrupt the Dealer.',
    moves: [
      { name: 'Slam', kind: 'attack', dmg: 12 },
      { name: 'Bulwark', kind: 'defend', block: 12 },
      { name: 'Overhead Crush', kind: 'attack', dmg: 16 },
    ],
    ai: (e, turn) => [0, 1, 0, 2][turn % 4],
  },
  dealershand: {
    name: "The Dealer's Hand", sprite: 'dealershand', hp: [85, 85], boss: true,
    moves: [
      { name: 'Crush', kind: 'attack', dmg: 13 },
      { name: 'Flick', kind: 'attack', dmg: 5, times: 2 },
      { name: 'Riffle', kind: 'defend', block: 8, curse: 1 },
      { name: 'Palm', kind: 'buff', block: 10, apply: { str: 2 } },
    ],
    ai: (e, turn) => [0, 1, 2, 1, 3][turn % 5],
  },
};

/* ---------- Encounters ---------- */

const ENCOUNTERS = {
  easy: [
    ['boneling', 'boneling'],
    ['rothound'],
    ['gravewisp', 'boneling'],
    ['cultist'],
  ],
  mid: [
    ['rothound', 'rothound'],
    ['cultist', 'gravewisp'],
    ['boneling', 'boneling', 'boneling'],
    ['cultist', 'rothound'],
    ['gravewisp', 'gravewisp', 'boneling'],
  ],
  elite: [['deckwarden']],
  boss: [['dealershand']],
};

/* ---------- Events ---------- */

const EVENTS = [
  {
    id: 'altar',
    title: 'The Abandoned Altar',
    body: 'A cracked altar, dark with old offerings. The stone is warm. Something below is still listening.',
    choices: [
      { label: 'Offer blood', detail: 'Lose 7 HP. Choose a new card.', action: 'altar_blood' },
      { label: 'Pray', detail: 'Heal 12 HP.', action: 'altar_pray' },
      { label: 'Leave', detail: 'Walk on.', action: 'leave' },
    ],
  },
  {
    id: 'loosecard',
    title: 'A Loose Card',
    body: 'A single card lies face-down in the dust — fallen from the Dealer’s deck. It hums faintly against the stone.',
    choices: [
      { label: 'Pocket it', detail: 'Gain a random card. The Dealer replaces its loss with something worse.', action: 'card_take' },
      { label: 'Feed it to your lantern', detail: 'The Dealer permanently loses a card from its deck.', action: 'card_burn' },
      { label: 'Leave it', detail: 'Some things are bait.', action: 'leave' },
    ],
  },
  {
    id: 'cartographer',
    title: 'The Cartographer’s Corpse',
    body: 'A mapmaker who got far — farther than most. His satchel is intact. His lantern still burns with clean, steady oil.',
    choices: [
      { label: 'Search the satchel', detail: 'Gain 28 Gold.', action: 'carto_gold' },
      { label: 'Take the lantern oil', detail: 'Remove a card from your deck.', action: 'carto_remove' },
      { label: 'Leave him be', detail: 'Walk on.', action: 'leave' },
    ],
  },
];
