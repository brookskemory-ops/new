/* The Dealer Below — run state, map flow, events, shop, rewards, screens */

let Run = null;

const FLOORS = [
  { name: 'The Threshold',   options: [{ type: 'fight', pool: 'easy' }] },
  { name: 'Old Stairs',      options: [{ type: 'fight', pool: 'easy' }, { type: 'event' }] },
  { name: 'The Gallery',     options: [{ type: 'fight', pool: 'easy' }, { type: 'shop' }] },
  { name: 'Sunken Halls',    options: [{ type: 'fight', pool: 'mid' }, { type: 'event' }] },
  { name: 'The Warden’s Post', options: [{ type: 'elite' }] },
  { name: 'A Quiet Alcove',  options: [{ type: 'rest' }] },
  { name: 'The Ossuary',     options: [{ type: 'fight', pool: 'mid' }, { type: 'event' }, { type: 'shop' }] },
  { name: 'Black Cisterns',  options: [{ type: 'fight', pool: 'mid' }] },
  { name: 'The Landing',     options: [{ type: 'rest' }, { type: 'shop' }] },
  { name: 'The Table',       options: [{ type: 'boss' }] },
];

const OPTION_LABELS = {
  fight: { label: 'A fight ahead', detail: 'Shapes move in the torchlight. Reward: gold and a card.' },
  elite: { label: 'The Warden', detail: 'Something armored guards the way down. Dangerous — greater reward.' },
  event: { label: 'A strange place', detail: 'Not every room wants to kill you. Probably.' },
  shop:  { label: 'The Pale Merchant', detail: 'It trades in cards and mercy, for gold.' },
  rest:  { label: 'Rest', detail: 'A safe corner. Heal 25 HP.' },
  boss:  { label: 'The Table', detail: 'The Dealer is waiting. It has been, the whole time.' },
};

