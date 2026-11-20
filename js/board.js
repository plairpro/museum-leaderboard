(function () {
  'use strict';
  var M = window.Museum;
  var $ = function (s) { return document.querySelector(s); };

  var ranksEl = $('#ranks'), loadingEl = $('#loading'), emptyEl = $('#empty');
  var viewList = $('#view-list'), viewLab = $('#view-lab');
  var sub = $('#sub'), statusEl = $('#status');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var NOTES = {
    liquid: {
      title: 'Жидкость',
      a: 'В воде молекулы стоят тесно и всё время цепляются друг за друга <mark>водородными связями</mark>. Каждая связь живёт доли секунды: рвётся и тут же появляется с соседом.',
      b: 'Поэтому вода течёт, но держится вместе. Пунктир на экране и есть такая связь: так её рисуют химики.'
    },
    gas: {
      title: 'Газ',
      a: 'В газе молекулы далеко друг от друга и летят по прямой, пока не столкнутся. Энергии так много, что <mark>связь рвётся в момент удара</mark>.',
      b: 'Поэтому газ заполняет весь сосуд. Тяжёлые молекулы летят медленнее лёгких: большой круг здесь значит много баллов.'
    }
  };

  /* ---------- seeded torn edge for the paper note ---------- */
  function tornEdge(seed) {
    var pts = ['0% 0%', '100% 0%'];
    var x = 100, r = seed;
    function rnd() { r = (r * 9301 + 49297) % 233280; return r / 233280; }
    pts.push('100% calc(100% - 10px)');
    while (x > 0) {
      x -= 2 + rnd() * 4;
      pts.push(Math.max(0, x).toFixed(1) + '% calc(100% - ' + (2 + rnd() * 14).toFixed(1) + 'px)');
    }
    pts.push('0% calc(100% - 8px)');
    return 'polygon(' + pts.join(',') + ')';
  }
  $('#note').style.setProperty('--torn', tornEdge(17));

  /* ---------- modes ---------- */
  var mode = 'list';
  var sim = new window.MoleculeSim($('#sim'));
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.modes [role="tab"]'));
  function setMode(m) {
    mode = m;
    tabs.forEach(function (t) {
      var on = t.dataset.mode === m;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    });
    viewList.hidden = m !== 'list';
    viewLab.hidden = m === 'list';
    if (m === 'list') { sim.stop(); }
    else {
      var n = NOTES[m];
      $('#note-title').textContent = n.title;
      $('#note-text').innerHTML = n.a;
      $('#note-text-2').textContent = n.b;
      viewLab.setAttribute('aria-labelledby', 'tab-' + m);
      sim.setMode(m);
      sim.start();
    }
    try { history.replaceState(null, '', m === 'list' ? location.pathname + location.search : '#' + m); } catch (e) {}
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { setMode(t.dataset.mode); });
    t.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      var next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus(); setMode(next.dataset.mode);
    });
  });

  /* ---------- leaderboard rendering with FLIP reorder ---------- */
  var rowEls = {};
  var lastTotals = {};
  var first = true;

  function layoutFor(n) {
    var cols = n <= 10 ? 1 : n <= 20 ? 2 : 3;
    var rows = Math.max(Math.ceil(n / cols), cols === 1 ? Math.max(n, 6) : 10);
    ranksEl.style.setProperty('--cols', cols);
    ranksEl.style.setProperty('--rows', rows);
  }

  function makeRow(r) {
    var li = document.createElement('li');
    li.className = 'rank';
    li.innerHTML = '<span class="rank__pos"></span><span class="rank__disc" aria-hidden="true"></span>' +
      '<span class="rank__code"></span><span class="rank__score"><span class="rank__plus"></span><span class="rank__val"></span></span>';
    li.querySelector('.rank__disc').textContent = r.emoji;
    li.querySelector('.rank__code').textContent = r.code;
    return li;
  }

  function countUp(el, from, to) {
    if (reduce || from === to) { el.textContent = to; return; }
    var t0 = performance.now(), d = 900;
    (function tick(now) {
      var k = Math.min(1, (now - t0) / d);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }

  function render(list) {
    loadingEl.hidden = true;
    var empty = list.length === 0;
    emptyEl.hidden = !empty;
    ranksEl.hidden = empty;
    var scored = list.filter(function (r) { return r.total > 0; }).length;
    sub.textContent = empty ? 'Очки появятся сами, как только кто-то закончит игру на стенде.'
      : 'Участников: ' + list.length + ', с очками: ' + scored + '. Обновляется само.';
    if (empty) { ranksEl.innerHTML = ''; rowEls = {}; return; }

    // FLIP: first
    var before = {};
    Object.keys(rowEls).forEach(function (c) { before[c] = rowEls[c].getBoundingClientRect(); });

    layoutFor(list.length);
    var seen = {};
    list.forEach(function (r) {
      seen[r.code] = 1;
      var li = rowEls[r.code] || (rowEls[r.code] = makeRow(r));
      li.dataset.pos = r.rank;
      li.classList.toggle('is-zero', r.total === 0);
      li.setAttribute('aria-label', r.rank + ' место, ' + r.name + ' ' + r.code + ', ' + r.total + ' баллов');
      li.querySelector('.rank__pos').textContent = r.rank;
      var val = li.querySelector('.rank__val');
      var prev = lastTotals[r.code];
      if (prev === undefined || first) val.textContent = r.total;
      else if (prev !== r.total) {
        countUp(val, prev, r.total);
        var plus = li.querySelector('.rank__plus');
        plus.textContent = '+' + (r.total - prev);
        li.classList.add('is-bumped');
        clearTimeout(li._bump);
        li._bump = setTimeout(function () { li.classList.remove('is-bumped'); }, 3200);
      }
      lastTotals[r.code] = r.total;
      ranksEl.appendChild(li);
    });
    Object.keys(rowEls).forEach(function (c) {
      if (!seen[c]) { rowEls[c].remove(); delete rowEls[c]; delete lastTotals[c]; }
    });

    // FLIP: last, invert, play
    if (!reduce && !first) {
      list.forEach(function (r) {
        var li = rowEls[r.code], b = before[r.code];
        if (!b) return;
        var a = li.getBoundingClientRect();
        var dx = b.left - a.left, dy = b.top - a.top;
        if (!dx && !dy) return;
        li.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
          { duration: 700, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      });
    }
    first = false;
  }

  /* ---------- valence: score quartiles become bond counts ---------- */
  function toMolecules(list) {
    var scored = list.filter(function (r) { return r.total > 0; });
    var max = scored.length ? scored[0].total : 1;
    return list.map(function (r) {
      var v = 1;
      if (r.total > 0) {
        var i = scored.indexOf(r);
        var q = i / scored.length; // 0 — лучший
        v = q < 0.25 ? 4 : q < 0.5 ? 3 : q < 0.75 ? 2 : 1;
      }
      return { code: r.code, emoji: r.emoji, valence: v, weight: r.total / max };
    });
  }

  var ready = false;
  M.subscribe(function () {
    if (!ready && M.status === 'connecting') return;
    ready = true;
    var list = M.standings();
    render(list);
    sim.setPlayers(toMolecules(list));
  });

  M.onStatus(function (s) {
    if (s === 'offline') {
      statusEl.textContent = 'Нет связи с сервером. Показываю последние данные, переподключаюсь сам.';
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
    }
    if (s !== 'connecting' && !ready) { ready = true; var l = M.standings(); render(l); sim.setPlayers(toMolecules(l)); }
  });

  /* ---------- keeper: PIN keypad, reset ---------- */
  var dlg = $('#keeper'), pinBox = $('#keeper-pin'), actions = $('#keeper-actions'), hint = $('#keeper-hint');
  var dots = Array.prototype.slice.call(document.querySelectorAll('#pin-dots i'));
  var pin = '', idle = null, resetArmed = false;

  function paintPin() { dots.forEach(function (d, i) { d.classList.toggle('on', i < pin.length); }); }
  function bumpIdle() { clearTimeout(idle); idle = setTimeout(closeKeeper, 60000); }
  function openKeeper() {
    pin = ''; paintPin(); resetArmed = false; paintReset();
    pinBox.hidden = false; actions.hidden = true;
    hint.textContent = 'Введите PIN-код'; hint.classList.remove('is-error');
    dlg.showModal(); bumpIdle();
  }
  function closeKeeper() { clearTimeout(idle); if (dlg.open) dlg.close(); }
  function unlock() {
    pinBox.hidden = true; actions.hidden = false;
    hint.textContent = 'Доступ открыт'; hint.classList.remove('is-error');
    $('#backend-info').textContent = M.config.backend === 'firebase'
      ? 'Общий сервер Firebase, зал ' + M.config.room + '. Стенды и экраны видят одни и те же очки.'
      : 'Локальный режим: очки видны только в этом браузере на этом компьютере. Для стендов на разных компьютерах подключите Firebase.';
    actions.querySelector('.btn').focus();
  }
  function submitPin() {
    if (M.checkPin(pin)) { unlock(); return; }
    hint.textContent = 'Неверный код'; hint.classList.add('is-error');
    var box = $('#pin-dots');
    box.classList.remove('is-shake'); void box.offsetWidth; box.classList.add('is-shake');
    pin = ''; paintPin();
  }
  $('#keeper-open').addEventListener('click', openKeeper);
  dlg.addEventListener('click', function (e) {
    bumpIdle();
    if (e.target === dlg || e.target.closest('[data-close]')) { closeKeeper(); return; }
    var k = e.target.closest('[data-k]');
    if (!k) return;
    var v = k.dataset.k;
    if (v === 'del') pin = pin.slice(0, -1);
    else if (v === 'ok') { submitPin(); return; }
    else if (pin.length < 4) pin += v;
    paintPin();
    if (pin.length === 4) setTimeout(submitPin, 120);
  });
  dlg.addEventListener('keydown', function (e) {
    if (pinBox.hidden) return;
    if (/^\d$/.test(e.key) && pin.length < 4) { pin += e.key; paintPin(); if (pin.length === 4) setTimeout(submitPin, 120); }
    else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paintPin(); }
  });

  var resetBtn = $('#reset');
  function paintReset() {
    resetBtn.textContent = resetArmed ? 'Точно сбросить? Нажмите ещё раз' : 'Сбросить лидерборд и аватары';
  }
  resetBtn.addEventListener('click', function () {
    if (!resetArmed) { resetArmed = true; paintReset(); setTimeout(function () { resetArmed = false; paintReset(); }, 5000); return; }
    resetBtn.setAttribute('aria-busy', 'true');
    M.reset().then(function () {
      resetBtn.removeAttribute('aria-busy');
      resetArmed = false; paintReset();
      lastTotals = {}; first = true;
      hint.textContent = 'Лидерборд сброшен. Можно звать новую группу.';
    }).catch(function () {
      resetBtn.removeAttribute('aria-busy');
      hint.textContent = 'Не получилось сбросить: нет связи с сервером.'; hint.classList.add('is-error');
    });
  });
  $('#fullscreen').addEventListener('click', function () {
    var d = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen(); else if (d.requestFullscreen) d.requestFullscreen();
    closeKeeper();
  });

  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var start = location.hash.replace('#', '');
  setMode(start === 'liquid' || start === 'gas' ? start : 'list');
})();
