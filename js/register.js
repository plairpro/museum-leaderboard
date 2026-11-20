(function () {
  'use strict';
  var M = window.Museum;
  var zoo = document.getElementById('zoo');
  var count = document.getElementById('count');
  var statusEl = document.getElementById('status');
  var asking = null, askTimer = null;
  var buttons = {};

  M.avatars.forEach(function (a) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.dataset.code = a.code;
    b.innerHTML = '<span class="e" aria-hidden="true">' + a.emoji + '</span><span class="c">' + a.code + '</span><span class="t"></span>';
    li.appendChild(b);
    zoo.appendChild(li);
    buttons[a.code] = b;
  });

  function render() {
    var s = M.state;
    var totals = {};
    M.standings().forEach(function (r) { totals[r.code] = r.total; });
    var n = 0;
    M.avatars.forEach(function (a) {
      var b = buttons[a.code];
      var taken = !!s.claims[a.code];
      if (taken) n++;
      b.setAttribute('aria-pressed', taken);
      b.classList.toggle('is-asking', asking === a.code);
      var t = b.querySelector('.t');
      if (asking === a.code) t.textContent = 'Освободить? Ещё раз';
      else if (taken && totals[a.code] > 0) t.textContent = 'Баллы: ' + totals[a.code];
      else t.textContent = taken ? 'Занят' : '';
      b.setAttribute('aria-label', a.name + ' ' + a.code + (taken ? ', занят' : ', свободен'));
    });
    count.textContent = 'Занято ' + n + ' из ' + M.avatars.length;
  }

  zoo.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-code]');
    if (!b) return;
    var code = b.dataset.code;
    var taken = !!M.state.claims[code];
    if (!taken) {
      asking = null;
      M.claim(code).catch(fail);
      return;
    }
    var hasPoints = M.standings().some(function (r) { return r.code === code && r.total > 0; });
    if (hasPoints) { flash('У этого зверя уже есть баллы. Освободить его можно только сбросом лидерборда.'); return; }
    if (asking === code) {
      asking = null; clearTimeout(askTimer);
      M.release(code).catch(fail);
    } else {
      asking = code; render();
      clearTimeout(askTimer);
      askTimer = setTimeout(function () { asking = null; render(); }, 3500);
    }
  });

  function flash(msg) {
    statusEl.textContent = msg; statusEl.hidden = false;
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { statusEl.hidden = true; }, 3500);
  }
  function fail() { flash('Нет связи с сервером. Попробуйте ещё раз.'); }

  M.subscribe(render);
  M.onStatus(function (s) { if (s === 'offline') flash('Нет связи с сервером. Переподключаюсь.'); });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
})();
