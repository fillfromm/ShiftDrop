// Общие функции для всех страниц
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

async function api(action, data = {}, pin) {
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data, pin }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Ошибка');
  return body;
}

// Подписка на состояние игры. EventSource сам переподключается при обрыве.
function subscribe(params, onState, onStatus) {
  const es = new EventSource('/api/events?' + new URLSearchParams(params));
  es.onmessage = (e) => onState(JSON.parse(e.data));
  es.onopen = () => onStatus && onStatus(true);
  es.onerror = () => onStatus && onStatus(false);
  return es;
}

const playerName = (s, id) => s.players.find((p) => p.id === id)?.name ?? '—';

function joinUrl(s) {
  if (s.publicUrl) return s.publicUrl.replace(/\/$/, '') + '/';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return (local && s.lan[0] ? s.lan[0] : location.origin) + '/';
}
