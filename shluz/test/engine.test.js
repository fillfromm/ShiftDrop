'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../engine');
const scenario = require('../content/scenario.json');

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Партия из одних ботов: «ведущий» только жмёт «Дальше».
function playBots(seed, n, difficulty) {
  const g = new Game(scenario, rngFrom(seed));
  for (let i = 0; i < n; i++) g.addBot();
  g.setDifficulty(difficulty);
  g.start();
  g.alarm(0);
  g.closeScrambleIfDone();
  let guard = 0;
  while (g.phase !== 'epilogue') { g.next(); if (++guard > 200) throw new Error('игра не заканчивается, фаза ' + g.phase); }
  return g;
}

test('партии ботов доходят до исхода на любой сложности и при любом числе игроков', () => {
  for (const d of ['easy', 'rising', 'hard']) {
    for (let n = 4; n <= 12; n++) {
      for (let s = 1; s <= 40; s++) {
        const g = playBots(s * 131 + n, n, d);
        assert.ok(g.inside().length <= g.seats);
        assert.ok(g.epilogue.bunker.rows.length === 8);
        for (const p of g.players) g.view(p.id);
      }
    }
  }
});

test('чужие скрытые карты и вещи не попадают в view', () => {
  const g = new Game(scenario, rngFrom(7));
  const a = g.addPlayer('А', { host: true });
  for (let i = 0; i < 3; i++) g.addBot();
  g.start();
  g.alarm(0);
  g.grabBlind(a.id);
  assert.strictEqual(g.phase, 'reveal');
  const v = g.view(a.id);
  for (const p of v.players) {
    if (p.id === a.id) { assert.strictEqual(p.cards.length, 6); continue; }
    assert.ok(p.cards.every((c) => c.revealed));
    assert.ok(p.items.every((i) => i.revealed));
  }
});

test('незнакомая вещь показывается без названия и эффекта', () => {
  const g = new Game(scenario, rngFrom(3));
  const a = g.addPlayer('А', { host: true });
  for (let i = 0; i < 3; i++) g.addBot();
  g.start();
  const me = g.P(a.id);
  me.skills = [];
  const inst = g.inst('antibiotics');
  assert.strictEqual(g.itemView(inst, me, false).name, 'Какие-то таблетки');
  assert.strictEqual(g.itemView(inst, me, false).gives, null);
  me.skills = ['medic'];
  assert.strictEqual(g.itemView(inst, me, false).name, 'Антибиотики');
});

test('в рюкзак нельзя положить больше вместимости, опоздание стоит вещи и раны', () => {
  const g = new Game(scenario, rngFrom(11));
  const a = g.addPlayer('А', { host: true });
  for (let i = 0; i < 3; i++) g.addBot();
  g.start();
  g.alarm(1000);
  const me = g.P(a.id);
  const all = g.visibleInsts(me).map((i) => i.uid);
  assert.throws(() => g.pack(a.id, all), /не унести/);
  g.pack(a.id, all.slice(0, 2));
  const before = me.items.length;
  g.scrambleDone(a.id, me.scr.deadline + 5000);
  assert.strictEqual(me.items.length, before - 1);
  assert.strictEqual(me.injuries, 1);
});