const Game = {

  newRun() {
    Run = {
      hp: 70, maxHp: 70, gold: 35,
      deck: STARTER_DECK.slice(),
      floor: 0, floorName: '',
      dealerLearned: [],
      usedEvents: [],
      stats: { kills: 0, burned: 0 },
      pendingOption: null,
    };
    this.nextFloor();
  },

  dealerDeckForFight(kind) {
    let deck = DEALER_BASE_DECK.concat(Run.dealerLearned);
    (Run.removedDealerCards || []).forEach(id => {
      const i = deck.indexOf(id);
      if (i >= 0) deck.splice(i, 1);
    });
    if (kind === 'boss') {
      const extra = DEALER_TIER2.filter(id => !Run.dealerLearned.includes(id)).slice(0, 2);
      deck = deck.concat(extra);
    }
    return deck;
  },

  nextFloor() {
    Run.floor++;
    if (Run.floor > FLOORS.length) { this.victory(); return; }
    const floorDef = FLOORS[Run.floor - 1];
    Run.floorName = floorDef.name;
    this.showChoices(floorDef);
  },

  showChoices(floorDef) {
    const root = screenEl('map');
    root.appendChild(el('h2', {}, `Floor ${Run.floor} — ${floorDef.name}`));
    root.appendChild(this.statusBar());
    const box = el('div', { class: 'choices' });
    floorDef.options.forEach(opt => {
      const meta = OPTION_LABELS[opt.type];
      const btn = el('div', { class: `choice ${opt.type}`, onclick: () => this.enterOption(opt) });
      btn.appendChild(el('div', { class: 'choice-label' }, meta.label));
      btn.appendChild(el('div', { class: 'choice-detail' }, meta.detail));
      box.appendChild(btn);
    });
    root.appendChild(box);
    root.appendChild(this.deckButton());
  },

  enterOption(opt) {
    Run.pendingOption = opt;
    switch (opt.type) {
      case 'fight': {
        const pool = ENCOUNTERS[opt.pool];
        const enc = pool[Math.floor(Math.random() * pool.length)];
        Combat.start(enc, { dealerDeck: this.dealerDeckForFight('normal'), tellCount: 1 });
        break;
      }
      case 'elite':
        Combat.start(ENCOUNTERS.elite[0], { dealerDeck: this.dealerDeckForFight('elite'), tellCount: 1 });
        break;
      case 'boss':
        Combat.start(ENCOUNTERS.boss[0], { dealerDeck: this.dealerDeckForFight('boss'), tellCount: 2 });
        break;
      case 'event': this.showEvent(); break;
      case 'shop': this.showShop(); break;
      case 'rest': this.showRest(); break;
    }
  },

  onCombatEnd(victory) {
    if (!victory) { this.gameOver(); return; }
    const opt = Run.pendingOption;
    if (opt.type === 'boss') { this.victory(); return; }
    this.showReward(opt.type);
  },

  showReward(kind) {
    const goldGain = kind === 'elite' ? 35 : 12 + Math.floor(Math.random() * 9);
    Run.gold += goldGain;

    // The Dealer learns after certain victories
    let learned = null;
    if ((Run.floor === 4 || Run.floor === 7 || kind === 'elite')) {
      const options = DEALER_TIER2.filter(id => !Run.dealerLearned.includes(id));
      if (options.length) {
        learned = options[Math.floor(Math.random() * options.length)];
        Run.dealerLearned.push(learned);
      }
    }

    const root = screenEl('reward');
    root.appendChild(el('h2', {}, 'The room falls quiet.'));
    root.appendChild(el('p', { class: 'reward-gold' }, `You collect ⛃ ${goldGain} gold.`));
    if (learned) {
      root.appendChild(el('p', { class: 'dealer-learns' },
        `Somewhere below, a pen scratches. The Dealer adds “${DEALER_CARDS[learned].name}” to its deck.`));
    }
    root.appendChild(el('h3', {}, 'Take a card:'));

    const picks = [];
    while (picks.length < 3) {
      const id = randomPoolCard(Math.random);
      if (!picks.includes(id)) picks.push(id);
    }
    const row = el('div', { class: 'card-row' });
    picks.forEach(id => row.appendChild(cardEl(id, { onclick: () => { Run.deck.push(id); this.nextFloor(); } })));
    root.appendChild(row);
    root.appendChild(el('button', { class: 'ghost', onclick: () => this.nextFloor() }, 'Skip the card'));
  },

  /* ---------- events ---------- */

  showEvent() {
    const available = EVENTS.filter(ev => !Run.usedEvents.includes(ev.id));
    const ev = available.length
      ? available[Math.floor(Math.random() * available.length)]
      : EVENTS[Math.floor(Math.random() * EVENTS.length)];
    Run.usedEvents.push(ev.id);

    const root = screenEl('event');
    root.appendChild(el('h2', {}, ev.title));
    root.appendChild(el('p', { class: 'event-body' }, ev.body));
    const box = el('div', { class: 'choices' });
    ev.choices.forEach(c => {
      const btn = el('div', { class: 'choice', onclick: () => this.eventAction(c.action) });
      btn.appendChild(el('div', { class: 'choice-label' }, c.label));
      btn.appendChild(el('div', { class: 'choice-detail' }, c.detail));
      box.appendChild(btn);
    });
    root.appendChild(box);
  },

  eventAction(action) {
    switch (action) {
      case 'leave': this.nextFloor(); break;
      case 'altar_pray':
        Run.hp = Math.min(Run.maxHp, Run.hp + 12);
        this.eventOutcome('Warmth moves through you. Heal 12 HP.');
        break;
      case 'altar_blood':
        Run.hp = Math.max(1, Run.hp - 7);
        this.pickNewCard('The altar drinks. Something is offered in return.');
        break;
      case 'card_take': {
        const id = randomPoolCard(Math.random);
        Run.deck.push(id);
        const t2 = DEALER_TIER2.filter(x => !Run.dealerLearned.includes(x));
        let msg = `You pocket ${CARDS[id].name}.`;
        if (t2.length) {
          const learned = t2[Math.floor(Math.random() * t2.length)];
          Run.dealerLearned.push(learned);
          msg += ` Below, the Dealer pens “${DEALER_CARDS[learned].name}” into its deck.`;
        }
        this.eventOutcome(msg);
        break;
      }
      case 'card_burn': {
        const base = DEALER_BASE_DECK.concat(Run.dealerLearned);
        // Remove one instance from the run's dealer deck permanently
        const idx = Math.floor(Math.random() * base.length);
        const removed = base[idx];
        const li = Run.dealerLearned.indexOf(removed);
        if (li >= 0) Run.dealerLearned.splice(li, 1);
        else Run.removedDealerCards = (Run.removedDealerCards || []).concat(removed);
        this.eventOutcome(`The card curls and blackens in the lantern flame. The Dealer has lost “${DEALER_CARDS[removed].name}” for good.`);
        break;
      }
      case 'carto_gold':
        Run.gold += 28;
        this.eventOutcome('You take 28 gold from a man who no longer needs it.');
        break;
      case 'carto_remove':
        this.removeCardScreen('His oil burns clean. Choose a card to remove from your deck.', () => this.nextFloor());
        break;
    }
  },

  eventOutcome(text) {
    const root = screenEl('event');
    root.appendChild(el('p', { class: 'event-body' }, text));
    root.appendChild(el('button', { onclick: () => this.nextFloor() }, 'Continue'));
  },

  pickNewCard(title) {
    const root = screenEl('reward');
    root.appendChild(el('h2', {}, title));
    const picks = [];
    while (picks.length < 3) {
      const id = randomPoolCard(Math.random);
      if (!picks.includes(id)) picks.push(id);
    }
    const row = el('div', { class: 'card-row' });
    picks.forEach(id => row.appendChild(cardEl(id, { onclick: () => { Run.deck.push(id); this.nextFloor(); } })));
    root.appendChild(row);
    root.appendChild(el('button', { class: 'ghost', onclick: () => this.nextFloor() }, 'Take nothing'));
  },

  /* ---------- shop ---------- */

  showShop() {
    if (!Run.shopStock) {
      const stock = [];
      while (stock.length < 3) {
        const id = randomPoolCard(Math.random);
        if (!stock.includes(id)) stock.push(id);
      }
      Run.shopStock = stock.map(id => ({
        id,
        price: { common: 45, uncommon: 65, rare: 90 }[CARDS[id].rarity] + Math.floor(Math.random() * 10),
        sold: false,
      }));
      Run.shopRemoveUsed = false;
    }
    const root = screenEl('shop');
    root.appendChild(el('h2', {}, 'The Pale Merchant'));
    root.appendChild(el('p', { class: 'event-body' }, '“Everything down here is for sale. Even the way out. Especially that.”'));
    root.appendChild(this.statusBar());

    const row = el('div', { class: 'card-row' });
    Run.shopStock.forEach(item => {
      if (item.sold) return;
      const wrap = el('div', { class: 'shop-item' });
      wrap.appendChild(cardEl(item.id, {
        onclick: () => {
          if (Run.gold < item.price) return;
          Run.gold -= item.price;
          Run.deck.push(item.id);
          item.sold = true;
          this.showShop();
        },
      }));
      wrap.appendChild(el('div', { class: Run.gold >= item.price ? 'price' : 'price poor' }, `⛃ ${item.price}`));
      row.appendChild(wrap);
    });
    root.appendChild(row);

    if (!Run.shopRemoveUsed) {
      root.appendChild(el('button', {
        class: Run.gold >= 50 ? '' : 'ghost',
        onclick: () => {
          if (Run.gold < 50) return;
          this.removeCardScreen('⛃ 50 paid. Choose a card to remove.', () => { Run.gold -= 50; Run.shopRemoveUsed = true; this.showShop(); });
        },
      }, 'Remove a card — ⛃ 50'));
    }
    root.appendChild(el('button', { class: 'ghost', onclick: () => { Run.shopStock = null; this.nextFloor(); } }, 'Leave'));
  },

  /* ---------- rest ---------- */

  showRest() {
    Run.hp = Math.min(Run.maxHp, Run.hp + 25);
    const root = screenEl('rest');
    root.appendChild(el('h2', {}, 'A Quiet Alcove'));
    root.appendChild(el('p', { class: 'event-body' },
      `You sit with your back to the stone and let the lantern burn low. Heal 25 HP — you are at ${Run.hp}/${Run.maxHp}.`));
    root.appendChild(el('button', { onclick: () => this.nextFloor() }, 'Descend'));
  },

  /* ---------- deck management ---------- */

  removeCardScreen(title, done) {
    const root = screenEl('deckview');
    root.appendChild(el('h2', {}, title));
    const row = el('div', { class: 'card-row wrap' });
    Run.deck.forEach((id, i) => {
      row.appendChild(cardEl(id, {
        onclick: () => { Run.deck.splice(i, 1); done(); },
      }));
    });
    root.appendChild(row);
  },

  deckButton() {
    return el('button', { class: 'ghost', onclick: () => this.viewDeck() }, `View deck (${Run.deck.length})`);
  },

  viewDeck() {
    const root = screenEl('deckview');
    root.appendChild(el('h2', {}, `Your deck — ${Run.deck.length} cards`));
    const row = el('div', { class: 'card-row wrap' });
    Run.deck.slice().sort().forEach(id => row.appendChild(cardEl(id)));
    root.appendChild(row);
    root.appendChild(el('button', { onclick: () => this.showChoices(FLOORS[Run.floor - 1]) }, 'Back'));
  },

  statusBar() {
    return el('div', { class: 'statusbar' }, [
      el('span', {}, `❤ ${Run.hp}/${Run.maxHp}`),
      el('span', { class: 'gold' }, `⛃ ${Run.gold}`),
      el('span', {}, `Cards ${Run.deck.length}`),
      el('span', { class: 'dealer-size' }, `Dealer's deck: ${DEALER_BASE_DECK.concat(Run.dealerLearned).length}`),
    ]);
  },

  /* ---------- run end ---------- */

  gameOver() {
    const best = Number(localStorage.getItem('tdb_best') || 0);
    if (Run.floor > best) localStorage.setItem('tdb_best', String(Run.floor));
    const root = screenEl('gameover');
    root.appendChild(el('h1', { class: 'death' }, 'THE DARK KEEPS YOU'));
    root.appendChild(el('p', { class: 'event-body' },
      `You fell on floor ${Run.floor} — ${Run.floorName}. ` +
      `${Run.stats.kills} enemies slain, ${Run.stats.burned} of the Dealer's cards destroyed.`));
    root.appendChild(el('p', { class: 'event-body dim' }, `Deepest descent: floor ${Math.max(best, Run.floor)}.`));
    root.appendChild(el('button', { onclick: () => this.newRun() }, 'Descend again'));
    root.appendChild(el('button', { class: 'ghost', onclick: () => this.title() }, 'Title screen'));
  },

  victory() {
    localStorage.setItem('tdb_won', '1');
    const root = screenEl('victory');
    root.appendChild(el('h1', { class: 'win' }, 'THE DEALER FOLDS'));
    root.appendChild(el('p', { class: 'event-body' },
      `Its hand collapses into ash and the table stands empty. ${Run.stats.kills} enemies slain, ` +
      `${Run.stats.burned} of its cards burned along the way.`));
    root.appendChild(el('p', { class: 'event-body dim' },
      'But the stairs keep going down. Act II is being dealt…'));
    root.appendChild(el('button', { onclick: () => this.newRun() }, 'Play again'));
    root.appendChild(el('button', { class: 'ghost', onclick: () => this.title() }, 'Title screen'));
  },

  /* ---------- title ---------- */

  title() {
    const root = screenEl('title');
    const heroRow = el('div', { class: 'title-art' });
    heroRow.appendChild(drawSprite('hero', 8));
    heroRow.appendChild(drawSprite('dealershand', 8));
    root.appendChild(heroRow);
    root.appendChild(el('h1', { class: 'game-title' }, 'THE DEALER BELOW'));
    root.appendChild(el('p', { class: 'tagline' }, 'A deckbuilding roguelike where the dungeon holds a deck of its own.'));
    const best = Number(localStorage.getItem('tdb_best') || 0);
    if (best > 0) root.appendChild(el('p', { class: 'dim' }, `Deepest descent: floor ${best}${localStorage.getItem('tdb_won') ? ' · Dealer defeated' : ''}`));
    root.appendChild(el('button', { class: 'big', onclick: () => this.newRun() }, 'DESCEND'));
    root.appendChild(el('div', { class: 'howto' }, [
      el('p', {}, 'Fight with your deck — but watch the Dealer’s tell on the right. Every round, after its creatures act, the dungeon itself plays a card against you.'),
      el('p', {}, 'Snuff its tells. Burn its deck. Bind its hand. Or turn its own cards against it.'),
    ]));
  },
};

function screenEl(cls) {
  const root = document.getElementById('screen');
  root.innerHTML = '';
  root.className = `screen ${cls}`;
  return root;
}

window.addEventListener('DOMContentLoaded', () => Game.title());
