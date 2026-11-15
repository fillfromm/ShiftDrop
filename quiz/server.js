// Сервер викторины. Без зависимостей: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const PUBLIC = path.join(__dirname, 'public');
const STATE_FILE = path.join(DATA, 'state.json');
fs.mkdirSync(UPLOADS, { recursive: true });

const uid = () => crypto.randomBytes(6).toString('hex');
const str = (v, max) => String(v ?? '').slice(0, max);
const int = (v) => Math.max(-9999999, Math.min(9999999, Math.round(Number(v)) || 0));

// ---------- состояние ----------

function normalizePack(pack) {
  const rounds = (Array.isArray(pack?.rounds) ? pack.rounds : []).slice(0, 20).map((r, i) => ({
    name: str(r?.name, 60) || `Раунд ${i + 1}`,
    categories: (Array.isArray(r?.categories) ? r.categories : []).slice(0, 12).map((c) => ({
      name: str(c?.name, 60),
      questions: (Array.isArray(c?.questions) ? c.questions : []).slice(0, 12).map((q) => ({
        id: /^[0-9a-f]{12}$/.test(q?.id) ? q.id : uid(),
        value: int(q?.value),
        text: str(q?.text, 2000),
        answer: str(q?.answer, 1000),
        image: str(q?.image, 500),
      })),
    })),
  }));
  if (!rounds.length) rounds.push({ name: 'Раунд 1', categories: [] });
  return { title: str(pack?.title, 80) || 'Викторина', rounds };
}

function freshState() {
  return {
    pin: String(crypto.randomInt(1000, 10000)),
    pack: normalizePack(require('./default-pack.js')),
    players: [],
    played: {},
    roundIndex: 0,
    view: 'lobby', // lobby | game | results
    current: null, // { id, phase: question|answer, armed, queue, locked, winner }
    settings: { penalty: true, autoArm: true },
  };
}

let state;
try {
  state = { ...freshState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
} catch {
  state = freshState();
}
const PIN = process.env.HOST_PIN || state.pin;

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(STATE_FILE + '.tmp', JSON.stringify(state), (err) => {
      if (!err) fs.rename(STATE_FILE + '.tmp', STATE_FILE, () => {});
    });
  }, 200);
}

function findQuestion(id) {
  for (const [r, round] of state.pack.rounds.entries())
    for (const cat of round.categories)
      for (const q of cat.questions) if (q.id === id) return { r, cat, q };
  return null;
}

const lanUrls = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);

// ---------- клиенты (SSE) ----------

const clients = new Set(); // { res, role, playerId }

function publicState() {
  const round = state.pack.rounds[state.roundIndex] || state.pack.rounds[0];
  let current = null;
  if (state.current) {
    const f = findQuestion(state.current.id);
    if (f) {
      current = {
        ...state.current,
        category: f.cat.name,
        value: f.q.value,
        text: f.q.text,
        image: f.q.image,
        answer: state.current.phase === 'answer' ? f.q.answer : null,
      };
    }
  }
  const online = new Set([...clients].map((c) => c.playerId).filter(Boolean));
  return {
    title: state.pack.title,
    view: state.view,
    rounds: state.pack.rounds.map((r) => r.name),
    roundIndex: state.roundIndex,
    board: round.categories.map((c) => ({
      name: c.name,
      questions: c.questions.map((q) => ({ id: q.id, value: q.value, played: !!state.played[q.id] })),
    })),
    players: state.players.map((p) => ({ id: p.id, name: p.name, score: p.score, online: online.has(p.id) })),
    current,
    settings: state.settings,
    publicUrl: process.env.PUBLIC_URL || null,
    lan: lanUrls(),
  };
}

function broadcast() {
  const pub = publicState();
  const pubMsg = `data: ${JSON.stringify(pub)}\n\n`;
  let hostMsg = null;
  for (const c of clients) {
    if (c.role === 'host') {
      if (!hostMsg) {
        const f = state.current && findQuestion(state.current.id);
        const host = { ...pub, pack: state.pack };
        if (f) host.current = { ...pub.current, answer: f.q.answer };
        hostMsg = `data: ${JSON.stringify(host)}\n\n`;
      }
      c.res.write(hostMsg);
    } else c.res.write(pubMsg);
  }
}

function changed() {
  save();
  broadcast();
}

setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 20000);

// ---------- действия ----------

const playerActions = {
  join({ name, token }) {
    let p = state.players.find((x) => x.token === token);
    name = str(name, 24).trim();
    if (!p) {
      if (!name) throw new Error('Введите имя');
      if (state.players.length >= 100) throw new Error('Слишком много игроков');
      p = { id: uid(), token: uid() + uid(), name, score: 0 };
      state.players.push(p);
    } else if (name) p.name = name;
    changed();
    return { id: p.id, token: p.token };
  },
  buzz({ token }) {
    const p = state.players.find((x) => x.token === token);
    const cur = state.current;
    if (!p || !cur || cur.phase !== 'question' || !cur.armed) return {};
    if (cur.queue.includes(p.id) || cur.locked.includes(p.id)) return {};
    cur.queue.push(p.id);
    changed();
    return {};
  },
};

const player = (id) => state.players.find((p) => p.id === id);

