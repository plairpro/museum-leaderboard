/*
 * Museum SDK — общее ядро лидерборда научного музея.
 * Подключается и экранами лидерборда, и стендовыми играми:
 *   <script src="https://plairpro.github.io/museum-leaderboard/sdk/museum-sdk.js"></script>
 *
 * API для игры:
 *   Museum.mountPicker(el, { onChange(code), layout: 'wrap'|'row', label }) — выбор аватара (только занятые группой)
 *   Museum.submit({ avatar, points, game })       — отправить результат прохождения
 *   Museum.subscribe(state => …)                  — живое состояние (занятые аватары, результаты)
 *   Museum.standings()                            — таблица мест
 */
(function () {
  'use strict';

  /* ---------- настройки ---------- */
  var DEFAULTS = {
    // Адрес Firebase Realtime Database. Пусто — локальный режим (всё в одном браузере/компьютере).
    firebaseUrl: '',
    // Зал/комната: у каждого зала свой лидерборд.
    room: 'hall-1',
    // 'best' — в каждой игре засчитывается лучший результат, по играм суммируется (переигрывание не накручивает очки)
    // 'sum'  — суммируются все прохождения
    scoring: 'best',
    // Хэш PIN-кода смотрителя (по умолчанию 1957). Сменить: Museum.hashPin('новый') в консоли → вставить сюда.
    pinHash: 'd4e75a33'
  };

  var AVATARS = [
    { code: 'СБК', emoji: '🐶', name: 'Собака' },
    { code: 'КШК', emoji: '🐱', name: 'Кошка' },
    { code: 'ПНД', emoji: '🐼', name: 'Панда' },
    { code: 'ТГР', emoji: '🐯', name: 'Тигр' },
    { code: 'ЛИС', emoji: '🦊', name: 'Лиса' },
    { code: 'МДВ', emoji: '🐻', name: 'Медведь' },
    { code: 'КЛА', emoji: '🐨', name: 'Коала' },
    { code: 'ЛЕВ', emoji: '🦁', name: 'Лев' },
    { code: 'ЛГШ', emoji: '🐸', name: 'Лягушка' },
    { code: 'ОБЗ', emoji: '🐵', name: 'Обезьяна' },
    { code: 'СВН', emoji: '🐷', name: 'Свинка' },
    { code: 'ЗЯЦ', emoji: '🐰', name: 'Заяц' },
    { code: 'КРВ', emoji: '🐮', name: 'Корова' },
    { code: 'ЕДН', emoji: '🦄', name: 'Единорог' },
    { code: 'ОСМ', emoji: '🐙', name: 'Осьминог' },
    { code: 'СВА', emoji: '🦉', name: 'Сова' },
    { code: 'ПНГ', emoji: '🐧', name: 'Пингвин' },
    { code: 'ЧРП', emoji: '🐢', name: 'Черепаха' },
    { code: 'ББЧ', emoji: '🦋', name: 'Бабочка' },
    { code: 'ПЧЛ', emoji: '🐝', name: 'Пчела' },
    { code: 'ДНЗ', emoji: '🦖', name: 'Динозавр' },
    { code: 'КИТ', emoji: '🐳', name: 'Кит' },
    { code: 'АКЛ', emoji: '🦈', name: 'Акула' },
    { code: 'ДЛФ', emoji: '🐬', name: 'Дельфин' },
    { code: 'ЖРФ', emoji: '🦒', name: 'Жираф' },
    { code: 'СЛН', emoji: '🐘', name: 'Слон' },
    { code: 'ЗБР', emoji: '🦓', name: 'Зебра' },
    { code: 'ЁЖК', emoji: '🦔', name: 'Ёжик' },
    { code: 'БЛК', emoji: '🐿️', name: 'Белка' },
    { code: 'ППГ', emoji: '🦜', name: 'Попугай' }
  ];
  var BY_CODE = {};
  AVATARS.forEach(function (a, i) { a.index = i; BY_CODE[a.code] = a; });

  /* ---------- конфигурация: код → window.MUSEUM_CONFIG → ?room= / ?db= ---------- */
  var cfg = Object.assign({}, DEFAULTS, window.MUSEUM_CONFIG || {});
  try {
    var q = new URLSearchParams(location.search);
    // ?db=<url> запоминается в браузере стенда: один раз открыть ссылку — и стенд подключён.
    if (q.has('db')) {
      var db = q.get('db').trim();
      if (db) localStorage.setItem('museum:db', db); else localStorage.removeItem('museum:db');
    }
    if (q.has('room')) localStorage.setItem('museum:room', q.get('room').trim() || DEFAULTS.room);
    cfg.firebaseUrl = localStorage.getItem('museum:db') || cfg.firebaseUrl;
    cfg.room = localStorage.getItem('museum:room') || cfg.room;
  } catch (e) { /* приватный режим: работаем с настройками по умолчанию */ }
  cfg.backend = cfg.firebaseUrl ? 'firebase' : 'local';

  /* ---------- утилиты ---------- */
  function hashPin(pin) {
    var h = 0x811c9dc5;
    var s = 'museum:' + String(pin);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function fresh() { return { session: { id: uid(), started: Date.now() }, claims: {}, plays: {} }; }
  function normalize(s) {
    s = s && typeof s === 'object' ? s : {};
    s.session = s.session || { id: 'none', started: 0 };
    s.claims = s.claims || {};
    s.plays = s.plays || {};
    return s;
  }

  /* ---------- слушатели ---------- */
  var listeners = [];
  var statusListeners = [];
  var state = normalize(null);
  var status = 'connecting';
  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } }); }
  function setStatus(s) {
    if (s === status) return;
    status = s;
    statusListeners.forEach(function (fn) { try { fn(status); } catch (e) { console.error(e); } });
  }

  /* ---------- локальный адаптер: localStorage + BroadcastChannel ---------- */
  function LocalStore() {
    var key = 'museum:state:' + cfg.room;
    var bc = 'BroadcastChannel' in window ? new BroadcastChannel(key) : null;
    function read() { try { return normalize(JSON.parse(localStorage.getItem(key))); } catch (e) { return normalize(null); } }
    function write(s) {
      try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) { console.warn('museum: не удалось сохранить', e); }
      state = s; emit();
      if (bc) bc.postMessage('u');
    }
    function pull() { state = read(); emit(); }
    if (bc) bc.onmessage = pull;
    window.addEventListener('storage', function (e) { if (e.key === key) pull(); });
    return {
      connect: function () {
        var s = read();
        if (!localStorage.getItem(key)) { s = fresh(); try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) {} }
        state = s; setStatus('local'); emit();
      },
      claim: function (code) { var s = read(); s.claims[code] = Date.now(); write(s); return Promise.resolve(); },
      release: function (code) { var s = read(); delete s.claims[code]; write(s); return Promise.resolve(); },
      addPlay: function (p) { var s = read(); p.t = Date.now(); s.plays[uid()] = p; write(s); return Promise.resolve(); },
      reset: function () { write(fresh()); return Promise.resolve(); }
    };
  }

  /* ---------- Firebase Realtime Database через REST + EventSource (без SDK) ---------- */
  function FirebaseStore() {
    var base = cfg.firebaseUrl.replace(/\/+$/, '') + '/museum/' + encodeURIComponent(cfg.room);
    var es = null;
    function setAt(path, data) {
      var parts = path.split('/').filter(Boolean);
      if (!parts.length) { state = normalize(data); return; }
      var node = state;
      for (var i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
        node = node[parts[i]];
      }
      var last = parts[parts.length - 1];
      if (data === null) delete node[last]; else node[last] = data;
      normalize(state);
    }
    function req(path, method, body) {
      return fetch(base + path + '.json', {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) throw new Error('Firebase ' + r.status);
        return r.json();
      });
    }
    var TS = { '.sv': 'timestamp' };
    return {
      connect: function () {
        if (es) es.close();
        es = new EventSource(base + '.json');
                es.onerror = function () { setStatus('offline'); };
        es.addEventListener('put', function (e) {
          var m = JSON.parse(e.data); setAt(m.path, m.data); setStatus('online'); emit();
        });
        es.addEventListener('patch', function (e) {
          var m = JSON.parse(e.data);
          Object.keys(m.data || {}).forEach(function (k) { setAt(m.path.replace(/\/$/, '') + '/' + k, m.data[k]); });
          emit();
        });
        es.addEventListener('cancel', function () { setStatus('offline'); });
        // Если комнаты ещё нет — создаём сессию.
        req('/session', 'GET').then(function (s) {
          if (!s) return req('/session', 'PUT', { id: uid(), started: TS });
        }).catch(function () { setStatus('offline'); });
      },
      claim: function (code) { return req('/claims/' + encodeURIComponent(code), 'PUT', TS); },
      release: function (code) { return req('/claims/' + encodeURIComponent(code), 'DELETE'); },
      addPlay: function (p) { p.t = TS; return req('/plays', 'POST', p); },
      reset: function () { return req('', 'PUT', { session: { id: uid(), started: TS } }); }
    };
  }

  var store = cfg.backend === 'firebase' ? FirebaseStore() : LocalStore();
  var connected = false;
  function ensure() { if (!connected) { connected = true; store.connect(); } }

  /* ---------- подсчёт мест ---------- */
  function standings(s) {
    s = s || state;
    var sid = s.session && s.session.id;
    var rows = {};
    function row(code) {
      if (!rows[code]) {
        var a = BY_CODE[code] || { code: code, emoji: '❔', name: code, index: 99 };
        rows[code] = { code: code, emoji: a.emoji, name: a.name, index: a.index, claimed: s.claims[code] || 0, games: {}, total: 0, plays: 0, last: 0 };
      }
      return rows[code];
    }
    Object.keys(s.claims).forEach(row);
    Object.keys(s.plays).forEach(function (id) {
      var p = s.plays[id];
      if (!p || !p.a) return;
      if (p.s && sid && p.s !== sid) return; // результат прошлой группы
      var r = row(p.a);
      var pts = Math.max(0, Math.round(Number(p.p) || 0));
      var g = p.g || 'game';
      r.games[g] = cfg.scoring === 'sum' ? (r.games[g] || 0) + pts : Math.max(r.games[g] || 0, pts);
      r.plays++;
      r.last = Math.max(r.last, Number(p.t) || 0);
    });
    var list = Object.keys(rows).map(function (k) {
      var r = rows[k];
      r.total = Object.keys(r.games).reduce(function (sum, g) { return sum + r.games[g]; }, 0);
      return r;
    });
    list.sort(function (a, b) {
      return b.total - a.total || (a.last || Infinity) - (b.last || Infinity) || (a.claimed || 0) - (b.claimed || 0) || a.index - b.index;
    });
    var rank = 0, prev = null;
    list.forEach(function (r, i) {
      if (r.total !== prev) { rank = i + 1; prev = r.total; }
      r.rank = rank;
    });
    return list;
  }

  /* ---------- виджет выбора аватара для игр ---------- */
  var PICKER_CSS = [
    ':host{--p-paper:oklch(97% 0.012 95);--p-card:oklch(98.8% 0.007 95);--p-ink:oklch(20% 0.014 255);--p-muted:oklch(47% 0.014 255);',
    '--p-edge:oklch(83% 0.04 88);--p-rule:oklch(87% 0.016 95);--p-accent:oklch(87% 0.175 96);--p-accent-deep:oklch(72% 0.16 92);--p-focus:oklch(50% 0.17 250);',
    '--p-font:"Nunito",ui-rounded,system-ui,sans-serif;display:block;font-family:var(--p-font);color:var(--p-ink)}',
    '.wrap{display:flex;flex-direction:column;gap:10px}',
    '.label{font-size:18px;font-weight:600;color:var(--p-muted);margin:0}',
    '.row{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 12px;scroll-snap-type:x proximity;overscroll-behavior-x:contain}',
    '.row.wrap-on{flex-wrap:wrap;overflow:visible}',
    'button{flex:0 0 auto;scroll-snap-align:start;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:88px;min-height:96px;padding:8px 10px;',
    'border:0;border-radius:16px;background:var(--p-card);color:var(--p-ink);font:800 20px/1 var(--p-font);cursor:pointer;touch-action:manipulation;',
    'box-shadow:inset 0 0 0 1px var(--p-rule),0 5px 0 0 var(--p-edge);transition:translate 120ms cubic-bezier(.22,1,.36,1),box-shadow 120ms cubic-bezier(.22,1,.36,1),background-color 120ms linear}',
    'button .e{font-size:40px;line-height:1.1}',
    'button:hover{translate:0 -2px;box-shadow:inset 0 0 0 1px var(--p-rule),0 7px 0 0 var(--p-edge)}',
    'button:active{translate:0 4px;box-shadow:inset 0 0 0 1px var(--p-rule),0 1px 0 0 var(--p-edge)}',
    'button:focus-visible{outline:3px solid var(--p-focus);outline-offset:3px}',
    'button[aria-pressed="true"]{background:var(--p-accent);box-shadow:0 5px 0 0 var(--p-accent-deep)}',
    '.empty{margin:0;font-size:18px;color:var(--p-muted)}',
    '@media (prefers-reduced-motion:reduce){button{transition:none}}'
  ].join('');

  function mountPicker(el, opts) {
    opts = opts || {};
    ensure();
    var root = el.shadowRoot || el.attachShadow({ mode: 'open' });
    var value = opts.value || null;
    root.innerHTML = '<style>' + PICKER_CSS + '</style><div class="wrap"><p class="label">' +
      (opts.label || 'Выбери своего зверя') + '</p><div class="row" role="group"></div></div>';
    var rowEl = root.querySelector('.row');
    if (opts.layout !== 'row') rowEl.classList.add('wrap-on');
    rowEl.setAttribute('aria-label', opts.label || 'Выбери своего зверя');
    function render() {
      var claimed = Object.keys(state.claims).filter(function (c) { return BY_CODE[c]; })
        .sort(function (a, b) { return BY_CODE[a].index - BY_CODE[b].index; });
      if (value && claimed.indexOf(value) < 0) { value = null; if (opts.onChange) opts.onChange(null); }
      if (!claimed.length) {
        rowEl.innerHTML = '<p class="empty">Группа ещё не выбрала аватаров. Их выбирают на экране рейтинга.</p>';
        return;
      }
      rowEl.innerHTML = claimed.map(function (c) {
        var a = BY_CODE[c];
        return '<button type="button" data-code="' + c + '" aria-pressed="' + (c === value) + '" aria-label="' + a.name + ' ' + c + '">' +
          '<span class="e" aria-hidden="true">' + a.emoji + '</span><span>' + c + '</span></button>';
      }).join('');
    }
    rowEl.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-code]');
      if (!b) return;
      value = b.dataset.code;
      render();
      if (opts.onChange) opts.onChange(value);
    });
    var off = subscribe(render);
    return {
      get value() { return value; },
      set value(v) { value = v; render(); },
      destroy: function () { off(); root.innerHTML = ''; }
    };
  }

  function subscribe(fn) {
    ensure();
    listeners.push(fn);
    try { fn(state); } catch (e) { console.error(e); }
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  window.Museum = {
    config: cfg,
    avatars: AVATARS,
    avatar: function (code) { return BY_CODE[code] || null; },
    get state() { return state; },
    get status() { return status; },
    subscribe: subscribe,
    onStatus: function (fn) { statusListeners.push(fn); fn(status); },
    standings: standings,
    claim: function (code) { ensure(); return store.claim(code); },
    release: function (code) { ensure(); return store.release(code); },
    /** Отправить результат: { avatar: 'СБК', points: 120, game: 'magnets' } */
    submit: function (r) {
      ensure();
      if (!r || !BY_CODE[r.avatar]) return Promise.reject(new Error('Museum.submit: неизвестный аватар ' + (r && r.avatar)));
      return store.addPlay({ a: r.avatar, g: String(r.game || 'game').slice(0, 40), p: Math.max(0, Math.round(Number(r.points) || 0)), s: state.session.id });
    },
    reset: function () { ensure(); return store.reset(); },
    checkPin: function (pin) { return hashPin(pin) === cfg.pinHash; },
    hashPin: hashPin,
    mountPicker: mountPicker
  };
})();
