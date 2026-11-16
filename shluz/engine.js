'use strict';
// Игровая логика без сети и таймеров: сервер вызывает методы и рассылает view().

const DIFF = {
  easy:   { name: 'Лёгкая',       danger: () => 1,                 factor: 0.8,  twist: 0,    slack: 1 },
  rising: { name: 'Нарастающая',  danger: (r) => Math.min(3, r),   factor: 1.0,  twist: 0.15, slack: 1 },
  hard:   { name: 'Жёсткая',      danger: () => 3,                 factor: 1.1,  twist: 0.25, slack: 0 },
};
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 12;
const LATE_GRACE_MS = 1500;
const DEADLY_INJURIES = 3;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

class Game {
  constructor(scenario, rng) {
    this.sc = scenario;
    this.rng = rng || Math.random;
    this.players = [];
    this.phase = 'lobby';
    this.difficulty = 'rising';
    this.log = [];
    this.seq = 0;
    this.round = 0;
  }

  // ---------- утилиты ----------
  err(msg) { const e = new Error(msg); e.user = true; throw e; }
  rand(n) { return Math.floor(this.rng() * n); }
  pick(arr) {
    const total = arr.reduce((s, x) => s + (x.w || 1), 0);
    let r = this.rng() * total;
    for (const x of arr) { r -= (x.w || 1); if (r < 0) return x; }
    return arr[arr.length - 1];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = this.rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  P(pid) { const p = this.players.find((x) => x.id === pid); if (!p) this.err('Игрок не найден'); return p; }
  inside() { return this.players.filter((p) => p.status === 'in'); }
  outside() { return this.players.filter((p) => p.status === 'out'); }
  say(text, kind) { this.log.push({ text, kind: kind || 'info', round: this.round }); if (this.log.length > 80) this.log.shift(); }
  danger() { return DIFF[this.difficulty].danger(Math.max(1, this.round)); }
  inst(id) { return { uid: 'i' + (++this.seq), id, revealed: false }; }
  def(inst) { return this.sc.items[inst.id]; }
  knows(player, def) { return !def.knownBy || def.knownBy.some((s) => player.skills.includes(s)); }
  need(phase) { if (this.phase !== phase) this.err('Сейчас это действие недоступно'); }

  // ---------- лобби ----------
  addPlayer(name, opts) {
    if (this.phase !== 'lobby') this.err('Игра уже идёт');
    if (this.players.length >= MAX_PLAYERS) this.err('Комната заполнена');
    name = String(name || '').trim().slice(0, 16) || 'Игрок';
    let n = name, k = 2;
    while (this.players.some((p) => p.name === n)) n = name + ' ' + k++;
    const p = { id: 'p' + (++this.seq), name: n, bot: !!(opts && opts.bot), host: !!(opts && opts.host), connected: true, status: 'in' };
    this.players.push(p);
    return p;
  }
  addBot() {
    const names = ['Марта', 'Глеб', 'Ася', 'Тимур', 'Вера', 'Лев', 'Нина', 'Фома', 'Рита', 'Захар', 'Ида'];
    const free = names.filter((n) => !this.players.some((p) => p.name === n));
    return this.addPlayer(free.length ? free[this.rand(free.length)] : 'Бот', { bot: true });
  }
  removeBot() {
    this.need('lobby');
    const i = this.players.map((p) => p.bot).lastIndexOf(true);
    if (i >= 0) this.players.splice(i, 1);
  }
  setDifficulty(d) { this.need('lobby'); if (!DIFF[d]) this.err('Неизвестная сложность'); this.difficulty = d; }

  // ---------- раздача ----------
  start() {
    this.need('lobby');
    if (this.players.length < MIN_PLAYERS) this.err(`Нужно минимум ${MIN_PLAYERS} участника (можно добавить ботов)`);
    const sc = this.sc;
    this.log = []; this.round = 0; this.epilogue = null; this.event = null; this.sortie = null; this.lastVote = null;
    this.usedSecrets = new Set();
    const profs = this.shuffle(sc.professions);
    const locs = this.shuffle(sc.locations);
    this.players.forEach((p, i) => {
      Object.assign(p, { status: 'in', injuries: 0, immune: false, acted: false, items: [], revealed: { prof: true }, late: false });
      this.deal(p, profs[i % profs.length]);
      const loc = locs[i % locs.length];
      p.loc = loc;
      p.map = loc.zones.map((z) => ({ id: z.id, items: z.items.map((id) => this.inst(id)) }));
      p.scr = { done: false, deadline: 0 };
    });
    const b = this.pick(sc.bunkers);
    this.bunker = b;
    this.seats = Math.floor(this.players.length / 2);
    this.has = Object.assign({}, b.has);
    this.needExtra = { [b.defect.need]: b.defect.add };
    this.twist = this.rng() < DIFF[this.difficulty].twist ? this.pick(sc.twists) : null;
    this.eventDeck = this.shuffle(sc.events);
    this.phase = 'briefing';
  }
  deal(p, prof) {
    const sc = this.sc;
    const age = 18 + this.rand(53);
    const sex = this.rng() < 0.5 ? 'Мужчина' : 'Женщина';
    const ageGives = age >= 63 ? { med: -1 } : age <= 22 ? { morale: 1 } : {};
    const health = this.pick(sc.health), hobby = this.pick(sc.hobbies), trait = this.pick(sc.traits);
    let secret = this.pick(sc.secrets); // настоящие секреты в одной партии не повторяются
    for (let i = 0; i < 8 && Object.keys(secret.gives).length + (secret.fakeProf ? 1 : 0) && this.usedSecrets.has(secret.text); i++) secret = this.pick(sc.secrets);
    this.usedSecrets.add(secret.text);
    p.fake = !!secret.fakeProf;
    p.skills = p.fake ? [] : prof.skills.slice();
    p.cards = [
      { key: 'prof', label: 'Профессия', text: prof.name, gives: prof.gives, skills: prof.skills.map((s) => sc.skills[s]) },
      { key: 'bio', label: 'Пол и возраст', text: `${sex}, ${age}`, gives: ageGives },
      { key: 'health', label: 'Здоровье', text: health.text, gives: health.gives },
      { key: 'hobby', label: 'Хобби', text: hobby.text, gives: hobby.gives },
      { key: 'trait', label: 'Характер', text: trait.text, gives: trait.gives },
      { key: 'secret', label: 'Секрет', text: secret.text, gives: secret.gives },
    ];
  }

  // ---------- сбор ----------
  alarm(now) {
    this.need('briefing');
    this.phase = 'scramble';
    let last = 0;
    for (const p of this.players) {
      p.scr.deadline = now + p.loc.time * 1000;
      last = Math.max(last, p.scr.deadline);
      if (p.bot) this.botScramble(p);
    }
    return last + 3000; // когда сервер должен принудительно закрыть сбор
  }
  visibleInsts(p) {
    return p.map.flatMap((z) => z.items).filter((i) => { const d = this.def(i); return !d.onlyFor || d.onlyFor.some((s) => p.skills.includes(s)); });
  }
  sizeOf(insts) { return insts.reduce((s, i) => s + (this.def(i).size || 1), 0); }
  pack(pid, uids) {
    this.need('scramble');
    const p = this.P(pid);
    if (p.scr.done) return;
    const pool = this.visibleInsts(p);
    const chosen = [...new Set(uids || [])].map((u) => pool.find((i) => i.uid === u)).filter(Boolean);
    if (this.sizeOf(chosen) > p.loc.cap) this.err('Столько не унести');
    p.items = chosen;
  }
  fillRandom(p, cap) {
    p.items = [];
    let used = 0;
    for (const i of this.shuffle(this.visibleInsts(p))) {
      const s = this.def(i).size || 1;
      if (used + s <= cap) { p.items.push(i); used += s; }
    }
  }
  grabBlind(pid) {
    this.need('scramble');
    const p = this.P(pid);
    if (p.scr.done) return;
    this.fillRandom(p, p.loc.cap + 1);
    p.scr.blind = true;
    this.finishScramble(p, false);
  }
  scrambleDone(pid, now, late) {
    this.need('scramble');
    const p = this.P(pid);
    if (p.scr.done) return;
    this.finishScramble(p, !!late || now > p.scr.deadline + LATE_GRACE_MS);
  }
  botScramble(p) {
    this.fillRandom(p, p.loc.cap);
    this.finishScramble(p, this.rng() < 0.1, true);
  }
  finishScramble(p, late, silent) {
    p.scr.done = true;
    if (late) {
      p.late = true;
      p.injuries++;
      if (p.items.length) { const i = this.rand(p.items.length); p.scr.lost = this.def(p.items[i]).name; p.items.splice(i, 1); }
    }
    if (!silent) this.closeScrambleIfDone();
  }
  closeScrambleIfDone() { if (this.phase === 'scramble' && this.players.every((p) => p.scr.done)) this.openGate(); }
  forceScramble() {
    if (this.phase !== 'scramble') return;
    for (const p of this.players) if (!p.scr.done) this.finishScramble(p, true, true);
    this.openGate();
  }
  openGate() {
    for (const p of this.players) {
      delete p.map;
      if (p.late) this.say(`${p.name} вбегает последним: ударная волна догнала у самого входа.`, 'bad');
    }
    this.say(`Шлюз закрыт. Внутри ${this.players.length}, мест в убежище «${this.bunker.name}»: ${this.seats}.`, 'head');
    this.enterRound();
  }

  // ---------- раунд ----------
  enterRound() {
    this.round++;
    this.event = null; this.sortie = null; this.radioSent = false; this.lastVote = null;
    this.nextEvent = this.drawEvent();
    this.phase = 'reveal';
    this.say(`Раунд ${this.round}`, 'head');
    for (const p of this.inside()) {
      p.acted = this.hidden(p).length === 0;
      if (p.bot && !p.acted) this.botReveal(p);
    }
    for (const p of this.outside()) if (p.bot && !this.radioSent && this.rng() < 0.5) this.radio(p.id, this.rng() < 0.5);
    this.closeRevealIfDone();
  }
  drawEvent() {
    const d = this.danger();
    const ok = (e) => e.minDanger <= d && !(e.effect.seats && this.seats <= 1);
    const wantSortie = this.rng() < 0.5;
    let i = this.eventDeck.findIndex((e) => ok(e) && !!e.effect.sortie === wantSortie);
    if (i < 0) i = this.eventDeck.findIndex(ok);
    if (i < 0) { this.eventDeck = this.shuffle(this.sc.events); i = this.eventDeck.findIndex(ok); }
    return this.eventDeck.splice(i, 1)[0];
  }
  hidden(p) {
    return [
      ...p.cards.filter((c) => !p.revealed[c.key]).map((c) => ({ card: c.key })),
      ...p.items.filter((i) => !i.revealed).map((i) => ({ item: i.uid })),
    ];
  }
  doReveal(p, ref) {
    if (ref.card) {
      const c = p.cards.find((x) => x.key === ref.card);
      if (!c || p.revealed[c.key]) return false;
      p.revealed[c.key] = true;
      this.say(`${p.name} открывает: ${c.label.toLowerCase()} — ${c.text}`, 'reveal');
      return true;
    }
    const it = p.items.find((x) => x.uid === ref.item);
    if (!it || it.revealed) return false;
    it.revealed = true;
    this.say(`${p.name} показывает вещь из рюкзака`, 'reveal');
    return true;
  }
  reveal(pid, ref) {
    this.need('reveal');
    const p = this.P(pid);
    if (p.status !== 'in') this.err('Вы не в убежище');
    if (p.acted) this.err('В этом раунде вы уже открыли карту');
    if (!this.doReveal(p, ref || {})) this.err('Эту карту нельзя открыть');
    p.acted = true;
    this.closeRevealIfDone();
  }
  botReveal(p) {
    let opts = this.hidden(p);
    const noSecret = opts.filter((o) => o.card !== 'secret');
    if (noSecret.length) opts = noSecret;
    this.doReveal(p, opts[this.rand(opts.length)]);
    p.acted = true;
  }
  closeRevealIfDone() { if (this.phase === 'reveal' && this.inside().every((p) => p.acted)) this.fireEvent(); }
  radio(pid, truth) {
    this.need('reveal');
    const p = this.P(pid);
    if (p.status !== 'out') this.err('Передавать по радио могут только те, кто снаружи');
    if (this.radioSent) this.err('В этом раунде эфир уже занят');
    let hint = this.nextEvent.hint;
    if (!truth) { const others = this.sc.events.filter((e) => e.id !== this.nextEvent.id); hint = others[this.rand(others.length)].hint; }
    this.radioSent = true;
    this.say(`📻 ${p.name} снаружи: «${hint}»`, 'radio');
  }

  // ---------- событие ----------
  applyHas(delta) {
    const parts = [];
    for (const n in delta || {}) {
      this.has[n] = Math.max(0, (this.has[n] || 0) + delta[n]);
      parts.push(`${this.sc.needs[n].icon} ${delta[n] > 0 ? '+' : ''}${delta[n]}`);
    }
    return parts.join(' ');
  }
  fireEvent() {
    const ev = this.nextEvent, ef = ev.effect;
    this.event = { text: ev.text, result: '' };
    this.say(ev.text, 'event');
    if (ef.sortie) {
      this.event.sortieTitle = this.sc.sorties[ef.sortie].title;
      this.volunteers = [];
      this.phase = 'sortieCall';
      return;
    }
    if (ef.has) this.event.result = 'Запасы убежища: ' + this.applyHas(ef.has);
    if (ef.seats) { this.seats = Math.max(1, this.seats + ef.seats); this.event.result = `Мест теперь: ${this.seats}`; }
    if (ef.reveal) {
      const pool = this.inside();
      const targets = ef.target === 'all' ? pool : [pool[this.rand(pool.length)]];
      for (const p of targets) {
        if (ef.reveal === 'item') { const h = p.items.filter((i) => !i.revealed); if (h.length) this.doReveal(p, { item: h[this.rand(h.length)].uid }); } else this.doReveal(p, { card: ef.reveal });
      }
      this.event.result = ef.target === 'all' ? 'Карты раскрыты у всех.' : `Раскрыта карта: ${targets[0].name}.`;
    }
    this.phase = 'event';
  }
  volunteer(pid) {
    this.need('sortieCall');
    const p = this.P(pid);
    if (p.status !== 'in') this.err('Вы не в убежище');
    const i = this.volunteers.indexOf(pid);
    if (i >= 0) this.volunteers.splice(i, 1); else this.volunteers.push(pid);
  }
  closeSortieCall() {
    if (!this.volunteers.length) for (const p of this.inside()) if (p.bot && this.rng() < 0.3) this.volunteers.push(p.id);
    const ef = this.nextEvent.effect;
    if (!this.volunteers.length) {
      const nv = ef.noVolunteer || {};
      this.event.result = (nv.text || 'Никто не пошёл.') + (nv.has ? ' Запасы: ' + this.applyHas(nv.has) : '');
      this.say(this.event.result, 'bad');
      this.phase = 'event';
      return;
    }
    const p = this.P(this.volunteers[this.rand(this.volunteers.length)]);
    const sdef = this.sc.sorties[ef.sortie];
    this.sortie = { pid: p.id, id: ef.sortie, node: sdef.start, log: [], finished: false, dead: false, told: false };
    this.phase = 'sortie';
    this.say(`${p.name} уходит на вылазку. Шлюз закрывается за спиной.`, 'event');
    if (p.bot) {
      while (!this.sortie.finished) {
        const ch = this.sortieChoices(p);
        const open = ch.map((c, i) => (c.locked ? -1 : i)).filter((i) => i >= 0);
        this.sortieChoose(p.id, open[this.rand(open.length)]);
      }
      if (this.phase === 'sortie') this.sortieReport(p.id, this.rng() < 0.5);
    }
  }
  sortieChoices(p) {
    const node = this.sc.sorties[this.sortie.id].nodes[this.sortie.node];
    const list = node.choices.map((c) => {
      const locked = !!c.needItem && !c.needItem.some((id) => p.items.some((i) => i.id === id));
      return { text: c.text, locked, why: locked ? 'нужно: ' + c.needItem.map((id) => this.sc.items[id].name).join(' или ') : '' };
    });
    if (list.every((c) => c.locked)) list.push({ text: 'Вернуться ни с чем', locked: false, why: '', retreat: true });
    return list;
  }
  sortieChoose(pid, idx) {
    this.need('sortie');
    const s = this.sortie, p = this.P(pid);
    if (s.pid !== pid || s.finished) this.err('Сейчас не ваш ход');
    const node = this.sc.sorties[s.id].nodes[s.node];
    const view = this.sortieChoices(p)[idx];
    if (!view || view.locked) this.err('Этот вариант недоступен');
    if (view.retreat) { s.log.push({ q: node.text, a: view.text, r: 'Без нужных вещей здесь делать нечего.' }); s.finished = true; return; }
    const c = node.choices[idx];
    let chance = 1;
    if (!c.safe) {
      chance = c.chance - 0.1 * (this.danger() - 1);
      for (const sk in c.bonusSkill || {}) if (p.skills.includes(sk)) chance += c.bonusSkill[sk];
      for (const id in c.bonusItem || {}) if (p.items.some((i) => i.id === id)) chance += c.bonusItem[id];
      chance = clamp(chance, 0.05, 0.95);
    }
    const out = this.rng() < chance ? c.ok : c.bad;
    const extra = [];
    for (const id of out.loot || []) { p.items.push(this.inst(id)); extra.push('Найдено: ' + (this.knows(p, this.sc.items[id]) ? this.sc.items[id].name : this.sc.items[id].vague)); }
    if (out.has) extra.push('Запасы убежища: ' + this.applyHas(out.has));
    let harm = out.harm;
    if (harm === 'deadly') harm = this.rng() < 0.1 + 0.15 * this.danger() ? 'death' : 'injury';
    if (harm === 'lose') {
      if (p.items.length) { const i = this.rand(p.items.length); const d = this.def(p.items[i]); extra.push('Потеряно: ' + (this.knows(p, d) ? d.name : d.vague)); p.items.splice(i, 1); }
    }
    if (harm === 'injury') { p.injuries++; extra.push(p.injuries >= DEADLY_INJURIES ? 'Эта рана оказалась последней.' : 'Вы ранены.'); if (p.injuries >= DEADLY_INJURIES) harm = 'death'; }
    if (harm === 'death') { s.dead = true; if (out.harm === 'deadly') extra.push('Вы не вернётесь.'); }
    s.log.push({ q: node.text, a: c.text, r: out.text, extra });
    if (s.dead) {
      s.finished = true;
      p.status = 'dead';
      this.say(`${p.name} не возвращается. Шлюз больше не откроется.`, 'bad');
      this.phase = 'sortieResult';
    } else if (out.next) s.node = out.next;
    else s.finished = true;
  }
  sortieReport(pid, tell) {
    this.need('sortie');
    const s = this.sortie, p = this.P(pid);
    if (s.pid !== pid || !s.finished) this.err('Вылазка ещё не окончена');
    s.told = !!tell;
    p.immune = true;
    this.say(`${p.name} снова у шлюза${tell ? ' и рассказывает всё как было' : ' и о вылазке молчит'}. Защита от следующего голосования.`, 'event');
    this.phase = 'sortieResult';
  }
  afterEvent() {
    if (this.inside().length <= this.seats) return this.finish();
    this.phase = 'discuss';
  }

  // ---------- обсуждение и голосование ----------
  give(pid, uid, toId) {
    this.need('discuss');
    const p = this.P(pid), to = this.P(toId);
    if (p.status !== 'in' || to.status !== 'in' || p === to) this.err('Передать вещь можно только другому игроку в убежище');
    const i = p.items.findIndex((x) => x.uid === uid);
    if (i < 0) this.err('У вас нет этой вещи');
    to.items.push(p.items.splice(i, 1)[0]);
    this.say(`${p.name} передаёт вещь: ${to.name}`, 'trade');
  }
  startVote() {
    this.phase = 'vote';
    this.votes = {};
    for (const p of this.inside()) if (p.bot) this.votes[p.id] = this.botVote(p);
    this.closeVoteIfDone();
  }
  candidates() { const c = this.inside().filter((p) => !p.immune); return c.length ? c : this.inside(); }
  knownValue(p) {
    let v = 0;
    const add = (g) => { for (const n in g || {}) v += g[n]; };
    for (const c of p.cards) if (p.revealed[c.key]) add(c.gives);
    for (const i of p.items) if (i.revealed) add(this.def(i).gives);
    return v - p.injuries;
  }
  botVote(bot) {
    const c = this.candidates().filter((p) => p !== bot);
    const pool = c.length ? c : this.candidates();
    let best = null, bestV = Infinity;
    for (const p of pool) { const v = this.knownValue(p) + this.rng() * 4; if (v < bestV) { bestV = v; best = p; } }
    return best.id;
  }
  vote(pid, targetId) {
    this.need('vote');
    const p = this.P(pid);
    if (p.status !== 'in') this.err('Голосуют только те, кто в убежище');
    if (!this.candidates().some((c) => c.id === targetId)) this.err('За этого игрока голосовать нельзя');
    this.votes[pid] = targetId;
    this.closeVoteIfDone();
  }
  closeVoteIfDone() { if (this.phase === 'vote' && this.inside().every((p) => this.votes[p.id])) this.resolveVote(); }
  resolveVote() {
    const tally = {};
    for (const v of Object.values(this.votes)) tally[v] = (tally[v] || 0) + 1;
    const max = Math.max(...Object.values(tally));
    const tied = Object.keys(tally).filter((id) => tally[id] === max);
    const out = this.P(tied[this.rand(tied.length)]);
    out.status = 'out';
    this.lastVote = { votes: Object.assign({}, this.votes), tally, exiled: out.id, tie: tied.length > 1 };
    for (const p of this.players) p.immune = false;
    this.say(`${out.name} остаётся за дверью${tied.length > 1 ? ' (голоса разделились, решил жребий)' : ''}. Рюкзак уходит вместе с хозяином.`, 'bad');
    this.phase = 'exile';
  }

  next() {
    switch (this.phase) {
      case 'reveal': for (const p of this.inside()) if (!p.acted) this.botReveal(p); return this.closeRevealIfDone();
      case 'sortieCall': return this.closeSortieCall();
      case 'event': case 'sortieResult': return this.afterEvent();
      case 'discuss': return this.startVote();
      case 'vote': for (const p of this.inside()) if (!this.votes[p.id]) this.votes[p.id] = this.botVote(p); return this.closeVoteIfDone();
      case 'exile': return this.inside().length <= this.seats ? this.finish() : this.enterRound();
      default: this.err('Сейчас нечего продолжать');
    }
  }

  // ---------- исход ----------
  supplyOf(members) {
    const skills = new Set(members.flatMap((m) => m.skills));
    const tot = {};
    const add = (g, k) => { for (const n in g || {}) tot[n] = (tot[n] || 0) + g[n] * (k || 1); };
    for (const m of members) {
      for (const c of m.cards) if (!(c.key === 'prof' && m.fake)) add(c.gives);
      for (const i of m.items) { const d = this.def(i); if (d.knownBy && !d.knownBy.some((s) => skills.has(s))) continue; add(d.gives); }
      if (m.injuries) add({ med: -m.injuries });
    }
    return tot;
  }
  requirements(base, count, extra) {
    const f = DIFF[this.difficulty].factor, out = {};
    for (const n in base) out[n] = Math.ceil(base[n] * count / 4 * f) + ((extra && extra[n]) || 0);
    return out;
  }
  judge(members, base, has, extra, days) {
    const req = this.requirements(base, members.length, extra);
    const sup = this.supplyOf(members);
    const rows = Object.keys(req).map((n) => {
      const have = (has[n] || 0) + (sup[n] || 0);
      return { need: n, name: this.sc.needs[n].name, icon: this.sc.needs[n].icon, req: req[n], have, ok: have >= req[n] };
    });
    const crises = rows.filter((r) => !r.ok).length;
    const slack = DIFF[this.difficulty].slack; // сколько кризисов группа переживает без потерь
    const outcome = crises <= slack ? 'all' : crises === slack + 1 && members.length > 1 ? 'losses' : 'dead';
    let casualty = null;
    if (outcome === 'losses') {
      const weak = (m) => m.injuries * 2 - m.cards.filter((c) => c.key === 'health' || c.key === 'bio').reduce((s, c) => s + Object.values(c.gives).reduce((a, b) => a + b, 0), 0) + this.rng();
      casualty = members.slice().sort((a, b) => weak(b) - weak(a))[0];
    }
    const lines = rows.map((r, i) => ({ day: Math.max(2, Math.round(days * (i + 1) / (rows.length + 1))), ok: r.ok, text: this.sc.needs[r.need][r.ok ? 'ok' : 'fail'], icon: r.icon }));
    const survivors = outcome === 'dead' ? [] : members.filter((m) => m !== casualty).map((m) => m.id);
    return { rows, crises, outcome, casualty: casualty && casualty.id, lines, survivors };
  }
  finish() {
    const crew = this.inside(), out = this.outside();
    const extra = Object.assign({}, this.needExtra);
    if (this.twist) extra[this.twist.need] = (extra[this.twist.need] || 0) + this.twist.add;
    const bunker = this.judge(crew, this.sc.baseNeeds, this.has, extra, this.bunker.days);
    const camp = out.length ? this.judge(out, this.sc.outsideNeeds, {}, {}, this.bunker.days) : null;
    this.epilogue = { twist: this.twist && this.twist.text, days: this.bunker.days, bunker, camp, survivors: [...bunker.survivors, ...(camp ? camp.survivors : [])] };
    this.phase = 'epilogue';
  }
  restart() {
    this.need('epilogue');
    this.phase = 'lobby';
    this.log = []; this.round = 0; this.epilogue = null;
    for (const p of this.players) { p.status = 'in'; delete p.cards; p.items = []; }
  }

  // ---------- то, что видит конкретный игрок ----------
  itemView(inst, viewer, final) {
    const d = this.def(inst);
    const known = final || this.knows(viewer, d);
    return { uid: inst.uid, id: known ? inst.id : null, icon: known ? d.icon : '❔', name: known ? d.name : d.vague, size: d.size || 1, gives: known ? d.gives : null, known, revealed: !!inst.revealed };
  }
  view(pid) {
    const me = this.P(pid);
    const final = this.phase === 'epilogue';
    const playing = this.phase !== 'lobby';
    const v = {
      phase: this.phase, round: this.round, difficulty: this.difficulty, difficulties: Object.keys(DIFF).map((k) => ({ id: k, name: DIFF[k].name })),
      danger: playing ? this.danger() : 0, minPlayers: MIN_PLAYERS, title: this.sc.title,
      needsMeta: this.sc.needs,
      you: { id: me.id, host: me.host, status: me.status, skills: (me.skills || []).map((s) => this.sc.skills[s]), fake: !!me.fake },
      players: this.players.map((p) => ({
        id: p.id, name: p.name, bot: p.bot, host: p.host, connected: p.connected, status: p.status,
        immune: !!p.immune, injuries: p.injuries || 0, acted: !!p.acted, late: !!p.late,
        loc: playing && p.loc ? p.loc.icon + ' ' + p.loc.name : '',
        scrDone: !!(p.scr && p.scr.done),
        cards: playing && p.cards ? p.cards.filter((c) => final || p === me || p.revealed[c.key]).map((c) => Object.assign({}, c, { revealed: !!p.revealed[c.key] })) : [],
        items: playing && this.phase !== 'scramble' && this.phase !== 'briefing' ? (p.items || []).filter((i) => final || p === me || i.revealed).map((i) => this.itemView(i, me, final)) : [],
        itemCount: (p.items || []).length,
        fake: final ? !!p.fake : undefined,
      })),
      log: this.log.slice(-40),
    };
    if (!playing) return v;
    const req = this.requirements(this.sc.baseNeeds, this.seats, this.needExtra);
    v.bunker = {
      name: this.bunker.name, desc: this.bunker.desc, days: this.bunker.days, seats: this.seats,
      defect: this.bunker.defect.text,
      rows: Object.keys(req).map((n) => ({ need: n, name: this.sc.needs[n].name, icon: this.sc.needs[n].icon, req: req[n], has: this.has[n] || 0 })),
    };
    if (this.phase === 'briefing' || this.phase === 'scramble') {
      const L = me.loc;
      v.alert = this.sc.alert;
      v.scr = { name: L.name, icon: L.icon, desc: L.desc, time: L.time, cap: L.cap, bag: L.bag, done: me.scr.done, late: me.late, lost: me.scr.lost || null, blind: !!me.scr.blind };
      if (this.phase === 'scramble') {
        Object.assign(v.scr, {
          secPerUnit: L.secPerUnit, start: L.start, exit: L.exit, deadline: me.scr.deadline,
          zones: L.zones.map((z) => ({
            id: z.id, name: z.name, icon: z.icon, x: z.x, y: z.y,
            items: me.map ? me.map.find((m) => m.id === z.id).items.filter((i) => { const d = this.def(i); return !d.onlyFor || d.onlyFor.some((s) => me.skills.includes(s)); }).map((i) => this.itemView(i, me, false)) : [],
          })),
          packed: me.items.map((i) => i.uid),
        });
      }
    }
    if (this.event) v.event = this.event;
    if (this.phase === 'reveal' && me.status === 'out') v.radio = { hint: this.nextEvent.hint, sent: this.radioSent };
    if (this.phase === 'sortieCall') v.volunteers = this.volunteers.slice();
    if (this.sortie && (this.phase === 'sortie' || this.phase === 'sortieResult')) {
      const s = this.sortie, mine = s.pid === pid;
      v.sortie = { pid: s.pid, title: this.sc.sorties[s.id].title, finished: s.finished, dead: s.dead, told: s.told, mine };
      if (mine || (this.phase === 'sortieResult' && s.told)) v.sortie.log = s.log;
      if (mine && !s.finished) { v.sortie.text = this.sc.sorties[s.id].nodes[s.node].text; v.sortie.choices = this.sortieChoices(me); }
    }
    if (this.phase === 'vote') v.vote = { voted: Object.keys(this.votes), mine: this.votes[pid] || null, candidates: this.candidates().map((p) => p.id) };
    if (this.lastVote) v.lastVote = this.lastVote;
    if (final) v.epilogue = this.epilogue;
    return v;
  }
}

module.exports = { Game, DIFF, MIN_PLAYERS };
