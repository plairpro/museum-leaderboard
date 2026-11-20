/*
 * MoleculeSim — молекулы группы в жидкости и в газе.
 * Каждая молекула — диск с эмодзи. Валентность (1–4) задаётся баллами,
 * размер (масса) — долей от лучшего результата.
 * Жидкость: тесно, вязко, водородные связи (пунктир) живут 1–5 секунд, рвутся и возникают снова.
 * Газ: быстро, упругие столкновения, связь вспыхивает в момент удара и тут же рвётся.
 */
(function () {
  'use strict';
  var TAU = Math.PI * 2;
  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  function token(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function MoleculeSim(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.p = [];          // particles
    this.bonds = [];      // {a, b, age, life, rest, flash}
    this.sparks = [];     // {x, y, age}
    this.mode = 'liquid';
    this.t = 0;
    this.running = false;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.jag = [];
    for (var i = 0; i < 400; i++) this.jag.push((Math.sin(i * 12.9898) * 43758.5453 % 1) * 3);
    var self = this;
    this._loop = function (now) { self.frame(now); };
    if ('ResizeObserver' in window) new ResizeObserver(function () { self.resize(); }).observe(canvas);
    window.addEventListener('resize', function () { self.resize(); });
  }

  var P = MoleculeSim.prototype;

  P.readColors = function () {
    this.col = {
      card: token('--color-card'), edge: token('--color-edge'), ink: token('--color-ink'), ink2: token('--color-ink-2'),
      muted: token('--color-muted'), blue: token('--color-accent-2'), coral: token('--color-accent-3'), mint: token('--color-mint'),
      water: token('--color-water'), waterDeep: token('--color-water-deep'), fringe: token('--color-fringe'), rule: token('--color-rule'),
      font: token('--font-body')
    };
  };

  P.resize = function () {
    var r = this.c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pw = this.w || 800, ph = this.h || 600;
    this.w = r.width; this.h = r.height;
    var sx = this.w / pw, sy = this.h / ph;
    this.p.forEach(function (q) { q.x *= sx; q.y *= sy; });
    this.c.width = Math.round(r.width * this.dpr);
    this.c.height = Math.round(r.height * this.dpr);
    this.p.forEach(function (q) { q.sprite = null; });
    this.layoutRadii();
    if (this.reduce || !this.running) this.draw();
  };

  P.baseR = function () {
    var n = Math.max(this.p.length, 8);
    return Math.max(18, Math.min(Math.min(this.w, this.h) / 11, Math.sqrt(this.w * this.h / n) / 3.4));
  };

  P.layoutRadii = function () {
    var R = this.baseR();
    this.p.forEach(function (q) { q.tr = R * (0.78 + 0.42 * q.weight); if (!q.r) q.r = q.tr; });
  };

  P.surface = function (x) {
    var j = this.jag[Math.floor(x / 6) % this.jag.length] || 0;
    return this.h * 0.17 + 7 * Math.sin(x / 95 + this.t * 1.05) + 4 * Math.sin(x / 41 - this.t * 0.7) + j;
  };

  P.setPlayers = function (list) {
    var byCode = {};
    this.p.forEach(function (q) { byCode[q.code] = q; });
    var next = [];
    var self = this;
    list.forEach(function (m) {
      var q = byCode[m.code];
      if (!q) {
        q = { code: m.code, emoji: m.emoji, x: 0, y: 0, vx: 0, vy: 0, r: 0, tr: 0, weight: m.weight, valence: m.valence, phase: Math.random() * TAU, spin: (Math.random() - 0.5) * 0.6, pulse: 0, sprite: null };
        self.spawn(q);
      } else if (m.weight > q.weight + 0.001 || m.valence !== q.valence) {
        q.pulse = 1;
      }
      q.weight = m.weight; q.valence = m.valence;
      next.push(q);
    });
    this.p = next;
    var alive = {};
    next.forEach(function (q) { alive[q.code] = q; });
    this.bonds = this.bonds.filter(function (b) { return alive[b.a.code] === b.a && alive[b.b.code] === b.b; });
    this.layoutRadii();
    this.trimBonds();
    if (this.reduce) this.settle();
    else if (!this.running) this.draw();
  };

  P.spawn = function (q) {
    var w = this.w || 800, h = this.h || 600;
    q.x = w * (0.1 + Math.random() * 0.8);
    q.y = this.mode === 'liquid' ? h * (0.35 + Math.random() * 0.55) : h * (0.1 + Math.random() * 0.8);
    var a = Math.random() * TAU;
    q.vx = Math.cos(a) * 60; q.vy = Math.sin(a) * 60;
  };

  P.trimBonds = function () {
    var used = new Map();
    this.bonds = this.bonds.filter(function (b) {
      var ua = used.get(b.a) || 0, ub = used.get(b.b) || 0;
      if (ua >= b.a.valence || ub >= b.b.valence) return false;
      used.set(b.a, ua + 1); used.set(b.b, ub + 1);
      return true;
    });
  };

  P.bondCount = function (q) {
    var n = 0;
    for (var i = 0; i < this.bonds.length; i++) if (this.bonds[i].a === q || this.bonds[i].b === q) n++;
    return n;
  };

  P.setMode = function (m) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'gas') {
      this.bonds = [];
      var S = Math.min(this.w, this.h) * 0.5;
      this.p.forEach(function (q) { var a = Math.random() * TAU; q.vx += Math.cos(a) * S; q.vy += Math.sin(a) * S - S * 0.4; });
    } else {
      this.bonds = this.bonds.filter(function (b) { return !b.flash; });
    }
    if (this.reduce) this.settle();
  };

  P.start = function () {
    this.readColors();
    this.resize();
    if (this.reduce) { this.settle(); return; }
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._loop);
  };
  P.stop = function () { this.running = false; };

  P.settle = function () {
    if (!this.w) return;
    for (var i = 0; i < 360; i++) this.step(1 / 60);
    this.draw();
  };

  P.frame = function (now) {
    if (!this.running) return;
    var dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) { requestAnimationFrame(this._loop); return; }
    var n = 2;
    for (var i = 0; i < n; i++) this.step(dt / n);
    this.draw();
    requestAnimationFrame(this._loop);
  };

  P.step = function (dt) {
    var self = this, w = this.w, h = this.h, P_ = this.p, liquid = this.mode === 'liquid';
    this.t += dt;
    var R = this.baseR();
    var i, j, q, o;

    // radii ease toward target
    for (i = 0; i < P_.length; i++) {
      q = P_[i];
      q.r += (q.tr - q.r) * Math.min(1, dt * 3);
      q.phase += q.spin * dt;
      if (q.pulse > 0) q.pulse = Math.max(0, q.pulse - dt * 0.6);
    }

    // forces
    for (i = 0; i < P_.length; i++) {
      q = P_[i];
      if (liquid) {
        var top = this.surface(q.x) + q.r + 4;
        if (q.y < top) { q.vy += 900 * dt; q.vx *= Math.exp(-2 * dt); }   // конденсация: падает в воду
        q.vy += 14 * dt;                                                     // почти нейтральная плавучесть
        q.vx += 34 * Math.sin(q.y / 130 + this.t * 0.31) * dt;              // течение
        q.vy += 22 * Math.cos(q.x / 210 - this.t * 0.23) * dt;
        q.vx += (w / 2 - q.x) / w * 30 * dt;                                 // мягко держим посередине сосуда
        q.vx += (Math.random() - 0.5) * 420 * dt;                            // броуновское движение
        q.vy += (Math.random() - 0.5) * 420 * dt;
        var damp = Math.exp(-1.7 * dt);
        q.vx *= damp; q.vy *= damp;
      } else {
        var m = (q.r * q.r) / (R * R);
        var vT = Math.min(w, h) * 0.34 / Math.sqrt(m);                      // тяжёлые медленнее: v ~ 1/√m
        var sp = Math.hypot(q.vx, q.vy) || 1;
        var k = 1 + ((vT - sp) / sp) * Math.min(1, dt * 0.9);
        q.vx *= k; q.vy *= k;
      }
    }

    // pairwise: cohesion, bonding, collisions
    for (i = 0; i < P_.length; i++) {
      q = P_[i];
      for (j = i + 1; j < P_.length; j++) {
        o = P_[j];
        var dx = o.x - q.x, dy = o.y - q.y;
        var d = Math.hypot(dx, dy) || 0.001;
        var nx = dx / d, ny = dy / d;
        var rs = q.r + o.r;
        var mq = q.r * q.r, mo = o.r * o.r;

        if (liquid && d < rs * 2.2 && d > rs * 1.05) {
          // слабое притяжение соседей — жидкость держится вместе
          var f = 4 * (1 - (d - rs) / (rs * 1.2));
          q.vx += nx * f * dt; q.vy += ny * f * dt;
          o.vx -= nx * f * dt; o.vy -= ny * f * dt;
        }

        if (liquid && d < rs * 1.55 && Math.random() < 1.3 * dt && !this.bonded(q, o) &&
            this.bondCount(q) < q.valence && this.bondCount(o) < o.valence) {
          this.bonds.push({ a: q, b: o, age: 0, life: 1.4 + Math.random() * 3.8, rest: rs * 1.32, flash: false });
        }

        if (d < rs) {
          var overlap = rs - d;
          var tq = mo / (mq + mo), to = mq / (mq + mo);
          q.x -= nx * overlap * tq; q.y -= ny * overlap * tq;
          o.x += nx * overlap * to; o.y += ny * overlap * to;
          var rv = (o.vx - q.vx) * nx + (o.vy - q.vy) * ny;
          if (rv < 0) {
            var e = liquid ? 0.15 : 1;
            var imp = -(1 + e) * rv / (1 / mq + 1 / mo);
            q.vx -= imp * nx / mq; q.vy -= imp * ny / mq;
            o.vx += imp * nx / mo; o.vy += imp * ny / mo;
            if (!liquid && -rv > 40) {
              this.sparks.push({ x: q.x + nx * q.r, y: q.y + ny * q.r, age: 0 });
              if (Math.random() < 0.75 && this.bondCount(q) < q.valence && this.bondCount(o) < o.valence)
                this.bonds.push({ a: q, b: o, age: 0, life: 0.5, rest: rs, flash: true });
            }
          }
        }
      }
    }

    // bonds: springs (liquid) and ageing
    this.bonds = this.bonds.filter(function (b) {
      b.age += dt;
      if (b.age > b.life) return false;
      if (b.flash) return true;
      var dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, d = Math.hypot(dx, dy) || 0.001;
      if (d > b.rest * 1.9) return false;
      var f = 30 * (d - b.rest) / d;
      b.a.vx += dx * f * dt * 0.5; b.a.vy += dy * f * dt * 0.5;
      b.b.vx -= dx * f * dt * 0.5; b.b.vy -= dy * f * dt * 0.5;
      return true;
    });

    // integrate and walls
    for (i = 0; i < P_.length; i++) {
      q = P_[i];
      q.x += q.vx * dt; q.y += q.vy * dt;
      var e2 = liquid ? 0.3 : 1;
      if (q.x < q.r) { q.x = q.r; q.vx = Math.abs(q.vx) * e2; }
      if (q.x > w - q.r) { q.x = w - q.r; q.vx = -Math.abs(q.vx) * e2; }
      if (q.y > h - q.r) { q.y = h - q.r; q.vy = -Math.abs(q.vy) * e2; }
      if (!liquid && q.y < q.r) { q.y = q.r; q.vy = Math.abs(q.vy); }
    }

    this.sparks = this.sparks.filter(function (s) { s.age += dt; return s.age < 0.5; });
  };

  P.bonded = function (a, b) {
    for (var i = 0; i < this.bonds.length; i++) {
      var x = this.bonds[i];
      if ((x.a === a && x.b === b) || (x.a === b && x.b === a)) return true;
    }
    return false;
  };

  P.sprite = function (q) {
    var r = Math.round(q.r);
    if (q.sprite && q.spriteR === r) return q.sprite;
    var pad = Math.ceil(r * 0.35) + 6, s = (r + pad) * 2, dpr = this.dpr;
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(s * dpr); cv.height = Math.ceil(s * dpr);
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    var cx = r + pad, cy = r + pad;
    // paper disc lit from the top left
    g.save();
    g.shadowColor = 'rgba(20, 24, 34, 0.2)';
    g.shadowBlur = r * 0.35; g.shadowOffsetX = r * 0.07; g.shadowOffsetY = r * 0.14;
    g.fillStyle = this.col.card;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    g.restore();
    g.lineWidth = Math.max(1.5, r * 0.05);
    g.strokeStyle = this.col.edge;
    g.beginPath(); g.arc(cx, cy, r - g.lineWidth / 2, 0, TAU); g.stroke();
    g.font = Math.round(r * 1.08) + 'px ' + EMOJI_FONT;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(q.emoji, cx, cy + r * 0.06);
    q.sprite = cv; q.spriteR = r; q.spritePad = pad;
    return cv;
  };

  P.draw = function () {
    var g = this.ctx, dpr = this.dpr, w = this.w, h = this.h, col = this.col;
    if (!w || !col) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var liquid = this.mode === 'liquid';
    var i, x;

    if (liquid) {
      var grad = g.createLinearGradient(0, h * 0.15, 0, h);
      grad.addColorStop(0, col.water); grad.addColorStop(1, col.waterDeep);
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(0, h);
      for (x = 0; x <= w + 8; x += 8) g.lineTo(x, this.surface(x));
      g.lineTo(w, h); g.closePath(); g.fill();
      // torn fringe of the water sheet
      g.strokeStyle = col.fringe; g.lineWidth = 3;
      g.beginPath();
      for (x = 0; x <= w + 8; x += 8) { var y = this.surface(x) - 1.5; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }

    if (!this.p.length) {
      g.fillStyle = col.muted;
      g.font = '700 ' + Math.round(Math.max(18, h * 0.035)) + 'px ' + col.font;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Здесь появятся молекулы группы', w / 2, h * 0.55);
      return;
    }

    // bonds
    g.lineCap = 'round';
    for (i = 0; i < this.bonds.length; i++) {
      var b = this.bonds[i];
      var dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, d = Math.hypot(dx, dy) || 1;
      var ux = dx / d, uy = dy / d;
      var fadeIn = Math.min(1, b.age / 0.25), fadeOut = Math.min(1, (b.life - b.age) / 0.3);
      g.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut));
      if (b.flash) { g.setLineDash([]); g.strokeStyle = col.coral; g.lineWidth = 5; }
      else { g.setLineDash([7, 8]); g.strokeStyle = col.ink2; g.lineWidth = 3.5; }
      g.beginPath();
      g.moveTo(b.a.x + ux * b.a.r * 0.92, b.a.y + uy * b.a.r * 0.92);
      g.lineTo(b.b.x - ux * b.b.r * 0.92, b.b.y - uy * b.b.r * 0.92);
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;

    // sparks (gas collisions)
    for (i = 0; i < this.sparks.length; i++) {
      var s = this.sparks[i], k = s.age / 0.5;
      g.globalAlpha = 1 - k;
      g.strokeStyle = col.coral; g.lineWidth = 2.5;
      g.beginPath(); g.arc(s.x, s.y, 4 + k * 16, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;

    // molecules
    for (i = 0; i < this.p.length; i++) {
      var q = this.p[i];
      var sp = this.sprite(q), size = (q.spriteR + q.spritePad) * 2;
      if (q.pulse > 0) {
        g.globalAlpha = q.pulse;
        g.strokeStyle = col.mint; g.lineWidth = 8;
        g.beginPath(); g.arc(q.x, q.y, q.r + 8 + (1 - q.pulse) * 22, 0, TAU); g.stroke();
        g.globalAlpha = 1;
      }
      g.drawImage(sp, q.x - size / 2, q.y - size / 2, size, size);
      // valence sites: filled ink when used by a bond, blue when free
      var angles = [];
      for (var bi = 0; bi < this.bonds.length; bi++) {
        var bb = this.bonds[bi];
        if (bb.a === q) angles.push(Math.atan2(bb.b.y - q.y, bb.b.x - q.x));
        else if (bb.b === q) angles.push(Math.atan2(bb.a.y - q.y, bb.a.x - q.x));
      }
      var used = Math.min(angles.length, q.valence);
      var dot = Math.max(4, q.r * 0.11);
      for (var v = 0; v < q.valence; v++) {
        var a = v < used ? angles[v] : q.phase + v * TAU / q.valence;
        var px = q.x + Math.cos(a) * (q.r + dot * 0.2), py = q.y + Math.sin(a) * (q.r + dot * 0.2);
        g.fillStyle = v < used ? col.ink : col.blue;
        g.beginPath(); g.arc(px, py, dot, 0, TAU); g.fill();
        g.strokeStyle = col.card; g.lineWidth = 2; g.stroke();
      }
    }
  };

  window.MoleculeSim = MoleculeSim;
})();
