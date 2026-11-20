(function () {
  'use strict';
  var M = window.Museum;
  var $ = function (s) { return document.getElementById(s); };
  var avatar = null, points = 0, playing = false;

  var picker = M.mountPicker($('picker'), {
    label: 'Кто играет? Найди своего зверя',
    onChange: function (code) { avatar = code; $('start').disabled = !code || playing; }
  });

  function show(id, on) { $(id).hidden = !on; }
  function flash(msg) {
    var s = $('status'); s.textContent = msg; s.hidden = false;
    clearTimeout(flash._t); flash._t = setTimeout(function () { s.hidden = true; }, 3500);
  }

  $('start').addEventListener('click', function () {
    if (!avatar) return;
    playing = true; points = 0;
    var a = M.avatar(avatar);
    $('play-title').textContent = 'Играет ' + a.emoji + ' ' + a.code;
    $('score').textContent = '0';
    show('score', true); show('gain', true); show('finish', true);
    $('start').disabled = true;
  });

  $('gain').addEventListener('click', function (e) {
    var b = e.target.closest('[data-p]');
    if (!b) return;
    points += b.dataset.p === 'rnd' ? Math.round(Math.random() * 20) * 10 : Number(b.dataset.p);
    $('score').textContent = points;
  });

  $('finish').addEventListener('click', function () {
    var btn = $('finish');
    btn.setAttribute('aria-busy', 'true');
    M.submit({ avatar: avatar, points: points, game: $('game').value }).then(function () {
      btn.removeAttribute('aria-busy');
      var a = M.avatar(avatar);
      $('play-title').textContent = a.emoji + ' ' + a.code + ' получает ' + points + '. Следующий!';
      show('gain', false); show('finish', false);
      playing = false; picker.value = null; avatar = null;
      $('start').disabled = true;
    }).catch(function () {
      btn.removeAttribute('aria-busy');
      flash('Не удалось отправить: нет связи с сервером. Нажмите ещё раз.');
    });
  });
})();
