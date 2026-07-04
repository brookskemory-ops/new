/* The Dealer Below — combat engine + combat screen rendering */

const Combat = {
  C: null, // current combat state

  start(enemyIds, opts) {
    const rng = Math.random;
    let uid = 0;
    const C = {
      rng,
      turn: 0,
      over: false,
      player: {
        hp: Run.hp, maxHp: Run.maxHp,
        block: 0, str: 0, weak: 0, vuln: 0,
        powers: {},
        energy: 0, energyMax: 3,
        energyDeltaNext: 0, drawDeltaNext: 0,
      },
      enemies: enemyIds.map(id => Combat.spawnEnemy(id, rng)),
      draw: [], hand: [], discard: [], exhaust: [],
      dealer: {
        deck: shuffle([...opts.dealerDeck], rng),
        discard: [], burned: [],
        tells: [], stun: 0,
        tellCount: opts.tellCount || 1,
      },
      log: [],
      disruptedThisPlay: 0,
      stats: { burned: 0, snuffed: 0 },
      uidGen: () => ++uid,
    };
    C.draw = shuffle(Run.deck.map(id => ({ uid: C.uidGen(), id })), rng);
    this.C = C;

    C.enemies.forEach(e => this.setIntent(e));
    this.dealerDrawTells();
    this.logMsg('You step into the dark. The Dealer cuts its deck.');
    this.startPlayerTurn();
    this.render();
  },

  spawnEnemy(id, rng) {
    const def = ENEMIES[id];
    const hp = def.hp[0] + Math.floor(rng() * (def.hp[1] - def.hp[0] + 1));
    return { defId: id, def, name: def.name, hp, maxHp: hp,
             block: 0, str: 0, weak: 0, vuln: 0, poison: 0,
             turnCount: 0, intent: null };
  },

  logMsg(msg) {
    this.C.log.push(msg);
    if (this.C.log.length > 30) this.C.log.shift();
  },

  /* ---------- turn flow ---------- */

  startPlayerTurn() {
    const C = this.C, p = C.player;
    C.turn++;
    p.block = 0;
    p.energy = Math.max(0, p.energyMax + p.energyDeltaNext);
    const drawN = Math.max(0, 5 + p.drawDeltaNext);
    p.energyDeltaNext = 0;
    p.drawDeltaNext = 0;
    this.drawCards(drawN);
  },

  drawCards(n) {
    const C = this.C;
    for (let i = 0; i < n; i++) {
      if (!C.draw.length) {
        if (!C.discard.length) return;
        C.draw = shuffle(C.discard, C.rng);
        C.discard = [];
      }
      if (C.hand.length >= 10) return;
      C.hand.push(C.draw.pop());
    }
  },

  playCard(handIdx, target) {
    const C = this.C, p = C.player;
    if (C.over) return;
    const inst = C.hand[handIdx];
    if (!inst) return;
    const card = CARDS[inst.id];
    if (card.type === 'curse' || card.cost > p.energy) return;

    p.energy -= card.cost;
    C.hand.splice(handIdx, 1);
    C.disruptedThisPlay = 0;
    card.effect(this.api(), target || null);

    if (C.disruptedThisPlay > 0) {
      // Scavenger's Eye: draw per Dealer card destroyed/burned
      if (p.powers.scavengerseye) this.drawCards(C.disruptedThisPlay);
      // Deck Warden's Zealous: +2 Strength once per disrupting play
      C.enemies.forEach(e => {
        if (e.hp > 0 && e.def.passive === 'zealous') {
          e.str += 2;
          this.logMsg(`${e.name} bristles — Zealous grants it 2 Strength.`);
        }
      });
    }

    (card.exhaust ? C.exhaust : C.discard).push(inst);
    this.checkEnd();
    this.render();
  },

  endTurn() {
    const C = this.C;
    if (C.over) return;

    // Discard hand; Rot bites on the way out
    for (const inst of C.hand) {
      if (inst.id === 'rot') this.damagePlayer(2, true);
      C.discard.push(inst);
    }
    C.hand = [];
    if (this.checkEnd()) return;

    this.enemyPhase();
    if (this.checkEnd()) return;

    this.dealerPhase();
    if (this.checkEnd()) return;

    this.startPlayerTurn();
    this.render();
  },

  enemyPhase() {
    const C = this.C;
    for (const e of C.enemies) {
      if (e.hp <= 0) continue;
      e.block = 0;
      if (e.poison > 0) {
        e.hp -= e.poison;
        this.logMsg(`${e.name} takes ${e.poison} poison damage.`);
        e.poison--;
        if (e.hp <= 0) { this.logMsg(`${e.name} crumbles.`); continue; }
      }
      this.executeMove(e);
      if (C.player.hp <= 0) return;
      e.turnCount++;
      if (e.weak > 0) e.weak--;
      if (e.vuln > 0) e.vuln--;
      this.setIntent(e);
    }
    const p = C.player;
    if (p.weak > 0) p.weak--;
    if (p.vuln > 0) p.vuln--;
  },

  setIntent(e) {
    e.intent = e.def.moves[e.def.ai(e, e.turnCount, this.C.rng)];
  },

  executeMove(e) {
    const m = e.intent;
    if (!m) return;
    const times = m.times || 1;
    if (m.dmg != null) {
      for (let i = 0; i < times; i++) {
        let dmg = m.dmg + e.str;
        if (e.weak > 0) dmg = Math.floor(dmg * 0.75);
        if (this.C.player.vuln > 0) dmg = Math.floor(dmg * 1.5);
        const dealt = this.damagePlayer(dmg);
        if (m.kind === 'drain' && m.heal) e.hp = Math.min(e.maxHp, e.hp + m.heal);
        this.logMsg(`${e.name} uses ${m.name} for ${dealt} damage.`);
      }
    }
    if (m.block) e.block += m.block;
    if (m.apply) {
      for (const [stat, n] of Object.entries(m.apply)) {
        if (stat === 'str') e.str += n;
        else this.C.player[stat] += n;
      }
      this.logMsg(`${e.name} uses ${m.name}.`);
    }
    if (m.curse) {
      for (let i = 0; i < m.curse; i++)
        this.C.discard.push({ uid: this.C.uidGen(), id: 'rot' });
      this.logMsg(`${e.name} riffles a Rot into your discard pile.`);
    }
  },

  damagePlayer(n, ignoreBlock) {
    const p = this.C.player;
    let dmg = n;
    if (!ignoreBlock && p.block > 0) {
      const absorbed = Math.min(p.block, dmg);
      p.block -= absorbed;
      dmg -= absorbed;
    }
    p.hp -= dmg;
    return n;
  },

  /* ---------- the Dealer ---------- */

  dealerPhase() {
    const C = this.C, d = C.dealer;
    if (d.stun > 0) {
      d.stun--;
      this.logMsg('The Dealer holds its hand.');
      this.render();
      return;
    }
    if (d.tells.length) {
      for (const id of d.tells) {
        const dc = DEALER_CARDS[id];
        this.logMsg(`The Dealer plays ${dc.name}.`);
        dc.effect(this.api());
        d.discard.push(id);
        if (C.player.powers.waxward) C.player.block += 4;
        if (C.player.hp <= 0) return;
      }
    } else {
      this.logMsg('The Dealer fumbles — nothing to play.');
    }
    d.tells = [];
    this.dealerDrawTells();
  },

  dealerDrawTells() {
    const C = this.C, d = C.dealer;
    for (let i = 0; i < d.tellCount; i++) {
      if (!d.deck.length) {
        if (!d.discard.length) {
          if (i === 0) this.logMsg('The Dealer’s deck is spent. It has nothing left.');
          return;
        }
        d.deck = shuffle(d.discard, C.rng);
        d.discard = [];
        d.stun += 1;
        this.logMsg('The Dealer reshuffles, exhausted — it skips a round.');
      }
      d.tells.push(d.deck.pop());
    }
  },

  /* ---------- card effect API ---------- */

  api() {
    const self = this, C = this.C, p = C.player;
    const alive = () => C.enemies.filter(e => e.hp > 0);
    const hitEnemy = (t, raw) => {
      if (!t || t.hp <= 0) return false;
      let dmg = raw;
      if (t.block > 0) {
        const absorbed = Math.min(t.block, dmg);
        t.block -= absorbed;
        dmg -= absorbed;
      }
      t.hp -= dmg;
      if (t.hp <= 0) { self.logMsg(`${t.name} falls.`); Run.stats.kills++; return true; }
      return false;
    };
    return {
      dmg(t, n) {
        let raw = n + p.str;
        if (p.weak > 0) raw = Math.floor(raw * 0.75);
        if (t && t.vuln > 0) raw = Math.floor(raw * 1.5);
        return hitEnemy(t, raw);
      },
      aoe(n) { alive().forEach(t => this.dmg(t, n)); },
      aoeTrue(n) { alive().forEach(t => hitEnemy(t, n)); },
      dmgRandomEnemyTrue(n) {
        const targets = alive();
        if (targets.length) hitEnemy(targets[Math.floor(C.rng() * targets.length)], n);
      },
      block(n) { p.block += n; },
      draw(n) { self.drawCards(n); },
      energy(n) { p.energy += n; },
      gold(n) { Run.gold += n; },
      healPlayer(n) { p.hp = Math.min(p.maxHp, p.hp + n); },
      strength(n) { p.str += n; },
      poison(t, n) { if (t && t.hp > 0) t.poison += n; },
      applyAll(stat, n) { alive().forEach(t => { t[stat] += n; }); },
      power(id) { p.powers[id] = true; },
      dealerHasTell() { return C.dealer.tells.length > 0; },
      destroyTell() {
        if (!C.dealer.tells.length) { self.logMsg('The Dealer has no tell to destroy.'); return; }
        const id = C.dealer.tells.shift();
        C.dealer.burned.push(id);
        C.disruptedThisPlay++;
        C.stats.snuffed++;
        Run.stats.burned++;
        self.logMsg(`You snuff out ${DEALER_CARDS[id].name}.`);
      },
      stunDealer(n) {
        C.dealer.stun += n;
        C.disruptedThisPlay++;
        self.logMsg(`The Dealer’s hand is bound for ${n} round${n > 1 ? 's' : ''}.`);
      },
      burnDealer(n) {
        for (let i = 0; i < n; i++) {
          if (!C.dealer.deck.length) break;
          const id = C.dealer.deck.pop();
          C.dealer.burned.push(id);
          C.disruptedThisPlay++;
          C.stats.burned++;
          Run.stats.burned++;
          self.logMsg(`${DEALER_CARDS[id].name} burns to ash.`);
        }
      },
      mirrorTell() {
        if (!C.dealer.tells.length) { self.logMsg('No tell to mirror.'); return; }
        const id = C.dealer.tells.shift();
        C.dealer.discard.push(id);
        C.disruptedThisPlay++;
        self.logMsg(`${DEALER_CARDS[id].name} is turned against the dungeon.`);
        DEALER_CARDS[id].invert(this);
      },
      cleanseCurses(blockEach) {
        const curses = C.hand.filter(i => CARDS[i.id].type === 'curse');
        C.hand = C.hand.filter(i => CARDS[i.id].type !== 'curse');
        curses.forEach(i => C.exhaust.push(i));
        p.block += blockEach * curses.length;
        if (curses.length) self.logMsg(`${curses.length} Rot burns away.`);
      },
      addCurse(n) {
        for (let i = 0; i < n; i++) C.discard.push({ uid: C.uidGen(), id: 'rot' });
        self.logMsg('A Rot festers in your discard pile.');
      },
      drawDelta(n) { p.drawDeltaNext += n; },
      energyDelta(n) { p.energyDeltaNext += n; },
      summon(id) {
        if (alive().length >= 4) { self.damagePlayer(5); self.logMsg('The floor heaves — 5 damage.'); return; }
        const e = self.spawnEnemy(id, C.rng);
        self.setIntent(e);
        C.enemies.push(e);
        self.logMsg(`A ${e.name} claws out of the floor.`);
      },
      buffEnemies(stat, n) {
        alive().forEach(e => { if (stat === 'str') e.str += n; else e.block += n; });
      },
      healEnemies(n) { alive().forEach(e => { e.hp = Math.min(e.maxHp, e.hp + n); }); },
      dmgPlayer(n) { self.damagePlayer(n); },
    };
  },

  checkEnd() {
    const C = this.C;
    if (C.over) return true;
    if (C.player.hp <= 0) {
      C.over = true;
      Run.hp = 0;
      Game.onCombatEnd(false);
      return true;
    }
    if (C.enemies.every(e => e.hp <= 0)) {
      C.over = true;
      Run.hp = C.player.hp;
      Game.onCombatEnd(true);
      return true;
    }
    return false;
  },

  /* ---------- rendering ---------- */

  pendingTarget: null, // hand index awaiting a target click

  render() {
    const C = this.C;
    if (!C || C.over) return;
    const root = document.getElementById('screen');
    root.innerHTML = '';
    root.className = 'screen combat';

    // Top bar
    root.appendChild(el('div', { class: 'topbar' }, [
      el('span', {}, `Floor ${Run.floor} · ${Run.floorName || ''}`),
      el('span', { class: 'gold' }, `⛃ ${Run.gold}`),
      el('span', {}, `Deck ${C.draw.length} · Discard ${C.discard.length}`),
    ]));

    const arena = el('div', { class: 'arena' });

    // Player side
    const pside = el('div', { class: 'side player-side' });
    pside.appendChild(drawSprite('hero', 6));
    pside.appendChild(this.unitPlate('You', C.player, true));
    arena.appendChild(pside);

    // Enemies
    const eside = el('div', { class: 'side enemy-side' });
    C.enemies.forEach((e, i) => {
      if (e.hp <= 0) return;
      const unit = el('div', {
        class: 'enemy' + (this.pendingTarget != null ? ' targetable' : ''),
        onclick: () => {
          if (this.pendingTarget != null) {
            const idx = this.pendingTarget;
            this.pendingTarget = null;
            this.playCard(idx, e);
          }
        },
      });
      unit.appendChild(el('div', { class: 'intent' }, this.intentText(e)));
      unit.appendChild(drawSprite(e.def.sprite, e.def.boss ? 9 : e.def.elite ? 7 : 5));
      unit.appendChild(this.unitPlate(e.name, e, false));
      if (e.def.passiveText) unit.appendChild(el('div', { class: 'passive' }, e.def.passiveText));
      eside.appendChild(unit);
    });
    arena.appendChild(eside);

    // Dealer panel
    arena.appendChild(this.dealerPanel());
    root.appendChild(arena);

    // Log
    const logBox = el('div', { class: 'log' });
    C.log.slice(-4).forEach(m => logBox.appendChild(el('div', {}, m)));
    root.appendChild(logBox);

    // Hand + controls
    const bottom = el('div', { class: 'bottom' });
    const energyOrb = el('div', { class: 'energy' }, `${C.player.energy}/${C.player.energyMax}`);
    bottom.appendChild(energyOrb);

    const hand = el('div', { class: 'hand' });
    C.hand.forEach((inst, i) => {
      const card = CARDS[inst.id];
      const playable = card.type !== 'curse' && card.cost <= C.player.energy;
      const div = cardEl(inst.id, {
        playable,
        selected: this.pendingTarget === i,
        onclick: () => {
          if (!playable || C.over) return;
          if (this.pendingTarget === i) { this.pendingTarget = null; this.render(); return; }
          const aliveEnemies = C.enemies.filter(e => e.hp > 0);
          if (card.targeting === 'enemy' && aliveEnemies.length > 1) {
            this.pendingTarget = i;
            this.render();
          } else {
            this.pendingTarget = null;
            this.playCard(i, card.targeting === 'enemy' ? aliveEnemies[0] : null);
          }
        },
      });
      hand.appendChild(div);
    });
    bottom.appendChild(hand);

    bottom.appendChild(el('button', { class: 'endturn', onclick: () => { this.pendingTarget = null; this.endTurn(); } }, 'End Turn'));
    root.appendChild(bottom);
  },

  intentText(e) {
    const m = e.intent;
    if (!m) return '…';
    if (m.dmg != null) {
      let dmg = m.dmg + e.str;
      if (e.weak > 0) dmg = Math.floor(dmg * 0.75);
      const times = m.times && m.times > 1 ? `×${m.times}` : '';
      return `⚔ ${dmg}${times}`;
    }
    if (m.kind === 'defend') return '🛡';
    if (m.kind === 'buff') return '↑';
    return '☠';
  },

  unitPlate(name, u, isPlayer) {
    const plate = el('div', { class: 'plate' });
    plate.appendChild(el('div', { class: 'uname' }, name));
    const bar = el('div', { class: 'hpbar' });
    bar.appendChild(el('div', { class: 'hpfill', style: `width:${Math.max(0, u.hp / u.maxHp * 100)}%` }));
    plate.appendChild(bar);
    const bits = [`${Math.max(0, u.hp)}/${u.maxHp}`];
    if (u.block > 0) bits.push(`🛡${u.block}`);
    if (u.str) bits.push(`💪${u.str}`);
    if (u.weak > 0) bits.push(`Weak ${u.weak}`);
    if (u.vuln > 0) bits.push(`Vuln ${u.vuln}`);
    if (u.poison > 0) bits.push(`☠${u.poison}`);
    if (isPlayer) {
      if (u.powers.waxward) bits.push('WaxWard');
      if (u.powers.scavengerseye) bits.push('Scav.Eye');
    }
    plate.appendChild(el('div', { class: 'ustats' }, bits.join('  ')));
    return plate;
  },

  dealerPanel() {
    const d = this.C.dealer;
    const panel = el('div', { class: 'dealer-panel' });
    panel.appendChild(el('div', { class: 'dealer-title' }, 'THE DEALER'));
    panel.appendChild(drawSprite('dealercard', 4));
    panel.appendChild(el('div', { class: 'dealer-counts' },
      `Deck ${d.deck.length} · Used ${d.discard.length} · Burned ${d.burned.length}`));
    if (d.stun > 0) {
      panel.appendChild(el('div', { class: 'tell stunned' }, `BOUND — skips ${d.stun} round${d.stun > 1 ? 's' : ''}`));
    } else if (d.tells.length) {
      d.tells.forEach(id => {
        const dc = DEALER_CARDS[id];
        const tell = el('div', { class: 'tell' });
        tell.appendChild(el('div', { class: 'tell-name' }, dc.name));
        tell.appendChild(el('div', { class: 'tell-text' }, dc.text));
        panel.appendChild(tell);
      });
    } else {
      panel.appendChild(el('div', { class: 'tell empty' }, 'No tell — the Dealer fumbles'));
    }
    panel.appendChild(el('div', { class: 'dealer-hint' }, 'The tell is played after the enemies act.'));
    return panel;
  },
};

/* ---------- shared helpers ---------- */

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function el(tag, attrs = {}, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onclick') node.onclick = v;
    else node.setAttribute(k, v);
  }
  if (children != null) {
    if (Array.isArray(children)) children.forEach(c => node.appendChild(c));
    else node.textContent = children;
  }
  return node;
}

function cardEl(cardId, opts = {}) {
  const card = CARDS[cardId];
  const div = el('div', {
    class: `card ${card.type} rarity-${card.rarity}`
      + (opts.playable === false ? ' unplayable' : '')
      + (opts.selected ? ' selected' : ''),
  });
  if (opts.onclick) div.onclick = opts.onclick;
  div.appendChild(el('div', { class: 'cost' }, card.cost < 0 ? '✕' : String(card.cost)));
  div.appendChild(el('div', { class: 'cname' }, card.name));
  div.appendChild(el('div', { class: 'ctype' }, card.type.toUpperCase()));
  div.appendChild(el('div', { class: 'ctext' }, card.text));
  return div;
}
