// ===================== ADMIN: ACTIVE DEVICES + ANALYTICS =====================
// Self-contained: this file adds its own "Devices" card (and styles) to the admin page, so it works
// with any admin.html. Needs device-tracker.js loaded before it. Live data = Supabase Presence,
// history = admin-only SQL functions from supabase-setup.sql.
(function () {
  const CSS = "#dev-card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 4px 18px rgba(150,60,0,.12);color:#2b2118}\n#dev-card h2{margin:0 0 14px;font-size:20px}#dev-card h3{margin:16px 0 8px;font-size:16px}\n#dev-card .dv-pill{font-size:13px;background:#ffe3cf;color:#b34a00;padding:2px 10px;border-radius:999px;vertical-align:middle}\n#dev-card .dv-pill.ok{background:#2e9e5b;color:#fff;animation:dvPulse 2s ease-in-out infinite}\n#dev-card .dv-pill.err{background:#d93a3a;color:#fff}\n@keyframes dvPulse{0%{box-shadow:0 0 0 0 rgba(46,158,91,.5)}50%{box-shadow:0 0 0 7px rgba(46,158,91,0)}}\n#dev-card .muted{color:#7a6a5c}#dev-card .small{font-size:13px}\n.dv-hero{display:flex;flex-wrap:wrap;gap:18px 30px;align-items:center;justify-content:space-between;margin:4px 0 18px;padding:18px 20px;border-radius:20px;background:linear-gradient(135deg,#fff1f5,#f4ecff 55%,#e9fbf5);border:1.5px solid #f7d9e3}\n.dv-count-wrap{display:flex;align-items:center;gap:16px}\n.dv-live{position:relative;width:18px;height:18px;flex:0 0 auto}\n.dv-live i{position:absolute;inset:0;border-radius:50%;background:#c9bfb6}\n.dv-live.on i{background:#2e9e5b;animation:dvPing 1.8s ease-out infinite}\n@keyframes dvPing{0%{box-shadow:0 0 0 0 rgba(46,158,91,.6)}70%,100%{box-shadow:0 0 0 14px rgba(46,158,91,0)}}\n.dv-label{font-size:14px;font-weight:700;color:#7a5a66;text-transform:uppercase;letter-spacing:.6px}\n.dv-count{font-size:64px;line-height:1;font-weight:800;background:linear-gradient(135deg,#ff6b81,#a855f7);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}\n.dv-count.bump{animation:dvBump .5s cubic-bezier(.3,1.8,.5,1)}@keyframes dvBump{40%{transform:scale(1.18)}}\n.dv-stats{display:flex;gap:12px;flex-wrap:wrap}\n.dv-stats>div{min-width:104px;padding:10px 14px;text-align:center;background:rgba(255,255,255,.85);border-radius:14px;box-shadow:0 4px 12px rgba(150,60,100,.1)}\n.dv-stats b{display:block;font-size:26px;color:#4a3b34}.dv-stats span{font-size:12px;color:#7a6a5c}\n.dv-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}.dv-bar h3{margin:0}\n.dv-range{display:inline-flex;padding:3px;background:#f6e9df;border-radius:999px}\n.dv-range button{border:0;background:transparent;padding:6px 14px;border-radius:999px;font:inherit;font-size:13px;font-weight:700;color:#7a5a66;cursor:pointer;transition:background .2s,color .2s,transform .15s}\n.dv-range button:hover{transform:scale(1.06)}.dv-range button.on{background:linear-gradient(135deg,#ff8fab,#c084fc);color:#fff}\n.dv-chart{position:relative;min-height:60px;transition:opacity .25s}.dv-chart.loading{opacity:.45}\n.dv-chart svg{width:100%;height:auto;display:block}\n.dv-chart .gl{stroke:#f0dccb;stroke-width:1;stroke-dasharray:4 4}.dv-chart .ax{fill:#8a7468;font-size:11px}\n.dv-chart .bar{transform-box:fill-box;transform-origin:50% 100%;animation:dvUp .6s cubic-bezier(.3,1.4,.5,1) backwards;transition:filter .15s}\n.dv-chart .bar:hover{filter:brightness(1.12) drop-shadow(0 0 6px rgba(192,132,252,.7))}@keyframes dvUp{from{transform:scaleY(0)}}\n.dv-chart .ln{fill:none;stroke:#2e9e5b;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:1400;stroke-dashoffset:1400;animation:dvLn 1.2s .3s ease forwards}@keyframes dvLn{to{stroke-dashoffset:0}}\n.dv-table-wrap{overflow-x:auto;border:1px solid #f0dccb;border-radius:14px}\n#dv-table{width:100%;border-collapse:collapse;font-size:14px}\n#dv-table th{text-align:left;padding:9px 12px;font-size:12px;color:#7a6a5c;background:#fff7f0}\n#dv-table td{padding:9px 12px;border-top:1px solid #f6e6d8;vertical-align:top}\n#dv-table tr.on{background:#f3fff8;animation:dvRow .4s ease}@keyframes dvRow{from{opacity:0;transform:translateX(-10px)}}\n.dv-on,.dv-off{display:inline-block;width:9px;height:9px;margin-right:6px;border-radius:50%}\n.dv-on{background:#2e9e5b;box-shadow:0 0 0 3px rgba(46,158,91,.25)}.dv-off{background:#c9bfb6}\n.dv-badge{font-size:11px;font-weight:600;background:#e7efff;color:#2b55b3;padding:2px 8px;border-radius:999px}.dv-badge.me{background:#ffe9ef;color:#c2415f}\n.dv-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}\n.dv-btn{padding:7px 12px;font-size:13px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#444;cursor:pointer;font-family:inherit;transition:transform .15s}\n.dv-btn:hover{transform:translateY(-2px)}\n#dv-msg{margin:10px 0 0}\n@media(max-width:600px){.dv-count{font-size:52px}.dv-hero{padding:14px}}\n@media(prefers-reduced-motion:reduce){#dev-card *{animation:none!important}.dv-chart .ln{stroke-dashoffset:0}}";
  const HTML = "<h2>\ud83d\udcf1 Devices <span id=\"dv-pill\" class=\"dv-pill\">connecting\u2026</span></h2>\n<div class=\"dv-hero\">\n  <div class=\"dv-count-wrap\"><span id=\"dv-live\" class=\"dv-live\"><i></i></span>\n    <div><div class=\"dv-label\">Active Devices</div><div id=\"dv-count\" class=\"dv-count\">0</div></div></div>\n  <div class=\"dv-stats\">\n    <div><b id=\"dv-peak\">\u2013</b><span id=\"dv-peak-l\">Peak at once</span></div>\n    <div><b id=\"dv-uniq\">\u2013</b><span id=\"dv-uniq-l\">Unique devices</span></div>\n    <div><b id=\"dv-total\">\u2013</b><span>Seen in 24 h</span></div>\n  </div>\n</div>\n<div class=\"dv-bar\"><h3>Activity over time</h3>\n  <div class=\"dv-range\" id=\"dv-range\"><button data-r=\"24h\" class=\"on\">24 h</button><button data-r=\"7d\">7 days</button><button data-r=\"30d\">30 days</button></div></div>\n<div id=\"dv-chart\" class=\"dv-chart\"></div>\n<p id=\"dv-chart-note\" class=\"muted small\"></p>\n<h3>Device list</h3>\n<div class=\"dv-table-wrap\"><table id=\"dv-table\"><thead><tr><th>Device</th><th>Browser / OS</th><th>Status</th><th>Last activity</th></tr></thead><tbody></tbody></table></div>\n<div class=\"dv-actions\"><button id=\"dv-refresh\" class=\"dv-btn\" type=\"button\">\u21bb Refresh</button>\n  <button id=\"dv-clean\" class=\"dv-btn\" type=\"button\">\ud83e\uddf9 Delete data older than 90 days</button></div>\n<p id=\"dv-msg\" class=\"muted small\"></p>";
  const $ = (id) => document.getElementById(id);
  const H = 3600 * 1000, D = 24 * H;
  const RANGES = {
    '24h': { span: D,     step: H, name: 'hour', label: (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric' }) },
    '7d':  { span: 7 * D, step: D, name: 'day',  label: (t) => new Date(t).toLocaleDateString([], { weekday: 'short' }) },
    '30d': { span: 30 * D, step: D, name: 'day', label: (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) }
  };
  const ICON = { mobile: '📱', tablet: '📲', desktop: '💻' };
  let range = '24h', started = false, shown = 0, tween = null, recent = [], histErr = '';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = (ts) => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    return s < 45 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago';
  };
  const cfg = () => (typeof CloudSync !== 'undefined' && CloudSync.getConfig && CloudSync.getConfig()) || window.CLOUD_CONFIG || {};
  const lib = () => cfg().lib;

  function inject() {
    if ($('dev-card')) return;
    const st = document.createElement('style'); st.id = 'dev-css'; st.textContent = CSS; document.head.appendChild(st);
    const sec = document.createElement('section'); sec.id = 'dev-card'; sec.className = 'card'; sec.innerHTML = HTML;
    const host = document.querySelector('main') || document.body;
    const before = $('cloud-card');
    if (before && before.parentNode === host) host.insertBefore(sec, before); else host.appendChild(sec);
  }

  function setCount(n) {
    const el = $('dv-count'); cancelAnimationFrame(tween);
    const from = shown, t0 = performance.now();
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    (function step(now) {
      const p = Math.min(1, (now - t0) / 500), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (n - from) * e);
      if (p < 1) tween = requestAnimationFrame(step); else shown = n;
    })(t0);
  }

  function renderStatus() {
    const pill = $('dv-pill'), ok = DeviceTracker.connected;
    if (!DeviceTracker.configured()) { pill.textContent = 'cloud off'; pill.className = 'dv-pill err'; }
    else if (!DeviceTracker.tracking()) { pill.textContent = 'tracking off'; pill.className = 'dv-pill'; }
    else if (ok) { pill.textContent = '● live'; pill.className = 'dv-pill ok'; }
    else { pill.textContent = 'connecting…'; pill.className = 'dv-pill'; }
    $('dv-live').classList.toggle('on', ok);
    if (!DeviceTracker.configured()) $('dv-msg').textContent = 'Cloud sync is not set up. Fill in cloud-config.js (or the Cloud sync card) first.';
    else if (!DeviceTracker.tracking()) $('dv-msg').textContent = 'Device tracking is turned off (trackDevices: false in cloud-config.js).';
    else if (!ok && DeviceTracker.error) $('dv-msg').textContent = DeviceTracker.error;
    else $('dv-msg').textContent = histErr;
  }

  function renderLive(live) {
    setCount(live.filter((p) => p.role !== 'admin').length);
    renderTable(live);
    renderStatus();
  }

  function renderTable(live) {
    const seen = {}; live.forEach((p) => { seen[p.id] = 1; });
    const rows = live.map((p) => ({ id: p.id, type: p.type, browser: p.browser, os: p.os, role: p.role, on: true, ts: Date.now(), me: p.me }));
    recent.forEach((r) => { if (!seen[r.id]) rows.push({ id: r.id, type: r.type, browser: r.browser, os: r.os, role: r.role, on: false, ts: r.last_seen }); });
    rows.sort((a, b) => (b.on - a.on) || (b.ts - a.ts));
    document.querySelector('#dv-table tbody').innerHTML = rows.length ? rows.slice(0, 60).map((r) =>
      '<tr class="' + (r.on ? 'on' : '') + '"><td>' + (ICON[r.type] || '❔') + ' ' + esc(r.type || 'device') +
      (r.role === 'admin' ? ' <span class="dv-badge">admin</span>' : '') + (r.me ? ' <span class="dv-badge me">this device</span>' : '') +
      '<br><small class="muted">' + esc(String(r.id).slice(-6)) + '</small></td>' +
      '<td>' + esc(r.browser || '–') + ' · ' + esc(r.os || '–') + '</td>' +
      '<td>' + (r.on ? '<span class="dv-on"></span>Online' : '<span class="dv-off"></span>Offline') + '</td>' +
      '<td>' + (r.on ? 'now' : ago(r.ts)) + '</td></tr>').join('')
      : '<tr><td colspan="4" class="muted">No devices yet. Open the photobooth on another device.</td></tr>';
    $('dv-total').textContent = new Set(rows.filter((r) => r.role !== 'admin').map((r) => r.id)).size;
  }

  const rpc = (name, body) => DeviceTracker.rest('rpc/' + name, { method: 'POST', body: JSON.stringify(body) });

  async function loadRecent() {
    try {
      recent = await DeviceTracker.rest('ts_devices?lib=eq.' + encodeURIComponent(lib()) + '&last_seen=gt.' + (Date.now() - D) +
        '&order=last_seen.desc&limit=200&select=id,type,browser,os,role,last_seen') || [];
    } catch (e) { recent = []; }
    renderTable(DeviceTracker.live);
  }

  async function loadChart() {
    const cfgR = RANGES[range], now = Date.now(), since = Math.floor((now - cfgR.span) / cfgR.step) * cfgR.step;
    $('dv-chart').classList.add('loading');
    try {
      const [rows, sum] = await Promise.all([
        rpc('ts_activity_stats', { p_lib: lib(), p_since: since, p_step: cfgR.step }),
        rpc('ts_activity_summary', { p_lib: lib(), p_since: since })
      ]);
      const by = {}; (rows || []).forEach((r) => { by[r.slot] = r; });
      const first = Math.floor(since / cfgR.step), last = Math.floor(now / cfgR.step), bars = [];
      for (let s = first; s <= last; s++) bars.push({ t: s * cfgR.step, peak: (by[s] || {}).peak || 0, uniq: (by[s] || {}).uniq || 0 });
      drawChart(bars, cfgR);
      const s0 = (sum && sum[0]) || { peak: 0, uniq: 0 };
      $('dv-peak').textContent = s0.peak; $('dv-uniq').textContent = s0.uniq;
      $('dv-peak-l').textContent = 'Peak at once (' + range + ')'; $('dv-uniq-l').textContent = 'Unique devices (' + range + ')';
      $('dv-chart-note').textContent = s0.peak ? 'Bars = most devices active at the same time in each ' + cfgR.name + ' (5-minute resolution). Line = different devices.' : 'No activity recorded in this period yet.';
      histErr = '';
    } catch (e) {
      $('dv-chart').innerHTML = '';
      histErr = 'History is unavailable: sign in as admin and run the latest supabase-setup.sql. (' + e.message + ')';
      $('dv-chart-note').textContent = '';
    }
    $('dv-chart').classList.remove('loading');
    renderStatus();
  }

  function drawChart(bars, c) {
    const W = 640, Ht = 230, L = 34, R = 10, T = 14, B = 30, iw = W - L - R, ih = Ht - T - B;
    const max = Math.max(3, ...bars.map((b) => Math.max(b.peak, b.uniq))), nice = Math.ceil(max / 3) * 3;
    const bw = iw / bars.length, gap = Math.min(6, bw * .25), every = Math.ceil(bars.length / 8);
    let g = '', rects = '', pts = [], labels = '';
    for (let i = 0; i <= 3; i++) {
      const y = T + ih - (ih * i) / 3;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="gl"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="ax">' + Math.round((nice * i) / 3) + '</text>';
    }
    bars.forEach((b, i) => {
      const x = L + i * bw + gap / 2, w = Math.max(2, bw - gap), h = (ih * b.peak) / nice;
      rects += '<rect class="bar" style="animation-delay:' + Math.min(i * 18, 600) + 'ms" x="' + x + '" y="' + (T + ih - h) + '" width="' + w + '" height="' + Math.max(h, b.peak ? 2 : 0) +
        '" rx="' + Math.min(6, w / 2) + '" fill="url(#dvg)"><title>' + esc(c.label(b.t)) + ': peak ' + b.peak + ', unique ' + b.uniq + '</title></rect>';
      pts.push((x + w / 2) + ',' + (T + ih - (ih * b.uniq) / nice));
      if (i % every === 0) labels += '<text x="' + (x + w / 2) + '" y="' + (Ht - 10) + '" text-anchor="middle" class="ax">' + esc(c.label(b.t)) + '</text>';
    });
    $('dv-chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + Ht + '" role="img" aria-label="Device activity chart"><defs><linearGradient id="dvg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ff8fab"/><stop offset="1" stop-color="#c084fc"/></linearGradient></defs>' + g + rects + '<polyline class="ln" points="' + pts.join(' ') + '"/>' + labels + '</svg>';
  }

  async function refresh() { renderStatus(); if (DeviceTracker.configured()) await Promise.all([loadRecent(), loadChart()]); }

  function start() {
    if (started) return; started = true;
    inject();
    DeviceTracker.onPresence(renderLive);
    DeviceTracker.onStatus(renderStatus);
    $('dv-range').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      range = b.dataset.r; document.querySelectorAll('#dv-range button').forEach((x) => x.classList.toggle('on', x === b)); loadChart();
    });
    $('dv-refresh').addEventListener('click', refresh);
    $('dv-clean').addEventListener('click', async () => {
      try { await rpc('ts_cleanup', { p_lib: lib(), p_before: Date.now() - 90 * D }); $('dv-msg').textContent = 'Old data deleted.'; refresh(); }
      catch (e) { $('dv-msg').textContent = 'Could not clean up: ' + e.message; }
    });
    refresh();
    setInterval(() => { if (!document.hidden) loadRecent(); }, 30000);
    setInterval(() => { if (!document.hidden) loadChart(); }, 120000);
  }

  // start once the admin is signed in (or at once when the page has no login gate)
  function ready() { return !document.body.classList.contains('locked'); }
  function boot() {
    if (ready()) return start();
    window.addEventListener('admin-unlocked', start, { once: true });
    new MutationObserver((m, o) => { if (ready()) { o.disconnect(); start(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();