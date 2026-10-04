// ===================== ADMIN: TABS + OVERVIEW DASHBOARD =====================
// Organises the admin page into four tabs (Overview, Templates, Categories, Cloud) and adds an
// Overview with live stat tiles + quick actions. Pure layout: it only re-uses the elements that
// admin.js / admin-devices.js already create, so nothing else needs to change.
// Load AFTER admin.js and admin-devices.js:   <script src="admin-tabs.js"></script>
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const TABS = [
    { id: 'overview',   icon: '📊', label: 'Overview' },
    { id: 'templates',  icon: '🖼️', label: 'Templates',  badge: '#count' },
    { id: 'categories', icon: '🗂️', label: 'Categories', badge: '#cat-count' },
    { id: 'cloud',      icon: '☁️', label: 'Cloud' }
  ];
  let current = 'overview', started = false;

  // ---- which tab each card belongs to (found by what is inside it) ----
  function tagCards() {
    const main = $('main'); if (!main) return;
    $$(':scope > .card', main).forEach((c) => {
      if (c.dataset.tab) return;
      if (c.id === 'dev-card') c.dataset.tab = 'overview';
      else if (c.id === 'cloud-card') c.dataset.tab = 'cloud';
      else if ($('#cat-list', c)) c.dataset.tab = 'categories';
      else if ($('#dropzone', c) || $('#grid', c)) c.dataset.tab = 'templates';
      else c.dataset.tab = 'overview';
    });
  }

  // ---- nav bar ----
  function buildNav() {
    if ($('#admin-nav')) return;
    const nav = document.createElement('nav');
    nav.id = 'admin-nav'; nav.className = 'admin-nav'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Admin sections');
    nav.innerHTML = '<div class="an-track"><span class="an-ind"></span>' + TABS.map((t) =>
      '<button type="button" role="tab" class="an-tab" data-tab="' + t.id + '" aria-selected="false">' +
      '<i aria-hidden="true">' + t.icon + '</i><span>' + t.label + '</span>' + (t.badge ? '<b class="an-badge" data-from="' + t.badge + '"></b>' : '') + '</button>').join('') + '</div>';
    const top = $('.top'); (top && top.parentNode ? top.parentNode : document.body).insertBefore(nav, top ? top.nextSibling : document.body.firstChild);
    nav.addEventListener('click', (e) => { const b = e.target.closest('.an-tab'); if (b) show(b.dataset.tab, true); });
    nav.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = TABS.findIndex((t) => t.id === current), n = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      show(TABS[n].id, true); $('.an-tab[data-tab="' + TABS[n].id + '"]').focus();
    });
    window.addEventListener('resize', moveInd);
  }
  function moveInd() {
    const b = $('.an-tab.on'), ind = $('.an-ind'); if (!b || !ind) return;
    ind.style.width = b.offsetWidth + 'px'; ind.style.transform = 'translateX(' + b.offsetLeft + 'px)';
    if (b.scrollIntoView) { const tr = $('.an-track'); if (tr && tr.scrollWidth > tr.clientWidth) tr.scrollTo({ left: b.offsetLeft - 20, behavior: 'smooth' }); }
  }
  function show(id, push) {
    if (!TABS.some((t) => t.id === id)) id = 'overview';
    current = id;
    document.body.dataset.tab = id;
    $$('.an-tab').forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    moveInd();
    if (push) { try { history.replaceState(null, '', '#' + id); } catch (e) {} window.scrollTo({ top: 0, behavior: 'smooth' }); }
    const main = $('main');
    if (main) { main.classList.remove('tab-in'); void main.offsetWidth; main.classList.add('tab-in'); }
  }

  // ---- Overview: stat tiles + quick actions ----
  const TILES = [
    { id: 'st-templates', icon: '🖼️', label: 'Templates',      from: '#count',      go: 'templates',  tone: 'peach' },
    { id: 'st-cats',      icon: '🗂️', label: 'Categories',     from: '#cat-count',  go: 'categories', tone: 'lilac' },
    { id: 'st-devices',   icon: '📱', label: 'Active devices', from: '#dv-count',   go: 'overview',   tone: 'mint', live: true },
    { id: 'st-cloud',     icon: '☁️', label: 'Cloud sync',     from: '#cloud-pill', go: 'cloud',      tone: 'sky', text: true }
  ];
  function buildHero() {
    if ($('#ov-hero')) return;
    const main = $('main'); if (!main) return;
    const hero = document.createElement('section');
    hero.id = 'ov-hero'; hero.className = 'ov-hero'; hero.dataset.tab = 'overview';
    hero.innerHTML =
      '<div class="ov-title"><h2>Welcome back <span class="ov-wave">👋</span></h2><p id="ov-date" class="muted"></p></div>' +
      '<div class="ov-tiles">' + TILES.map((t, i) =>
        '<button type="button" class="ov-tile tone-' + t.tone + '" data-go="' + t.go + '" style="--i:' + i + '">' +
        '<span class="ov-ico">' + t.icon + (t.live ? '<u class="ov-live"></u>' : '') + '</span>' +
        '<span class="ov-val" id="' + t.id + '">–</span><span class="ov-lab">' + t.label + '</span></button>').join('') + '</div>' +
      '<div class="ov-actions">' +
        '<button type="button" class="ov-chip" data-act="upload">⬆️ Upload templates</button>' +
        '<button type="button" class="ov-chip" data-act="category">➕ New category</button>' +
        '<button type="button" class="ov-chip" data-act="sync">🔄 Sync now</button>' +
        '<a class="ov-chip" href="index.html">📸 Open photobooth</a>' +
      '</div>';
    main.insertBefore(hero, main.firstChild);
    hero.addEventListener('click', (e) => {
      const tile = e.target.closest('.ov-tile'); if (tile) return show(tile.dataset.go, true);
      const chip = e.target.closest('[data-act]'); if (!chip) return;
      const a = chip.dataset.act;
      if (a === 'upload')   { show('templates', true); setTimeout(() => { const d = $('#dropzone'); if (d) { d.scrollIntoView({ behavior: 'smooth', block: 'center' }); d.focus({ preventScroll: true }); d.classList.add('over'); setTimeout(() => d.classList.remove('over'), 900); } }, 350); }
      if (a === 'category') { show('categories', true); setTimeout(() => { const i = $('#cat-new-name'); if (i) i.focus(); }, 350); }
      if (a === 'sync')     { const b = $('#cloud-now'); if (b) b.click(); }
    });
    const d = new Date();
    $('#ov-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + ' · here is how your booth is doing';
  }

  // ---- keep tiles + tab badges in sync with the real elements ----
  const shown = {};
  function tween(el, to) {
    const key = el.id, from = shown[key] == null ? 0 : shown[key];
    if (from === to) { el.textContent = to; return; }
    const t0 = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - t0) / 600), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step); else shown[key] = to;
    })(t0);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  function refresh() {
    TILES.forEach((t) => {
      const src = $(t.from), out = $('#' + t.id); if (!src || !out) return;
      const txt = (src.textContent || '').trim();
      if (t.text) {
        const low = txt.toLowerCase(), tile = out.closest('.ov-tile');
        out.textContent = txt || 'off';
        tile.dataset.state = /live|synced|ok/.test(low) ? 'good' : /error/.test(low) ? 'bad' : /^off$|cloud off/.test(low) ? 'off' : 'wait';
      } else {
        const n = parseInt(txt, 10);
        if (!isNaN(n)) { if (out.dataset.v !== String(n)) { out.dataset.v = n; tween(out, n); } }
        else if (!out.dataset.v) out.textContent = '–';
      }
    });
    $$('.an-badge').forEach((b) => { const s = $(b.dataset.from); const v = s ? s.textContent.trim() : ''; b.textContent = v; b.style.display = v ? '' : 'none'; });
  }

  function start() {
    if (started) return; started = true;
    buildNav(); buildHero(); tagCards(); refresh();
    const main = $('main');
    if (main) new MutationObserver(() => { tagCards(); }).observe(main, { childList: true });
    setInterval(refresh, 800);
    window.addEventListener('hashchange', () => show((location.hash || '').slice(1)));
    show((location.hash || '').slice(1) || 'overview');
    setTimeout(moveInd, 300);
  }
  const ready = () => !document.body.classList.contains('locked');
  function boot() {
    if (ready()) return start();
    window.addEventListener('admin-unlocked', start, { once: true });
    new MutationObserver((m, o) => { if (ready()) { o.disconnect(); start(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();