// ===================== ADMIN: ACTIVE DEVICES + ANALYTICS =====================
// Live counter and device list come from Supabase Realtime Presence (instant).
// History (peak, unique devices, graph) comes from the activity table via admin-only SQL functions.
(function () {
  const $ = (id) => document.getElementById(id);
  const H = 3600 * 1000, D = 24 * H;
  const RANGES = {                      // how far back, and the size of one bar
    '24h': { span: D,      step: H,     label: (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric' }),                  name: 'hour' },
    '7d':  { span: 7 * D,  step: D,     label: (t) => new Date(t).toLocaleDateString([], { weekday: 'short' }),                 name: 'day' },
    '30d': { span: 30 * D, step: D,     label: (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }),   name: 'day' }
  };
  let range = '24h', started = false, shown = 0, tween = null;
  const ICON = { mobile: '📱', tablet: '📲', desktop: '💻' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }

  // ---- animated counter ----
  function setCount(n) {
    const el = $('dev-count');
    cancelAnimationFrame(tween);
    const from = shown, t0 = performance.now();
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    (function step(now) {
      const p = Math.min(1, (now - t0) / 500), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (n - from) * e);
      if (p < 1) tween = requestAnimationFrame(step); else shown = n;
    })(t0);
  }

  // ---- live part (Presence) ----
  let recent = [];                       // devices seen in the last 24 h (from the database)
  function renderLive(list) {
    const guests = list.filter((p) => p.role !== 'admin');
    setCount(guests.length);
    $('dev-pill').textContent = CloudSync.status.live ? '● live' : 'connecting…';
    $('dev-pill').className = 'pill' + (CloudSync.status.live ? ' ok' : '');
    renderTable(list);
  }
  function renderTable(live) {
    const online = {};
    live.forEach((p) => { online[p.id] = p; });
    const rows = [];
    live.forEach((p) => rows.push({ id: p.id, type: p.type, browser: p.browser, os: p.os, role: p.role, on: true, ts: Date.now(), me: p.me, tabs: p.tabs }));
    recent.forEach((r) => { if (!online[r.id]) rows.push({ id: r.id, type: r.type, browser: r.browser, os: r.os, role: r.role, on: false, ts: r.last_seen }); });
    rows.sort((a, b) => (b.on - a.on) || (b.ts - a.ts));
    const body = document.querySelector('#dev-table tbody');
    body.innerHTML = rows.length ? rows.slice(0, 60).map((r) =>
      '<tr class="' + (r.on ? 'on' : '') + '"><td>' + (ICON[r.type] || '❔') + ' ' + esc(r.type || 'device') +
      (r.role === 'admin' ? ' <span class="badge">admin</span>' : '') + (r.me ? ' <span class="badge me">this device</span>' : '') +
      '<br><small class="muted">' + esc(String(r.id).slice(-6)) + '</small></td>' +
      '<td>' + esc(r.browser || '–') + ' · ' + esc(r.os || '–') + '</td>' +
      '<td>' + (r.on ? '<span class="dot-on"></span>Online' : '<span class="dot-off"></span>Offline') + '</td>' +
      '<td>' + (r.on ? 'now' : ago(r.ts)) + '</td></tr>').join('')
      : '<tr><td colspan="4" class="muted">No devices yet.</td></tr>';
    $('dev-total').textContent = new Set(rows.filter((r) => r.role !== 'admin').map((r) => r.id)).size;
  }

  // ---- history part (SQL functions) ----
  function lib() { return (CloudSync.getConfig() || {}).lib; }
  async function rpc(name, body) {
    return CloudSync.rest('rpc/' + name, { method: 'POST', body: JSON.stringify(body) });
  }

  async function loadRecent() {
    try {
      recent = await CloudSync.rest('ts_devices?lib=eq.' + encodeURIComponent(lib()) + '&last_seen=gt.' + (Date.now() - D) +
        '&order=last_seen.desc&limit=200&select=id,type,browser,os,role,last_seen') || [];
    } catch (e) { recent = []; }
    renderTable(CloudSync.live);
  }

  async function loadChart() {
    const cfg = RANGES[range], now = Date.now();
    const since = Math.floor((now - cfg.span) / cfg.step) * cfg.step;
    $('dev-chart').classList.add('loading');
    try {
      const [rows, sum] = await Promise.all([
        rpc('ts_activity_stats', { p_lib: lib(), p_since: since, p_step: cfg.step }),
        rpc('ts_activity_summary', { p_lib: lib(), p_since: since })
      ]);
      const bySlot = {};
      (rows || []).forEach((r) => { bySlot[r.slot] = r; });
      const first = Math.floor(since / cfg.step), last = Math.floor(now / cfg.step);
      const bars = [];
      for (let s = first; s <= last; s++) bars.push({ t: s * cfg.step, peak: (bySlot[s] || {}).peak || 0, uniq: (bySlot[s] || {}).uniq || 0 });
      drawChart(bars, cfg);
      const s0 = (sum && sum[0]) || { peak: 0, uniq: 0 };
      $('dev-peak').textContent = s0.peak;
      $('dev-uniq').textContent = s0.uniq;
      $('dev-peak-l').textContent = 'Peak at once (' + range + ')';
      $('dev-uniq-l').textContent = 'Unique devices (' + range + ')';
      $('dev-chart-note').textContent = s0.peak ? 'Bars = most devices active at the same time in each ' + cfg.name + ' (5-minute resolution). Line = different devices.' : 'No activity recorded in this period yet.';
    } catch (e) {
      $('dev-chart').innerHTML = '';
      $('dev-chart-note').textContent = 'Could not load analytics. Run the latest supabase-setup.sql, then refresh. (' + e.message + ')';
    }
    $('dev-chart').classList.remove('loading');
  }

  function drawChart(bars, cfg) {
    const W = 640, Ht = 230, L = 34, R = 10, T = 14, B = 30, iw = W - L - R, ih = Ht - T - B;
    const max = Math.max(3, ...bars.map((b) => Math.max(b.peak, b.uniq)));
    const nice = Math.ceil(max / 3) * 3;
    const bw = iw / bars.length, gap = Math.min(6, bw * .25);
    let g = '';
    for (let i = 0; i <= 3; i++) {
      const y = T + ih - (ih * i) / 3;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="gl"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="ax">' + Math.round((nice * i) / 3) + '</text>';
    }
    const every = Math.ceil(bars.length / 8);
    let rects = '', pts = [], labels = '';
    bars.forEach((b, i) => {
      const x = L + i * bw + gap / 2, w = Math.max(2, bw - gap), h = (ih * b.peak) / nice;
      rects += '<rect class="bar" style="animation-delay:' + Math.min(i * 18, 600) + 'ms" x="' + x + '" y="' + (T + ih - h) + '" width="' + w + '" height="' + Math.max(h, b.peak ? 2 : 0) + '" rx="' + Math.min(6, w / 2) +
        '" fill="url(#bg)"><title>' + esc(cfg.label(b.t)) + ': peak ' + b.peak + ', unique ' + b.uniq + '</title></rect>';
      pts.push((x + w / 2) + ',' + (T + ih - (ih * b.uniq) / nice));
      if (i % every === 0) labels += '<text x="' + (x + w / 2) + '" y="' + (Ht - 10) + '" text-anchor="middle" class="ax">' + esc(cfg.label(b.t)) + '</text>';
    });
    $('dev-chart').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + Ht + '" role="img" aria-label="Device activity chart"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ff8fab"/><stop offset="1" stop-color="#c084fc"/></linearGradient></defs>' +
      g + rects + '<polyline class="ln" points="' + pts.join(' ') + '"/>' + labels + '</svg>';
  }

  async function refresh() {
    if (!CloudSync.enabled()) { $('dev-msg').textContent = 'Cloud sync is off, so devices cannot be tracked.'; return; }
    $('dev-msg').textContent = '';
    await Promise.all([loadRecent(), loadChart()]);
  }

  function start() {
    if (started) return; started = true;
    CloudSync.onPresence(renderLive);
    CloudSync.onStatus(() => renderLive(CloudSync.live));
    refresh();
    setInterval(() => { if (!document.hidden) { loadRecent(); } }, 30000);
    setInterval(() => { if (!document.hidden) loadChart(); }, 120000);
    // tidy up old data once a day
    try {
      const k = 'ts-last-clean';
      if (Date.now() - (Number(localStorage.getItem(k)) || 0) > D) {
        rpc('ts_cleanup', { p_lib: lib(), p_before: Date.now() - 90 * D }).then(() => localStorage.setItem(k, String(Date.now()))).catch(() => {});
      }
    } catch (e) {}
  }

  $('dev-range').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    range = b.dataset.r;
    document.querySelectorAll('#dev-range button').forEach((x) => x.classList.toggle('on', x === b));
    loadChart();
  });
  $('dev-refresh').addEventListener('click', refresh);
  $('dev-clean').addEventListener('click', async () => {
    try {
      await rpc('ts_cleanup', { p_lib: lib(), p_before: Date.now() - 90 * D });
      $('dev-msg').textContent = 'Old data deleted.';
      refresh();
    } catch (e) { $('dev-msg').textContent = 'Could not clean up: ' + e.message; }
  });

  window.addEventListener('admin-unlocked', start);
  if (!document.body.classList.contains('locked')) start();
})();