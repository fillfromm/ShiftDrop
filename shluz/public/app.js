'use strict';
(function () {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const KEY = 'shluz-session';
  let sess = load();          // { code, token, name }
  let S = null;               // последнее состояние от сервера
  let es = null;
  let scr = null;             // локальное состояние фазы сбора
  let giveUid = null;         // вещь, которую игрок собрался передать
  let bunkerOpen = true;
  let epiShown = false;
  let homeMsg = '';

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  function save() { try { sess ? localStorage.setItem(KEY, JSON.stringify(sess)) : localStorage.removeItem(KEY); } catch (e) { /* без хранилища просто не переживём перезагрузку */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('on'), 2600); }

  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Ошибка сети');
    return j;
  }
  function send(action, extra) {
    return post('/api/act', Object.assign({ code: sess.code, token: sess.token, action }, extra)).catch((e) => toast(e.message));
  }
  function connect() {
    if (es) es.close();
    S = null;
    es = new EventSource(`/api/events?code=${encodeURIComponent(sess.code)}&token=${sess.token}`);
    es.onmessage = (e) => { S = JSON.parse(e.data); render(); };
    es.onerror = () => {
      if (es.readyState === 2) { // сервер отказал: комнаты больше нет
        es = null; sess = null; save(); S = null; stopScramble();
        homeMsg = 'Комната закрыта или сервер был перезапущен.';
        render();
      }
    };
  }
  function leave() { if (es) es.close(); es = null; sess = null; S = null; save(); stopScramble(); render(); }

  // ---------- мелкие шаблоны ----------
  function gives(g) {
    if (!g) return '<span class="gives dim">эффект неизвестен</span>';
    const parts = Object.keys(g).map((n) => `<span class="${g[n] < 0 ? 'neg' : 'pos'}">${S.needsMeta[n].icon}${g[n] > 0 ? '+' : ''}${g[n]}</span>`);
    return parts.length ? `<span class="gives">${parts.join(' ')}</span>` : '<span class="gives dim">без эффекта</span>';
  }
  const me = () => S.players.find((p) => p.id === S.you.id);
  const byId = (id) => S.players.find((p) => p.id === id);
  const insideList = () => S.players.filter((p) => p.status === 'in');
  const dots = (n) => '●'.repeat(n) + '○'.repeat(3 - n);
  const hostBtn = (label, cls) => (S.you.host ? `<button class="${cls || 'primary'} wide" data-act="next">${label}</button>` : '<p class="dim small">Ждём ведущего…</p>');

  function cardHtml(c, opts) {
    const o = opts || {};
    return `<div class="card ${c.revealed ? 'open' : 'hidden'}">
      <div class="lab"><span>${esc(c.label)}</span><span>${c.revealed ? 'открыта' : 'скрыта'}</span></div>
      <div>${esc(c.text)}</div>
      ${c.skills && c.skills.length ? `<div class="small dim">умеет: ${esc(c.skills.join(', '))}</div>` : ''}
      ${gives(c.gives)}
      ${o.reveal && !c.revealed ? `<button class="mini" data-act="reveal" data-card="${c.key}">Открыть всем</button>` : ''}
    </div>`;
  }
  function itemHtml(i, opts) {
    const o = opts || {};
    return `<div class="card ${i.revealed ? 'open' : 'hidden'}">
      <div class="lab"><span>Вещь${i.size > 1 ? ' · ' + i.size + ' места' : ''}</span><span>${i.revealed ? 'открыта' : 'скрыта'}</span></div>
      <div>${i.icon} ${esc(i.name)}</div>
      ${gives(i.gives)}
      ${o.reveal && !i.revealed ? `<button class="mini" data-act="reveal" data-item="${i.uid}">Показать всем</button>` : ''}
      ${o.give ? `<button class="mini" data-act="pickGive" data-item="${i.uid}">${giveUid === i.uid ? 'Отмена' : 'Передать…'}</button>` : ''}
    </div>`;
  }

  // ---------- экраны ----------
  function home() {
    app.innerHTML = `
      <h1>Шлюз</h1>
      <p class="dim">Минута на сборы, потом спор за место в убежище. Половина останется снаружи.</p>
      ${homeMsg ? `<p class="badge bad">${esc(homeMsg)}</p>` : ''}
      <div class="panel">
        <label for="name">Ваше имя</label>
        <input id="name" maxlength="16" autocomplete="nickname" value="${esc((load() || {}).name || localStorage.getItem('shluz-name') || '')}">
        <div style="height:12px"></div>
        <button class="primary wide" data-act="create">Создать комнату</button>
      </div>
      <div class="panel">
        <label for="code">Код комнаты</label>
        <input id="code" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="например, ВДНК">
        <div style="height:12px"></div>
        <button class="wide" data-act="join">Войти по коду</button>
      </div>`;
  }
  async function enter(kind) {
    const name = document.getElementById('name').value.trim();
    if (!name) return toast('Введите имя');
    try { localStorage.setItem('shluz-name', name); } catch (e) { /* не критично */ }
    try {
      const r = await post('/api/' + kind, { name, code: kind === 'join' ? document.getElementById('code').value : undefined });
      sess = { code: r.code, token: r.token, name }; homeMsg = ''; save(); connect(); render();
    } catch (e) { toast(e.message); }
  }

  function lobby() {
    const h = S.you.host;
    app.innerHTML = `
      <div class="row spread"><h1>Шлюз</h1><button class="mini" data-act="leave">Выйти</button></div>
      <div class="panel hot"><h3>Код комнаты</h3><div class="code">${esc(S.code)}</div>
        <p class="dim small">Друзья открывают этот же сайт и вводят код.</p></div>
      <div class="panel"><h3>Участники · ${S.players.length}</h3>
        ${S.players.map((p) => `<div class="player row spread"><span>${esc(p.name)}${p.id === S.you.id ? ' <span class="dim">(вы)</span>' : ''}</span>
          <span>${p.host ? '<span class="badge acc">ведущий</span>' : ''} ${p.bot ? '<span class="badge">бот</span>' : ''} ${!p.connected && !p.bot ? '<span class="badge bad">не в сети</span>' : ''}</span></div>`).join('')}
        ${h ? `<div class="row" style="margin-top:10px"><button data-act="addBot">+ Бот</button><button data-act="removeBot">− Бот</button></div>` : ''}
      </div>
      <div class="panel"><h3>Сложность</h3>
        ${h ? `<select id="diff">${S.difficulties.map((d) => `<option value="${d.id}" ${d.id === S.difficulty ? 'selected' : ''}>${d.name}</option>`).join('')}</select>` : `<div>${esc(S.difficulties.find((d) => d.id === S.difficulty).name)}</div>`}
        <p class="dim small" style="margin-top:8px">${{ easy: 'События мягкие, вылазки редко кончаются плохо, убежищу нужно меньше.', rising: 'Первый раунд спокойный, дальше события злее, а вылазки опаснее.', hard: 'Сразу максимум опасности и никакого права на ошибку.' }[S.difficulty]}</p>
      </div>
      ${h ? `<button class="primary wide" data-act="start" ${S.players.length < S.minPlayers ? 'disabled' : ''}>Раздать карты</button>
        ${S.players.length < S.minPlayers ? `<p class="dim small">Нужно минимум ${S.minPlayers} участника. Недостающих можно заменить ботами.</p>` : ''}` : '<p class="dim">Ждём, пока ведущий начнёт игру…</p>'}`;
  }

  function myCards(opts) {
    const m = me();
    return `<div class="panel"><h3>Ваш персонаж${S.you.fake ? ' · профессия ненастоящая, её бонус не сработает' : ''}</h3>
      <div class="cards">${m.cards.map((c) => cardHtml(c, opts)).join('')}</div>
      ${m.items.length || (opts && opts.items) ? `<h3 style="margin-top:14px">Ваши вещи · ${m.items.length}</h3><div class="cards">${m.items.map((i) => itemHtml(i, opts)).join('') || '<span class="dim">Пусто</span>'}</div>` : ''}
    </div>`;
  }

  function briefing() {
    const L = S.scr;
    app.innerHTML = `
      <h1>Обычный день</h1>
      <p class="dim">Изучите персонажа. Тревога прозвучит у всех одновременно.</p>
      <div class="panel hot"><h3>Где вы сейчас</h3>
        <h2>${L.icon} ${esc(L.name)}</h2><p>${esc(L.desc)}</p>
        <div class="row"><span class="badge acc">⏱ ${L.time} с на сбор</span><span class="badge acc">🎒 ${esc(L.bag)}: ${L.cap} мест</span></div>
      </div>
      ${myCards()}
      ${S.you.host ? '<button class="primary wide" data-act="alarm">📻 Включить тревогу</button>' : '<p class="dim pulse">Ждём сигнала…</p>'}`;
  }

  // ---------- сбор: вид сверху ----------
  function stopScramble() { if (scr) { clearInterval(scr.tick); scr.timers.forEach(clearTimeout); scr = null; } }
  function mountScramble() {
    const v = S.scr;
    const here = v.zones.find((z) => z.x === v.start.x && z.y === v.start.y);
    scr = { v, deadline: v.deadline - (S.now - Date.now()), pos: { x: v.start.x, y: v.start.y }, zone: here ? here.id : null, moving: false, pack: v.packed.slice(), sent: false, timers: [], items: {} };
    v.zones.forEach((z) => z.items.forEach((i) => { scr.items[i.uid] = i; }));
    app.innerHTML = `
      <div class="row spread"><div><h3>${v.icon} ${esc(v.name)} · тревога</h3><div class="small dim">${esc(S.alert)}</div></div><div class="secs" id="secs"></div></div>
      <div class="timer" id="bar"><i></i></div>
      <div class="map" id="map">
        ${here ? '' : `<span class="startmark" style="left:${v.start.x}%;top:${v.start.y}%">${esc(v.start.name)}</span>`}
        ${v.zones.map((z) => `<button class="zone" data-zone="${z.id}" style="left:${z.x}%;top:${z.y}%"><span class="ic">${z.icon}</span>${esc(z.name)}<br><span class="eta"></span></button>`).join('')}
        <button class="zone exit" data-zone="@exit" style="left:${v.exit.x}%;top:${v.exit.y}%"><span class="ic">🚪</span>${esc(v.exit.name)}<br><span class="eta"></span></button>
        <div class="me" id="dot" style="left:${v.start.x}%;top:${v.start.y}%"></div>
      </div>
      <div class="panel" id="zonebox"></div>
      <div class="panel" id="packbox"></div>
      <button class="wide" data-act="grabBlind">🎲 Хватай не глядя: случайный набор, +1 место, и сразу бежать</button>`;
    scr.tick = setInterval(tickScramble, 100);
    drawScramble();
    tickScramble();
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const packSize = () => scr.pack.reduce((s, u) => s + scr.items[u].size, 0);
  function drawScramble() {
    const v = scr.v;
    app.querySelectorAll('.zone').forEach((el) => {
      const id = el.dataset.zone;
      const t = id === '@exit' ? v.exit : v.zones.find((z) => z.id === id);
      const sec = dist(scr.pos, t) * v.secPerUnit;
      el.classList.toggle('here', scr.zone === id);
      el.disabled = scr.moving;
      el.querySelector('.eta').textContent = scr.zone === id ? 'вы здесь' : `бежать ${Math.max(1, Math.round(sec))} с`;
    });
    const zone = v.zones.find((z) => z.id === scr.zone);
    const zb = document.getElementById('zonebox');
    if (scr.moving) zb.innerHTML = '<p class="dim pulse">Бежим…</p>';
    else if (!zone) zb.innerHTML = `<p class="dim">Вы на месте «${esc(v.start.name)}». Выберите на карте, куда бежать. Закончив, жмите «${esc(v.exit.name)}».</p>`;
    else {
      const left = zone.items.filter((i) => !scr.pack.includes(i.uid));
      zb.innerHTML = `<h3>${zone.icon} ${esc(zone.name)}: что здесь лежит</h3>` + (left.length ? left.map((i) => `<button class="itembtn" data-take="${i.uid}" ${packSize() + i.size > v.cap ? 'disabled' : ''}><span class="nm">${i.icon} ${esc(i.name)}${i.size > 1 ? ` <span class="badge">${i.size} места</span>` : ''}</span>${gives(i.gives)}</button>`).join('') : '<p class="dim">Больше ничего полезного.</p>');
    }
    const used = packSize();
    document.getElementById('packbox').innerHTML = `<div class="row spread"><h3>🎒 ${esc(v.bag)} · ${used}/${v.cap}</h3><div class="slots">${Array.from({ length: v.cap }, (_, i) => `<i class="${i < used ? 'on' : ''}"></i>`).join('')}</div></div>` +
      (scr.pack.length ? scr.pack.map((u) => { const i = scr.items[u]; return `<button class="itembtn" data-drop="${u}"><span class="nm">${i.icon} ${esc(i.name)}</span>${gives(i.gives)}<span class="badge bad">✕ выложить</span></button>`; }).join('') : '<p class="dim small">Пусто. Нажмите на вещь, чтобы взять её; нажмите на вещь здесь, чтобы выложить.</p>');
  }
  function tickScramble() {
    if (!scr) return;
    const left = Math.max(0, scr.deadline - Date.now());
    const secs = document.getElementById('secs'), bar = document.getElementById('bar');
    if (!secs) return;
    secs.textContent = Math.ceil(left / 1000);
    const low = left < 10000;
    secs.classList.toggle('low', low); bar.classList.toggle('low', low);
    bar.firstElementChild.style.width = (left / (scr.v.time * 1000) * 100) + '%';
    if (left <= 0 && !scr.sent) { scr.sent = true; send('scrambleDone', { late: true }); }
  }
  function moveTo(id) {
    if (!scr || scr.moving || scr.sent || scr.zone === id) return;
    const v = scr.v;
    const t = id === '@exit' ? v.exit : v.zones.find((z) => z.id === id);
    const sec = dist(scr.pos, t) * v.secPerUnit;
    const dot = document.getElementById('dot');
    dot.style.transitionDuration = sec + 's';
    dot.style.left = t.x + '%'; dot.style.top = t.y + '%';
    scr.moving = true; scr.zone = null;
    drawScramble();
    scr.timers.push(setTimeout(() => {
      if (!scr) return;
      scr.moving = false; scr.pos = { x: t.x, y: t.y }; scr.zone = id;
      if (id === '@exit') { if (!scr.sent) { scr.sent = true; send('scrambleDone', {}); } return; }
      drawScramble();
    }, sec * 1000));
  }
  function scrambleWait() {
    const L = S.scr;
    const running = S.players.filter((p) => !p.scrDone);
    app.innerHTML = `
      <h1>${L.late ? 'Вы опоздали' : 'Вы у шлюза'}</h1>
      ${L.late ? `<div class="panel"><p class="badge bad">Ударная волна догнала вас у входа</p><p>Вы ранены${L.lost ? ` и потеряли по дороге: ${esc(L.lost)}` : ''}.</p></div>` : `<p class="dim">${L.blind ? 'Вы схватили что попало и добежали первым.' : 'Успели. Дверь ещё открыта.'}</p>`}
      <p class="dim pulse">Ещё бегут: ${running.map((p) => esc(p.name)).join(', ') || 'никто'}</p>`;
  }

  // ---------- шлюз ----------
  const PHASE = { reveal: 'Открываем карты', sortieCall: 'Нужен доброволец', sortie: 'Вылазка', sortieResult: 'Итог вылазки', event: 'Событие', discuss: 'Обсуждение', vote: 'Голосование', exile: 'Решение принято' };

  function storyHtml(log) {
    return `<div class="story">${(log || []).map((l) => `<div class="q">${esc(l.q)}</div><div class="a">→ ${esc(l.a)}</div><div class="r">${esc(l.r)}${(l.extra || []).map((x) => `<br><b>${esc(x)}</b>`).join('')}</div>`).join('')}</div>`;
  }
  function actionPanel() {
    const m = me(), inn = m.status === 'in';
    switch (S.phase) {
      case 'reveal': {
        const waiting = insideList().filter((p) => !p.acted).map((p) => esc(p.name)).join(', ');
        let h = '';
        if (inn) h = m.acted ? `<p>Вы открыли карту. Ждём: ${waiting || 'никого'}.</p>` : '<p><b>Откройте одну карту или одну вещь.</b> Кнопки внизу, в блоке «Ваш персонаж».</p>';
        else if (m.status === 'out' && S.radio) {
          h = `<p>Вы снаружи и видите то, чего не видят в убежище:</p><p><b>«${esc(S.radio.hint)}»</b></p>` +
            (S.radio.sent ? '<p class="dim">Сообщение в этом раунде уже ушло в эфир.</p>' : '<div class="row"><button data-act="radio" data-truth="1">📻 Передать как есть</button><button class="danger" data-act="radio" data-truth="">📻 Соврать</button></div>');
        } else h = `<p class="dim">Ждём: ${waiting || 'никого'}.</p>`;
        return h + (S.you.host && waiting ? '<button class="wide" data-act="next">Не ждать: открыть случайные карты за остальных</button>' : '');
      }
      case 'sortieCall': {
        const vol = S.volunteers.map((id) => esc(byId(id).name)).join(', ');
        return `<p><b>${esc(S.event.text)}</b></p>
          <p class="dim small">Доброволец уходит один и видит свою историю только на своём экране. Вернувшись, он сам решает, рассказывать ли правду. За риск: защита от ближайшего голосования. Можно и не вернуться.</p>
          <p>Вызвались: ${vol || 'пока никто'}${S.volunteers.length > 1 ? ' (пойдёт один, по жребию)' : ''}</p>
          ${inn ? `<button class="${S.volunteers.includes(m.id) ? '' : 'primary'} wide" data-act="volunteer">${S.volunteers.includes(m.id) ? 'Передумал' : 'Я пойду'}</button><div style="height:8px"></div>` : ''}
          ${hostBtn(S.volunteers.length ? 'Открыть шлюз' : 'Никто не идёт', '')}`;
      }
      case 'sortie': {
        const s = S.sortie, who = byId(s.pid);
        if (!s.mine) return `<p class="pulse"><b>${esc(who.name)}</b> снаружи. Связи нет. Ждём.</p>`;
        if (!s.finished) return `<h3>Только на вашем экране · ${esc(s.title)}</h3>${storyHtml(s.log)}<p style="margin-top:12px"><b>${esc(s.text)}</b></p>
          ${s.choices.map((c, i) => `<button class="wide" style="margin-top:6px" data-act="sortieChoose" data-index="${i}" ${c.locked ? 'disabled' : ''}>${esc(c.text)}${c.locked ? ` <span class="small dim">(${esc(c.why)})</span>` : ''}</button>`).join('')}`;
        return `<h3>Вы вернулись</h3>${storyHtml(s.log)}<p style="margin-top:12px">Всё найденное лежит в вашем рюкзаке закрытым. Что скажете остальным?</p>
          <div class="row"><button class="primary" data-act="sortieReport" data-tell="1">Показать всем, как было</button><button data-act="sortieReport" data-tell="">Промолчать</button></div>`;
      }
      case 'sortieResult': {
        const s = S.sortie, who = byId(s.pid);
        return `<p><b>${s.dead ? `${esc(who.name)} не возвращается.` : `${esc(who.name)} снова у шлюза.`}</b></p>
          ${s.log ? `<h3>${s.mine && !s.told ? 'Это видите только вы' : 'Рассказ о вылазке'}</h3>${storyHtml(s.log)}` : (s.dead ? '<p class="dim">Что там случилось, уже никто не узнает.</p>' : '<p class="dim">О том, что было снаружи, рассказа не последовало. Что в рюкзаке, тоже неизвестно.</p>')}
          <div style="height:8px"></div>${hostBtn('Дальше')}`;
      }
      case 'event':
        return `<p><b>${esc(S.event.text)}</b></p>${S.event.result ? `<p class="badge acc">${esc(S.event.result)}</p>` : ''}<div style="height:8px"></div>${hostBtn('К обсуждению')}`;
      case 'discuss':
        return `<p><b>Спорьте вслух.</b> Кого убежище не потянет? Чего не хватает по таблице ниже?</p>
          ${inn ? '<p class="dim small">Вещь можно передать другому: кнопка «Передать…» на вашей вещи, затем выберите игрока.</p>' : ''}${hostBtn('К голосованию')}`;
      case 'vote': {
        const n = insideList().length;
        return `<p><b>Кто остаётся за дверью?</b> Проголосовали: ${S.vote.voted.length} из ${n}.</p>
          ${inn ? (S.vote.mine ? `<p>Ваш голос: ${esc(byId(S.vote.mine).name)}. Его можно изменить, пока голосуют остальные.</p>` : '<p>Выберите игрока в списке ниже.</p>') : '<p class="dim">Голосуют только те, кто внутри.</p>'}
          ${S.you.host ? '<button class="wide" data-act="next">Не ждать остальных</button>' : ''}`;
      }
      case 'exile': {
        const lv = S.lastVote, out = byId(lv.exiled);
        const full = insideList().length <= S.bunker.seats;
        return `<p><b>${esc(out.name)} остаётся снаружи${lv.tie ? ' (решил жребий)' : ''}.</b></p>
          <div class="chips">${Object.keys(lv.votes).map((v) => `<span class="chip">${esc(byId(v).name)} → ${esc(byId(lv.votes[v]).name)}</span>`).join('')}</div>
          <div style="height:10px"></div>${hostBtn(full ? 'Задраить дверь и узнать исход' : 'Следующий раунд')}`;
      }
    }
    return '';
  }
  function knownSupply() {
    const tot = {};
    for (const p of insideList()) {
      for (const c of p.cards) if (c.revealed) for (const n in c.gives) tot[n] = (tot[n] || 0) + c.gives[n];
      for (const i of p.items) if (i.revealed && i.gives) for (const n in i.gives) tot[n] = (tot[n] || 0) + i.gives[n];
      if (p.injuries) tot.med = (tot.med || 0) - p.injuries;
    }
    return tot;
  }
  function bunkerPanel() {
    const b = S.bunker, k = knownSupply();
    return `<details class="panel" id="bunker" ${bunkerOpen ? 'open' : ''}><summary><b>Убежище «${esc(b.name)}»</b> · мест: ${b.seats} · ${b.days} дней</summary>
      <p class="dim small" style="margin-top:8px">${esc(b.desc)} <span class="badge bad">${esc(b.defect)}</span></p>
      <table class="needs"><tr><th>Потребность</th><th>Нужно</th><th>Есть в убежище</th><th>Открыто у игроков</th><th>Итого</th></tr>
      ${b.rows.map((r) => { const sum = r.has + (k[r.need] || 0); return `<tr><td>${r.icon} ${esc(r.name)}</td><td>${r.req}</td><td>${r.has}</td><td>${k[r.need] || 0}</td><td class="${sum >= r.req ? 'ok' : 'no'}">${sum}</td></tr>`; }).join('')}</table>
      <p class="dim small" style="margin-top:8px">«Нужно» посчитано на ${b.seats} мест. В «открыто» входят только раскрытые карты и вещи тех, кто сейчас внутри. Вещь, которую никто в убежище не умеет опознать, в исходе не засчитается.</p></details>`;
  }
  function playersPanel() {
    const m = me();
    return `<div class="panel"><h3>Игроки</h3>${S.players.map((p) => {
      const st = p.status === 'in' ? '' : p.status === 'out' ? '<span class="badge bad">снаружи</span>' : '<span class="badge bad">погиб</span>';
      let btn = '';
      if (S.phase === 'vote' && m.status === 'in' && S.vote.candidates.includes(p.id)) btn = `<button class="mini ${S.vote.mine === p.id ? 'primary' : 'danger'}" data-act="vote" data-target="${p.id}">${S.vote.mine === p.id ? 'Ваш голос' : 'Против'}</button>`;
      if (S.phase === 'discuss' && giveUid && p.status === 'in' && p.id !== m.id) btn = `<button class="mini primary" data-act="give" data-to="${p.id}">Отдать сюда</button>`;
      const hiddenCards = 6 - p.cards.filter((c) => c.revealed).length, hiddenItems = p.itemCount - p.items.filter((i) => i.revealed).length;
      return `<div class="player ${p.status === 'in' ? '' : 'gone'}"><div class="row spread"><span><b>${esc(p.name)}</b>${p.id === m.id ? ' <span class="dim">(вы)</span>' : ''} <span class="dim small">${esc(p.loc)}</span></span>
        <span class="row">${st}${p.immune ? '<span class="badge good">защита</span>' : ''}${p.injuries ? `<span class="badge bad">ранен${p.injuries > 1 ? ' ×' + p.injuries : ''}</span>` : ''}${p.bot ? '<span class="badge">бот</span>' : ''}${S.phase === 'vote' && S.vote.voted.includes(p.id) ? '<span class="badge good">голос отдан</span>' : ''}${btn}</span></div>
        <div class="chips">${p.cards.filter((c) => c.revealed).map((c) => `<span class="chip"><span class="dim">${esc(c.label)}:</span> ${esc(c.text)} ${gives(c.gives)}</span>`).join('')}
        ${p.items.filter((i) => i.revealed).map((i) => `<span class="chip">${i.icon} ${esc(i.name)} ${gives(i.gives)}</span>`).join('')}
        <span class="chip dim">скрыто: карт ${hiddenCards}, вещей ${hiddenItems}</span></div></div>`;
    }).join('')}</div>`;
  }
  function gate() {
    const m = me(), inn = m.status === 'in';
    if (S.phase !== 'discuss') giveUid = null;
    app.innerHTML = `
      <div class="row spread"><h3>Раунд ${S.round} · опасность ${dots(S.danger)}</h3>${inn ? '' : `<span class="badge bad">${m.status === 'out' ? 'вы снаружи' : 'вы погибли'}</span>`}</div>
      <div class="panel hot"><h2>${PHASE[S.phase]}</h2>${actionPanel()}</div>
      ${bunkerPanel()}
      ${playersPanel()}
      ${myCards({ reveal: S.phase === 'reveal' && inn && !m.acted, give: S.phase === 'discuss' && inn, items: true })}
      <div class="panel"><h3>Журнал</h3><div class="feed">${S.log.slice().reverse().map((l) => `<div class="${l.kind}">${esc(l.text)}</div>`).join('')}</div></div>`;
  }

  // ---------- исход ----------
  const VERDICT = { all: 'Выжили все', losses: 'Выжили, но не все', dead: 'Не выжил никто' };
  function groupHtml(title, g, baseDelay) {
    const cas = g.casualty && byId(g.casualty);
    return `<div class="panel"><h3>${title}</h3>
      <div class="chron ${epiShown ? 'noanim' : ''}">${g.lines.map((l, i) => `<div style="animation-delay:${baseDelay + i * 0.9}s"><span class="dim">День ${l.day}.</span> ${l.icon} <span style="color:var(--${l.ok ? 'good' : 'bad'})">${esc(l.text)}</span></div>`).join('')}
        <div style="animation-delay:${baseDelay + g.lines.length * 0.9}s"><span class="verdict ${g.outcome}">${VERDICT[g.outcome]}</span>${cas ? `<br>Не дожил до конца: ${esc(cas.name)}.` : ''}</div></div>
      <details style="margin-top:8px"><summary class="dim small">Расчёт</summary><table class="needs"><tr><th>Потребность</th><th>Нужно</th><th>Было</th></tr>
        ${g.rows.map((r) => `<tr><td>${r.icon} ${esc(r.name)}</td><td>${r.req}</td><td class="${r.ok ? 'ok' : 'no'}">${r.have}</td></tr>`).join('')}</table></details></div>`;
  }
  function epilogue() {
    const e = S.epilogue;
    const alive = e.survivors.includes(S.you.id);
    app.innerHTML = `
      <h1>${e.days} дней спустя</h1>
      <p class="verdict ${alive ? 'all' : 'dead'}">${alive ? 'Вы выжили.' : 'Вы не выжили.'}</p>
      ${e.twist ? `<div class="panel hot"><h3>Чего не знал никто</h3><p>${esc(e.twist)}</p></div>` : ''}
      ${groupHtml(`В убежище «${esc(S.bunker.name)}»`, e.bunker, 0.3)}
      ${e.camp ? groupHtml('Лагерь снаружи', e.camp, 0.3 + (e.bunker.lines.length + 1) * 0.9) : ''}
      <div class="panel"><h3>Все карты вскрыты</h3>${S.players.map((p) => `<div class="player"><div class="row spread"><b>${esc(p.name)}</b>
        <span>${e.survivors.includes(p.id) ? '<span class="badge good">выжил</span>' : '<span class="badge bad">погиб</span>'} <span class="badge">${p.status === 'in' ? 'в убежище' : p.status === 'out' ? 'снаружи' : 'вылазка'}</span></span></div>
        <div class="chips">${p.cards.map((c) => `<span class="chip"><span class="dim">${esc(c.label)}:</span> ${esc(c.text)} ${c.key === 'prof' && p.fake ? '<span class="badge bad">не работает</span>' : gives(c.gives)}</span>`).join('')}
        ${p.items.map((i) => `<span class="chip">${i.icon} ${esc(i.name)} ${gives(i.gives)}</span>`).join('')}</div></div>`).join('')}</div>
      ${S.you.host ? '<button class="primary wide" data-act="restart">Сыграть ещё раз тем же составом</button>' : ''}
      <div style="height:8px"></div><button class="wide" data-act="leave">Выйти из комнаты</button>`;
    epiShown = true;
  }

  function render() {
    if (!sess) return home();
    if (!S) { app.innerHTML = '<p class="dim pulse">Подключение…</p>'; return; }
    if (S.phase !== 'epilogue') epiShown = false;
    if (S.phase === 'scramble' && !S.scr.done) { if (!scr) mountScramble(); return; }
    stopScramble();
    if (S.phase === 'lobby') return lobby();
    if (S.phase === 'briefing') return briefing();
    if (S.phase === 'scramble') return scrambleWait();
    if (S.phase === 'epilogue') return epilogue();
    gate();
  }

  // ---------- события интерфейса ----------
  app.addEventListener('click', (ev) => {
    const z = ev.target.closest('[data-zone]');
    if (z) return moveTo(z.dataset.zone);
    const take = ev.target.closest('[data-take]');
    if (take && scr && !scr.sent) {
      const i = scr.items[take.dataset.take];
      if (packSize() + i.size <= scr.v.cap) { scr.pack.push(i.uid); send('pack', { uids: scr.pack }); drawScramble(); }
      return;
    }
    const drop = ev.target.closest('[data-drop]');
    if (drop && scr && !scr.sent) { scr.pack = scr.pack.filter((u) => u !== drop.dataset.drop); send('pack', { uids: scr.pack }); drawScramble(); return; }
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'create': return enter('create');
      case 'join': return enter('join');
      case 'leave': return leave();
      case 'grabBlind': if (scr) scr.sent = true; return send('grabBlind');
      case 'reveal': return send('reveal', { card: d.card, item: d.item });
      case 'radio': return send('radio', { truth: !!d.truth });
      case 'sortieChoose': return send('sortieChoose', { index: +d.index });
      case 'sortieReport': return send('sortieReport', { tell: !!d.tell });
      case 'vote': return send('vote', { target: d.target });
      case 'pickGive': giveUid = giveUid === d.item ? null : d.item; return render();
      case 'give': { const uid = giveUid; giveUid = null; return send('give', { item: uid, to: d.to }); }
      default: return send(d.act);
    }
  });
  app.addEventListener('change', (ev) => { if (ev.target.id === 'diff') send('setDifficulty', { difficulty: ev.target.value }); });
  app.addEventListener('toggle', (ev) => { if (ev.target.id === 'bunker') bunkerOpen = ev.target.open; }, true);
  app.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'code') enter('join'); });

  if (sess) connect();
  render();
})();
