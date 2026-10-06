// ===================== DEVICE TRACKER (stand-alone) =====================
// Load on EVERY page (booth + admin) after cloud-config.js and templates-store.js:
//   <script src="device-tracer.js"></script>
// Each device announces itself with Supabase Realtime Presence (so admins see a live counter)
// and logs activity to the database (so admins get history + graphs).
// Stores only: a random id, device type, browser, OS and timestamps. Needs nothing else from the app.
const DeviceTracker = (() => {
  const SESS_KEY = 'ts-cloud-session', DEV_KEY = 'ts-device-id', BUCKET_MS = 5 * 60 * 1000;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let deviceId = lsGet(DEV_KEY, null);
  if (!deviceId) { deviceId = 'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); lsSet(DEV_KEY, deviceId); }

  function cfg() {
    let c = null;
    try { if (typeof CloudSync !== 'undefined' && CloudSync.getConfig) c = CloudSync.getConfig(); } catch (e) {}
    if (!c) { const d = window.CLOUD_CONFIG; if (d && d.url && d.key && d.lib) c = Object.assign({ enabled: true }, d); }
    return c;
  }
  const configured = () => { const c = cfg(); return !!(c && c.enabled !== false && c.url && c.key && c.lib); };
  const tracking = () => configured() && (cfg().trackDevices !== false);
  const base = () => cfg().url.replace(/\/+$/, '');
  const sess = () => { const s = lsGet(SESS_KEY, null); return s && s.access_token ? s : null; };
  const validSess = () => { const s = sess(); return s && s.expires_at - 15000 > Date.now() ? s : null; };
  const bearer = () => { const s = validSess(); return s ? s.access_token : (/^sb_/.test(cfg().key) ? null : cfg().key); };
  const headers = (extra) => {
    const c = cfg(), b = bearer();
    return Object.assign(b ? { apikey: c.key, Authorization: 'Bearer ' + b } : { apikey: c.key }, extra || {});
  };

  function info() {
    const ua = navigator.userAgent || '', touch = (navigator.maxTouchPoints || 0) > 1;
    let type = 'desktop';
    if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && touch) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) type = 'tablet';
    else if (/Mobi|iPhone|iPod|Android/i.test(ua)) type = 'mobile';
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /SamsungBrowser/.test(ua) ? 'Samsung' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
    return { type, browser, os };
  }

  // ---- live presence ----
  const presence = {}, cbs = [], statusCbs = [];
  let connectedAt = 0;
  let ws = null, beat = null, pingT = null, retryT = null, retry = 0, ref = 0, connected = false, lastError = '', trackedRole = '';
  const roleNow = () => (validSess() ? 'admin' : 'guest');

  const list = () => Object.keys(presence).filter((k) => presence[k].length).map((k) => {
    const m = presence[k][0];
    return { id: k, type: m.type, browser: m.browser, os: m.os, role: m.role, since: m.since, tabs: presence[k].length, me: k === deviceId };
  }).sort((a, b) => (a.since || 0) - (b.since || 0));
  const emit = () => { const l = list(); cbs.forEach((cb) => { try { cb(l); } catch (e) {} }); };
  const emitStatus = () => statusCbs.forEach((cb) => { try { cb({ connected, error: lastError }); } catch (e) {} });
  const metas = (v) => (v && v.metas) || [];

  function clearAll() { Object.keys(presence).forEach((k) => delete presence[k]); }

  async function ping() {
    if (!tracking() || !navigator.onLine || document.hidden) return;
    const c = cfg(), i = info(), now = Date.now();
    try {
      await fetch(base() + '/rest/v1/ts_devices?on_conflict=lib,id', {
        method: 'POST', headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ lib: c.lib, id: deviceId, type: i.type, browser: i.browser, os: i.os, role: validSess() ? 'admin' : 'guest', last_seen: now })
      });
      await fetch(base() + '/rest/v1/ts_device_activity?on_conflict=lib,id,bucket', {
        method: 'POST', headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }),
        body: JSON.stringify({ lib: c.lib, id: deviceId, bucket: Math.floor(now / BUCKET_MS) })
      });
    } catch (e) { /* never disturb the booth */ }
  }

  function disconnect() {
    clearTimeout(retryT); clearInterval(beat); clearInterval(pingT);
    if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} ws = null; }
    const was = connected; connected = false; clearAll();
    if (was) { emit(); emitStatus(); }
  }

  function connect() {
    disconnect();
    if (!tracking() || !navigator.onLine || typeof WebSocket === 'undefined') { emit(); emitStatus(); return; }
    const c = cfg(), topic = 'realtime:ts-dev-' + String(c.lib).replace(/[^A-Za-z0-9_-]/g, '_');
    let sock;
    try { sock = new WebSocket(base().replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(c.key) + '&vsn=1.0.0'); }
    catch (e) { return; }
    ws = sock;
    let joinRef = null;
    const send = (t, ev, p) => { const r = String(++ref); if (sock.readyState === 1) sock.send(JSON.stringify({ topic: t, event: ev, payload: p, ref: r })); return r; };

    sock.onopen = () => {
      joinRef = send(topic, 'phx_join', { config: { broadcast: { self: false }, presence: { key: deviceId, enabled: true }, private: false, postgres_changes: [] }, access_token: bearer() || undefined });
      beat = setInterval(() => send('phoenix', 'heartbeat', {}), 25000);
    };
    sock.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.event === 'phx_reply' && m.topic === topic && m.ref === joinRef) {
        if (m.payload && m.payload.status === 'ok') {
          retry = 0; connected = true; connectedAt = Date.now(); lastError = '';
          const i = info();
          trackedRole = roleNow();
          send(topic, 'presence', { type: 'presence', event: 'track', payload: { type: i.type, browser: i.browser, os: i.os, role: trackedRole, since: Date.now() } });
          ping(); clearInterval(pingT); pingT = setInterval(ping, 120000);
          emitStatus();
        } else {
          connected = false; const rs = (m.payload && m.payload.response) || {}; lastError = 'Could not join the live channel: ' + (rs.reason || rs.message || (m.payload && m.payload.status) || 'unknown error');
          emitStatus();
        }
      } else if (m.event === 'presence_state') {
        clearAll();
        Object.keys(m.payload || {}).forEach((k) => { presence[k] = metas(m.payload[k]).slice(); });
        emit();
      } else if (m.event === 'presence_diff') {
        const d = m.payload || {};
        Object.keys(d.leaves || {}).forEach((k) => {
          const gone = metas(d.leaves[k]).map((x) => x.phx_ref);
          presence[k] = (presence[k] || []).filter((x) => gone.indexOf(x.phx_ref) < 0);
          if (!presence[k].length) delete presence[k];
        });
        Object.keys(d.joins || {}).forEach((k) => {
          const have = presence[k] || [];
          metas(d.joins[k]).forEach((x) => { if (!have.some((y) => y.phx_ref === x.phx_ref)) have.push(x); });
          presence[k] = have;
        });
        emit();
      } else if (m.event === 'system' && m.payload && m.payload.status === 'error') {
        lastError = 'Realtime says: ' + (m.payload.message || 'error'); emitStatus();
      } else if (m.event === 'phx_error' || m.event === 'phx_close') { sock.close(); }
    };
    sock.onclose = () => {
      clearInterval(beat); clearInterval(pingT);
      if (ws !== sock) return;
      ws = null; const was = connected; connected = false; clearAll();
      if (was) emit();
      emitStatus();
      retryT = setTimeout(connect, Math.min(30000, 1000 * Math.pow(2, retry++)));
    };
    sock.onerror = () => { lastError = 'Live connection error'; };
  }

  // ---- admin-only REST helper (uses the signed-in admin's token) ----
  async function rest(path, init) {
    if (!configured()) throw new Error('Cloud sync is not set up');
    const s = sess();
    if (s && s.expires_at - 30000 < Date.now() && typeof CloudSync !== 'undefined' && CloudSync.sync) { try { await CloudSync.sync(); } catch (e) {} }
    const res = await fetch(base() + '/rest/v1/' + path, Object.assign({}, init, {
      headers: headers(Object.assign({ 'Content-Type': 'application/json' }, (init && init.headers) || {}))
    }));
    if (!res.ok) { let t = ''; try { t = (await res.text()).slice(0, 160); } catch (e) {} throw new Error('Request failed (' + res.status + ') ' + t); }
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }

  async function uploadStorage(bucket, path, file) {
    if (!configured()) throw new Error('Cloud sync is not set up');
    const s = sess();
    if (s && s.expires_at - 30000 < Date.now() && typeof CloudSync !== 'undefined' && CloudSync.sync) {
      try { await CloudSync.sync(); } catch (e) {}
    }
    if (!validSess()) throw new Error('Sign in as an admin before uploading files.');
    const objectPath = encodeURIComponent(bucket) + '/' + path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(base() + '/storage/v1/object/' + objectPath, {
      method: 'POST',
      headers: headers({ 'Content-Type': file.type, 'x-upsert': 'true' }),
      body: file
    });
    if (!res.ok) {
      let text = '';
      try { text = (await res.text()).slice(0, 160); } catch (e) {}
      throw new Error('File upload failed (' + res.status + ') ' + text);
    }
    return base() + '/storage/v1/object/public/' + objectPath;
  }

  async function invokeFunction(name, body) {
    if (!configured()) throw new Error('Cloud sync is not set up');
    const c = cfg();
    const s = sess();
    const res = await fetch(base() + '/functions/v1/' + encodeURIComponent(name), {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || result.message || ('Function request failed (' + res.status + ')'));
    return result;
  }

  function start() {
    if (tracking()) connect();
    setInterval(() => {                                                                      // picks up settings saved later
      if (!tracking() || !navigator.onLine) return;
      if (!ws) connect();
      else if (connected && trackedRole !== roleNow()) connect();                            // logged in/out since we announced
    }, 15000);
    window.addEventListener('online', connect);
    window.addEventListener('offline', disconnect);
    window.addEventListener('admin-unlocked', connect);                                      // re-announce as admin
    window.addEventListener('admin-locked', connect);                                        // drop admin presence on lock
    document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  }
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);

  return {
    deviceId, rest, uploadStorage, invokeFunction, configured, tracking, restart: connect,
    get live() { return list(); }, get connected() { return connected; }, get connectedAt() { return connectedAt; }, get error() { return lastError; },
    onPresence(cb) { cbs.push(cb); cb(list()); },
    onStatus(cb) { statusCbs.push(cb); cb({ connected, error: lastError }); }
  };
})();