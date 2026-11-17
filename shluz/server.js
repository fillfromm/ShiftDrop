'use strict';
// Сервер без зависимостей: раздаёт public/, принимает действия по POST и рассылает состояние через SSE.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Game } = require('./engine');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const SCENARIO = path.join(__dirname, 'content', 'scenario.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const ROOM_TTL_MS = 6 * 3600 * 1000;
const MAX_ROOMS = 200; // защита от того, что кто-то завалит сервер пустыми комнатами

const rooms = new Map(); // code -> { game, tokens: Map(token -> pid), streams: Map(pid -> Set(res)), timer, touched }

function loadScenario() { return JSON.parse(fs.readFileSync(SCENARIO, 'utf8')); } // читается при создании комнаты: правки сценария не требуют перезапуска
function newCode() {
  const abc = 'АБВГДЕЖИКЛМНПРСТ';
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += abc[crypto.randomInt(abc.length)]; if (!rooms.has(c)) return c; }
}
function broadcast(room) {
  room.touched = Date.now();
  for (const [pid, set] of room.streams) {
    if (!set.size) continue;
    const data = `data: ${JSON.stringify(Object.assign(room.game.view(pid), { code: room.code, now: Date.now() }))}\n\n`;
    for (const res of set) res.write(data);
  }
}
function fail(msg, status) { const e = new Error(msg); e.user = true; e.status = status || 400; throw e; }

const HOST_ONLY = new Set(['setDifficulty', 'addBot', 'removeBot', 'start', 'alarm', 'next', 'restart']);

function act(room, pid, b) {
  const g = room.game, me = g.P(pid);
  if (HOST_ONLY.has(b.action) && !me.host) fail('Это может сделать только ведущий');
  switch (b.action) {
    case 'setDifficulty': return g.setDifficulty(b.difficulty);
    case 'addBot': return g.addBot();
    case 'removeBot': return g.removeBot();
    case 'start': return g.start();
    case 'alarm': {
      const closeAt = g.alarm(Date.now());
      clearTimeout(room.timer);
      room.timer = setTimeout(() => { g.forceScramble(); broadcast(room); }, closeAt - Date.now());
      return g.closeScrambleIfDone();
    }
    case 'pack': return g.pack(pid, b.uids);
    case 'scrambleDone': return g.scrambleDone(pid, Date.now(), b.late);
    case 'grabBlind': return g.grabBlind(pid);
    case 'reveal': return g.reveal(pid, { card: b.card, item: b.item });
    case 'radio': return g.radio(pid, !!b.truth);
    case 'volunteer': return g.volunteer(pid);
    case 'sortieChoose': return g.sortieChoose(pid, b.index);
    case 'sortieReport': return g.sortieReport(pid, !!b.tell);
    case 'give': return g.give(pid, b.item, b.to);
    case 'vote': return g.vote(pid, b.target);
    case 'next': return g.next();
    case 'restart': return g.restart();
    default: fail('Неизвестное действие');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e5) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function json(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function auth(code, token) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) fail('Комната не найдена', 404);
  const pid = room.tokens.get(token);
  if (!pid) fail('Вы не в этой комнате', 403);
  return { room, pid };
}

async function api(req, res, url) {
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const { room, pid } = auth(url.searchParams.get('code'), url.searchParams.get('token'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 1500\n\n');
    if (!room.streams.has(pid)) room.streams.set(pid, new Set());
    room.streams.get(pid).add(res);
    room.game.P(pid).connected = true;
    broadcast(room);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      const set = room.streams.get(pid);
      set.delete(res);
      if (!set.size) { room.game.P(pid).connected = false; broadcast(room); }
    });
    return;
  }
  if (req.method !== 'POST') fail('Not found', 404);
  const b = await readBody(req);
  if (url.pathname === '/api/create') {
    if (rooms.size >= MAX_ROOMS) fail('Сервер переполнен, попробуйте позже', 503);
    const code = newCode();
    const game = new Game(loadScenario());
    const p = game.addPlayer(b.name, { host: true });
    const token = crypto.randomBytes(16).toString('hex');
    rooms.set(code, { code, game, tokens: new Map([[token, p.id]]), streams: new Map(), timer: null, touched: Date.now() });
    return json(res, 200, { code, token });
  }
  if (url.pathname === '/api/join') {
    const room = rooms.get(String(b.code || '').trim().toUpperCase());
    if (!room) fail('Комната с таким кодом не найдена', 404);
    const p = room.game.addPlayer(b.name);
    const token = crypto.randomBytes(16).toString('hex');
    room.tokens.set(token, p.id);
    broadcast(room);
    return json(res, 200, { code: room.code, token });
  }
  if (url.pathname === '/api/act') {
    const { room, pid } = auth(b.code, b.token);
    act(room, pid, b);
    broadcast(room);
    return json(res, 200, { ok: true });
  }
  fail('Not found', 404);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => {
      if (!e.user) console.error(e);
      if (!res.headersSent) json(res, e.status || (e.user ? 400 : 500), { error: e.user ? e.message : 'Ошибка сервера' });
    });
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

setInterval(() => { for (const [code, r] of rooms) if (Date.now() - r.touched > ROOM_TTL_MS) { clearTimeout(r.timer); rooms.delete(code); } }, 600000).unref();

server.listen(PORT, () => console.log(`Шлюз запущен: http://localhost:${PORT}`));
