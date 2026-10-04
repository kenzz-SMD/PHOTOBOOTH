// ===================== ADMIN FX LAYER =====================
// Extra life for the admin dashboard. Add as the LAST script in admin.html:
//     <script src="admin-fx.js"></script>
// Needs nothing else. If DeviceTracker / CloudSync exist it also shows "device joined" and
// "synced" toasts. All of it respects the ✨ switch (same setting as the booth) and "reduce motion".
(function () {
  'use strict';
  const root = document.documentElement;
  const KEY = 'ts-fx';
  const $ = (s, r) => (r || document).querySelector(s);
  const mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) {}
  const calm = () => !on || !!(mq && mq.matches);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- tiny confetti engine ----------
  const COLORS = ['#ff6b81', '#ff9a56', '#ffd166', '#3fd6a0', '#4cc9f0', '#b983ff', '#ff8fab'];
  let cv = null, cx = null, parts = [], raf = 0, prev = 0, W = 0, H = 0;
  function sizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function burst(x, y, n, spread) {
    if (calm()) return;
    if (!cv) {
      cv = document.createElement('canvas'); cv.id = 'afx-canvas'; cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv); cx = cv.getContext('2d'); sizeCanvas();
    }
    for (let i = 0; i < n; i++) {
      const a = (-90 + rnd(-(spread || 70), spread || 70)) * Math.PI / 180, sp = rnd(220, 620);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(0, 6), vr: rnd(-10, 10), w: rnd(6, 11), h: rnd(8, 14),
        c: COLORS[(Math.random() * COLORS.length) | 0], t: 0, life: rnd(1.3, 2.1), flip: rnd(6, 14), round: Math.random() < 0.25 });
    }
    if (!raf) { prev = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function frame(ts) {
    const dt = Math.min(0.05, (ts - prev) / 1000); prev = ts;
    cx.clearRect(0, 0, W, H);
    parts = parts.filter((p) => {
      p.t += dt; p.vy += 900 * dt; p.vx *= 1 - 1.2 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      if (p.t > p.life || p.y > H + 20) return false;
      cx.save(); cx.globalAlpha = Math.min(1, (p.life - p.t) / 0.5); cx.translate(p.x, p.y); cx.rotate(p.r);
      cx.scale(1, Math.cos(p.t * p.flip)); cx.fillStyle = p.c;
      if (p.round) { cx.beginPath(); cx.arc(0, 0, p.w / 2, 0, 7); cx.fill(); } else cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cx.restore();
      return true;
    });
    if (parts.length) raf = requestAnimationFrame(frame);
    else { raf = 0; if (cv) { cv.remove(); cv = cx = null; } }
  }
  window.addEventListener('resize', () => { if (cv) sizeCanvas(); });

  // ---------- toasts ----------
  let toasts = null;
  function toast(icon, title, sub, opts) {
    opts = opts || {};
    if (!toasts) { toasts = document.createElement('div'); toasts.className = 'afx-toasts'; toasts.setAttribute('aria-live', 'polite'); document.body.appendChild(toasts); }
    while (toasts.children.length >= 4) toasts.firstChild.remove();
    const dur = opts.dur || 4500;
    const el = document.createElement('div');
    el.className = 'afx-toast' + (opts.warn ? ' warn' : '');
    el.style.setProperty('--dur', dur + 'ms');
    el.innerHTML = '<span class="t-ico">' + icon + '</span><div><b>' + esc(title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
    toasts.appendChild(el);
    const bye = () => { el.classList.add('out'); setTimeout(() => el.remove(), 380); };
    const t = setTimeout(bye, dur);
    el.addEventListener('click', () => { clearTimeout(t); bye(); });
    if (opts.confetti) {
      const r = el.getBoundingClientRect();
      burst(r.left + 40, r.top + 10, 30, 55);
    }
  }

  // ---------- ✨ switch ----------
  function paintToggle() {
    root.classList.toggle('fx-off', !on);
    const b = $('#afx-toggle');
    if (!b) return;
    b.textContent = on ? '✨' : '💤';
    b.title = on ? 'Animations on (click to turn off)' : 'Animations off (click to turn on)';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function buildToggle() {
    const b = document.createElement('button');
    b.id = 'afx-toggle'; b.type = 'button';
    b.addEventListener('click', () => {
      on = !on;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
      paintToggle();
      if (on) burst(60, innerHeight - 40, 22, 40);
    });
    document.body.appendChild(b);
    paintToggle();
  }

  // ---------- count-up when a number changes ----------
  function watchCount(el) {
    const parse = (t) => { const m = /^(\D*)(\d+)(.*)$/s.exec(t || ''); return m ? +m[2] : null; };
    const opts = { childList: true, characterData: true, subtree: true };
    let prevN = parse(el.textContent), last = null, raf2 = 0;
    const mo = new MutationObserver(() => {
      const txt = el.textContent;
      if (txt === last) return;
      const m = /^(\D*)(\d+)(.*)$/s.exec(txt);
      cancelAnimationFrame(raf2);
      if (!m) { prevN = null; last = null; return; }
      const to = +m[2];
      if (prevN == null || calm() || prevN === to) { prevN = to; last = null; return; }
      const from = prevN; prevN = to;
      el.classList.remove('afx-bump'); void el.offsetWidth; el.classList.add('afx-bump');
      mo.disconnect();                                   // don't react to our own writes
      const t0 = performance.now(), dur = 650; last = txt;
      (function step(now) {
        if (el.textContent !== last) { prevN = parse(el.textContent); last = null; mo.observe(el, opts); return; }   // the app wrote a new value: let it win
        const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        last = m[1] + Math.round(from + (to - from) * e) + m[3];
        el.textContent = last;
        if (p < 1) raf2 = requestAnimationFrame(step); else { last = null; mo.observe(el, opts); }
      })(t0);
    });
    mo.observe(el, opts);
  }
  function watchWhenReady(id, tries) {
    const el = document.getElementById(id);
    if (el) return watchCount(el);
    if ((tries || 0) < 40) setTimeout(() => watchWhenReady(id, (tries || 0) + 1), 500);
  }

  // ---------- pointer effects: card spotlight + template tilt ----------
  let pending = null, ticking = false;
  function onMove(e) {
    if (calm() || e.pointerType === 'touch') return;
    pending = e;
    if (!ticking) { ticking = true; requestAnimationFrame(applyMove); }
  }
  function applyMove() {
    ticking = false;
    const e = pending; if (!e) return;
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const card = t.closest('main > .card');
    if (card) {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }
    const tc = t.closest('.tcard');
    if (tc) {
      const r = tc.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      tc.style.setProperty('--ry', ((px - 0.5) * 12).toFixed(2) + 'deg');
      tc.style.setProperty('--rx', ((0.5 - py) * 10).toFixed(2) + 'deg');
      tc.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      tc.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
    }
  }
  document.addEventListener('pointerout', (e) => {          // settle a tilted template card when the pointer leaves
    const tc = e.target.closest && e.target.closest('.tcard');
    if (tc && !tc.contains(e.relatedTarget)) { tc.style.removeProperty('--rx'); tc.style.removeProperty('--ry'); }
  });

  // ---------- scroll progress ----------
  function buildProgress() {
    const bar = document.createElement('div'); bar.className = 'afx-progress'; bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    let q = false;
    const upd = () => {
      q = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty('--p', max > 8 ? Math.min(1, scrollY / max).toFixed(4) : 0);
    };
    addEventListener('scroll', () => { if (!q) { q = true; requestAnimationFrame(upd); } }, { passive: true });
    addEventListener('resize', upd);
    upd();
  }

  // ---------- header: greeting + camera flash ----------
  function greet() {
    const h1 = $('.top h1');
    if (!h1 || $('.afx-hello', h1)) return;
    const hr = new Date().getHours();
    const part = hr < 5 ? ['Still up', '🌙'] : hr < 12 ? ['Good morning', '☀️'] : hr < 18 ? ['Good afternoon', '🌤️'] : ['Good evening', '🌙'];
    let who = '';
    try { who = (typeof CloudSync !== 'undefined' && CloudSync.adminEmail) ? CloudSync.adminEmail.split('@')[0] : ''; } catch (e) {}
    const em = document.createElement('em');
    em.className = 'afx-hello';
    em.innerHTML = esc(part[0] + (who ? ', ' + who : '')) + ' <i>' + part[1] + '</i>';
    h1.appendChild(em);
    h1.title = 'Say cheese! 📸';
    h1.addEventListener('click', () => {
      if (calm()) return;
      const f = document.createElement('div'); f.className = 'afx-flash'; document.body.appendChild(f);
      setTimeout(() => f.remove(), 600);
      const r = h1.getBoundingClientRect();
      burst(r.left + 120, r.top + r.height, 46, 80);
    });
  }

  // ---------- live toasts: devices + cloud ----------
  const ICON = { mobile: '📱', tablet: '📲', desktop: '💻' };
  function watchDevices() {
    if (typeof DeviceTracker === 'undefined' || !DeviceTracker.onPresence) return;
    let baseline = null, armedAt = 0;
    DeviceTracker.onStatus(() => {
      if (DeviceTracker.connected) { baseline = null; armedAt = Date.now() + 2500; }   // ignore the initial roll-call
    });
    DeviceTracker.onPresence((list) => {
      if (!DeviceTracker.connected) return;
      const guests = list.filter((p) => p.role !== 'admin' && !p.me);
      const cur = {}; guests.forEach((p) => { cur[p.id] = p; });
      if (baseline === null || Date.now() < armedAt) { baseline = cur; return; }
      Object.keys(cur).forEach((id) => {
        if (!baseline[id]) { const p = cur[id]; toast(ICON[p.type] || '📱', 'New device joined', (p.browser || '') + (p.os ? ' · ' + p.os : ''), { confetti: true }); }
      });
      Object.keys(baseline).forEach((id) => {
        if (!cur[id]) { const p = baseline[id]; toast('👋', 'A device left', (ICON[p.type] || '') + ' ' + (p.browser || ''), { dur: 3200 }); }
      });
      baseline = cur;
    });
  }
  function watchCloud() {
    if (typeof CloudSync === 'undefined' || !CloudSync.onStatus) return;
    let lastState = '', lastToast = 0;
    CloudSync.onStatus((s) => {
      const st = s && s.state, now = Date.now();
      if (st === lastState) return;
      const was = lastState; lastState = st;
      if (st === 'ok' && (was === 'syncing' || was === 'error') && now - lastToast > 20000) {
        lastToast = now; toast('☁️', 'All synced', 'Templates are up to date on every device', { dur: 3000 });
      } else if (st === 'error' && now - lastToast > 30000) {
        lastToast = now; toast('⚠️', 'Cloud sync problem', (s.msg || 'Check the Cloud sync card').slice(0, 90), { warn: true, dur: 6500 });
      }
    });
  }

  // ---------- boot ----------
  let started = false;
  function start() {
    if (started) return; started = true;
    greet();
    ['count', 'cat-count', 'dv-peak', 'dv-uniq', 'dv-total'].forEach((id) => watchWhenReady(id));
    watchDevices();
    watchCloud();
  }
  function init() {
    const aur = document.createElement('div'); aur.className = 'afx-aurora'; aur.setAttribute('aria-hidden', 'true');
    aur.innerHTML = '<i></i><i></i><i></i><i></i>';
    document.body.insertBefore(aur, document.body.firstChild);
    buildProgress();
    buildToggle();
    document.addEventListener('pointermove', onMove, { passive: true });
    if (mq && mq.addEventListener) mq.addEventListener('change', paintToggle);
    const ready = () => !document.body.classList.contains('locked');
    if (ready()) start();
    else new MutationObserver((m, o) => { if (ready()) { o.disconnect(); start(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.AdminFX = { toast, burst };
})();