const hostActions = {
  view({ view }) {
    if (['lobby', 'game', 'results'].includes(view)) state.view = view;
  },
  open({ id }) {
    const f = findQuestion(id);
    if (!f) return;
    state.current = { id, phase: 'question', armed: !!state.settings.autoArm, queue: [], locked: [], winner: null };
    state.roundIndex = f.r;
    state.view = 'game';
  },
  arm({ on }) {
    if (state.current?.phase === 'question') state.current.armed = !!on;
  },
  // Вердикт первому в очереди: result = correct | wrong | skip (снять без штрафа)
  judge({ result }) {
    const cur = state.current;
    if (!cur || cur.phase !== 'question' || !cur.queue.length) return;
    const p = player(cur.queue[0]);
    const value = findQuestion(cur.id)?.q.value || 0;
    if (result === 'correct') {
      if (p) p.score += value;
      cur.winner = cur.queue[0];
      cur.phase = 'answer';
      cur.armed = false;
      state.played[cur.id] = true;
    } else {
      if (p && result === 'wrong' && state.settings.penalty) p.score -= value;
      cur.locked.push(cur.queue.shift());
    }
  },
  reveal() {
    const cur = state.current;
    if (!cur) return;
    cur.phase = 'answer';
    cur.armed = false;
    state.played[cur.id] = true;
  },
  // Закрыть вопрос. cancel = вернуть его на табло несыгранным.
  close({ cancel }) {
    if (!state.current) return;
    if (cancel) delete state.played[state.current.id];
    else state.played[state.current.id] = true;
    state.current = null;
  },
  unplay({ id }) {
    delete state.played[id];
  },
  round({ index }) {
    if (state.pack.rounds[index]) state.roundIndex = index;
  },
  setScore({ id, score }) {
    const p = player(id);
    if (p) p.score = int(score);
  },
  addScore({ id, delta }) {
    const p = player(id);
    if (p) p.score = int(p.score + int(delta));
  },
  rename({ id, name }) {
    const p = player(id);
    name = str(name, 24).trim();
    if (p && name) p.name = name;
  },
  kick({ id }) {
    state.players = state.players.filter((p) => p.id !== id);
    if (state.current) {
      state.current.queue = state.current.queue.filter((x) => x !== id);
      state.current.locked = state.current.locked.filter((x) => x !== id);
    }
  },
  pack({ pack }) {
    state.pack = normalizePack(pack);
    state.current = null;
    for (const id of Object.keys(state.played)) if (!findQuestion(id)) delete state.played[id];
    if (!state.pack.rounds[state.roundIndex]) state.roundIndex = 0;
  },
  settings({ penalty, autoArm }) {
    if (typeof penalty === 'boolean') state.settings.penalty = penalty;
    if (typeof autoArm === 'boolean') state.settings.autoArm = autoArm;
  },
  // Новая игра: вопросы снова доступны, счёт обнулён; players = ещё и удалить игроков.
  reset({ players }) {
    state.played = {};
    state.current = null;
    state.roundIndex = 0;
    state.view = 'lobby';
    if (players) state.players = [];
    else for (const p of state.players) p.score = 0;
  },
};

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const PAGES = { '/': 'play.html', '/host': 'host.html', '/screen': 'screen.html' };

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Слишком большой файл'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendFile(res, root, rel) {
  const file = path.join(root, path.normalize(rel));
  if (!file.startsWith(root + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': root === UPLOADS ? 'max-age=31536000' : 'no-cache',
    });
    res.end(data);
  });
}

const pinOk = (pin) => {
  const a = Buffer.from(String(pin ?? ''));
  const b = Buffer.from(PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && p === '/api/events') {
      const role = url.searchParams.get('role');
      if (role === 'host' && !pinOk(url.searchParams.get('pin'))) return json(res, 401, { error: 'Неверный PIN' });
      const pl = state.players.find((x) => x.token === url.searchParams.get('token'));
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const client = { res, role, playerId: pl?.id };
      clients.add(client);
      req.on('close', () => {
        clients.delete(client);
        if (client.playerId) broadcast();
      });
      broadcast();
      return;
    }

    if (req.method === 'POST' && p === '/api/action') {
      const body = JSON.parse((await readBody(req, 2e6)).toString() || '{}');
      const { action, data = {} } = body;
      if (Object.hasOwn(playerActions, action)) return json(res, 200, playerActions[action](data));
      if (Object.hasOwn(hostActions, action)) {
        if (!pinOk(body.pin)) return json(res, 401, { error: 'Неверный PIN' });
        hostActions[action](data);
        changed();
        return json(res, 200, {});
      }
      return json(res, 400, { error: 'Неизвестное действие' });
    }

    if (req.method === 'POST' && p === '/api/login') {
      const body = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      return pinOk(body.pin) ? json(res, 200, {}) : json(res, 401, { error: 'Неверный PIN' });
    }

    if (req.method === 'POST' && p === '/api/upload') {
      if (!pinOk(url.searchParams.get('pin'))) return json(res, 401, { error: 'Неверный PIN' });
      const ext = IMAGE_EXT[req.headers['content-type']];
      if (!ext) return json(res, 400, { error: 'Нужна картинка PNG, JPG, GIF или WebP' });
      const name = uid() + ext;
      fs.writeFileSync(path.join(UPLOADS, name), await readBody(req, 10e6));
      return json(res, 200, { url: '/uploads/' + name });
    }

    if (req.method === 'GET') {
      if (PAGES[p]) return sendFile(res, PUBLIC, PAGES[p]);
      if (p.startsWith('/uploads/')) return sendFile(res, UPLOADS, p.slice('/uploads/'.length));
      return sendFile(res, PUBLIC, p.slice(1));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: e.message || 'Ошибка' });
    else res.end();
  }
});

server.listen(PORT, () => {
  const base = process.env.PUBLIC_URL || lanUrls()[0] || `http://localhost:${PORT}`;
  console.log(`\n  Викторина запущена\n`);
  console.log(`  Игроки (телефоны):  ${base}/`);
  console.log(`  Экран (ТВ/проектор): ${base}/screen`);
  console.log(`  Ведущий:             ${base}/host`);
  console.log(`  PIN ведущего:        ${PIN}\n`);
});
