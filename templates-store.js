// ===================== SHARED TEMPLATE STORE =====================
// Used by BOTH the photobooth (index.html) and the admin screen (admin.html).
// Built-in templates live here in code. Templates uploaded in the admin screen
// are saved in this browser's IndexedDB and loaded automatically by the photobooth.

const BUILTIN_TEMPLATES = [
  {
    id: 'template1', name: 'Kiss Please', src: 'templates/template1.png', builtin: true,
    slots: [
      { x: 52, y: 75,   w: 483, h: 313 },
      { x: 58, y: 435,  w: 483, h: 313 },
      { x: 52, y: 801,  w: 483, h: 313 },
      { x: 52, y: 1172, w: 483, h: 313 }
    ]
  },
  {
    id: 'template2', name: 'Life in Frames', src: 'templates/template2.png', builtin: true,
    slots: [
      { x: 58, y: 75,   w: 483, h: 313 },
      { x: 58, y: 438,  w: 483, h: 313 },
      { x: 58, y: 801,  w: 483, h: 313 },
      { x: 58, y: 1164, w: 483, h: 313 }
    ]
  }
];

const TemplateStore = (() => {
  const DB_NAME = 'timeless-strips';
  const STORE = 'templates';   // uploaded templates
  const STRIPS = 'strips';     // gallery of finished photo strips
  const MAX_STRIPS = 24;       // keep the newest 24 in the gallery
  let dbPromise = null;

  const channel = ('BroadcastChannel' in window)
    ? new BroadcastChannel('timeless-strips-templates') : null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB not supported')); return; }
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STRIPS)) db.createObjectStore(STRIPS, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function run(store, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function notify() { if (channel) channel.postMessage('changed'); }

  return {
    _run: run,
    uid: () => 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),

    async list() {
      const all = await run(STORE, 'readonly', (s) => s.getAll());
      return (all || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },

    async save(rec) {
      rec.updatedAt = Date.now();
      await run(STORE, 'readwrite', (s) => s.put(rec));
      notify();
      if (typeof CloudSync !== 'undefined') CloudSync.queue();
    },

    async remove(id) {
      await run(STORE, 'readwrite', (s) => s.delete(id));
      notify();
      if (typeof CloudSync !== 'undefined') CloudSync.tombstone('template', id);
    },

    // Templates in the shape the photobooth uses
    async loadForApp() {
      const recs = await this.list();
      return recs.map((r) => ({
        id: r.id, name: r.name, slots: r.slots, custom: true,
        src: URL.createObjectURL(r.blob)
      }));
    },

    onChange(cb) { if (channel) channel.onmessage = () => cb(); },

    // ---- Backup / move to another device ----
    async exportAll() {
      const recs = await this.list();
      const out = [];
      for (const r of recs) {
        const data = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.readAsDataURL(r.blob);
        });
        const { blob, ...meta } = r;
        out.push({ ...meta, data });
      }
      return JSON.stringify({ app: 'timeless-strips', version: 1, templates: out });
    },

    async importAll(jsonText) {
      const parsed = JSON.parse(jsonText);
      if (!parsed || !Array.isArray(parsed.templates)) throw new Error('Not a valid export file');
      let n = 0;
      for (const t of parsed.templates) {
        if (!t.data || !Array.isArray(t.slots)) continue;
        const blob = await (await fetch(t.data)).blob();
        const { data, ...meta } = t;
        await run(STORE, 'readwrite', (s) => s.put({ ...meta, id: meta.id || this.uid(), blob }));
        n++;
      }
      notify();
      return n;
    }
  };

})();

// ===================== GALLERY OF PAST STRIPS =====================
const StripStore = {
  // Save (or replace) a finished strip: { id, blob, templateName, createdAt }
  async save(rec) {
    rec.updatedAt = Date.now();
    await TemplateStore._run('strips', 'readwrite', (s) => s.put(rec));
    // keep only the newest strips
    const all = await this.list();
    const extra = all.slice(0, Math.max(0, all.length - 24));
    for (const r of extra) await TemplateStore._run('strips', 'readwrite', (s) => s.delete(r.id));
    if (typeof CloudSync !== 'undefined') CloudSync.queue();
  },
  async list() {   // oldest first
    const all = await TemplateStore._run('strips', 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => a.createdAt - b.createdAt);
  },
  async remove(id) {
    await TemplateStore._run('strips', 'readwrite', (s) => s.delete(id));
    if (typeof CloudSync !== 'undefined') CloudSync.tombstone('strip', id);
  }
};

// ===================== CLOUD SYNC (Supabase) =====================
// Templates and finished strips are mirrored to a Supabase project so every device that
// uses the same "library code" shares one library. Works offline: changes are kept locally
// and pushed the next time the device is online. See supabase-setup.sql for the one-time setup.
//
// Conflict rule: last write wins (by updatedAt). Deletes are synced as tombstones.
const CloudSync = (() => {
  const CFG_KEY = 'ts-cloud-config';
  const PUSHED_KEY = 'ts-cloud-pushed';   // { 'kind:id': updatedAt that was pushed }
  const TOMB_KEY = 'ts-cloud-tombs';      // { 'kind:id': deletedAt }
  const CURSOR_KEY = 'ts-cloud-cursor';
  const BUCKET = 'timeless-strips';
  const KINDS = { template: 'templates', strip: 'strips' };

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  let status = { state: 'off', msg: '', last: ls.get('ts-cloud-last', 0), live: false };
  const statusCbs = [], pulledCbs = [];
  let running = false, again = false, timer = null, debounce = null;

  // A device's own saved setting (Admin page) wins; otherwise use the shared cloud-config.js
  const getConfig = () => {
    const saved = ls.get(CFG_KEY, null);
    if (saved) return saved;
    const d = (typeof window !== 'undefined' && window.CLOUD_CONFIG) || null;
    return d && d.url && d.key && d.lib ? Object.assign({ enabled: true }, d) : null;
  };
  // Kinds of records this device syncs (strips only if syncStrips !== false)
  const kinds = () => Object.keys(KINDS).filter((k) => k !== 'strip' || (getConfig() || {}).syncStrips !== false);
  const enabled = () => { const c = getConfig(); return !!(c && c.enabled && c.url && c.key && c.lib); };

  function setStatus(state, msg) {
    status = { state, msg: msg || '', last: status.last, live: status.live };
    statusCbs.forEach((cb) => { try { cb(status); } catch (e) {} });
  }

  // New-style keys (sb_publishable_...) are not JWTs, so they go in `apikey` only.
  // When an admin is signed in, their login token is used so the database lets them write templates.
  const SESS_KEY = 'ts-cloud-session';
  const getSess = () => ls.get(SESS_KEY, null);
  function authHeaders(key) {
    const s = getSess();
    const bearer = s ? s.access_token : (/^sb_/.test(key) ? null : key);
    return bearer ? { apikey: key, Authorization: 'Bearer ' + bearer } : { apikey: key };
  }
  async function authCall(path, body) {
    const c = getConfig();
    const res = await fetch(c.url.replace(/\/+$/, '') + '/auth/v1/' + path, {
      method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.msg || j.message || ('Login failed (' + res.status + ')'));
    return j;
  }
  function saveSess(j) {
    const s = { access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || '' };
    ls.set(SESS_KEY, s);
    return s;
  }
  async function refreshSession() {
    const s = getSess();
    if (!s || s.expires_at - Date.now() > 60000) return s;
    try { return saveSess(await authCall('token?grant_type=refresh_token', { refresh_token: s.refresh_token })); }
    catch (e) { if (navigator.onLine) ls.set(SESS_KEY, null); return getSess(); }
  }
  async function isAdminRemote() {
    const c = getConfig();
    const res = await fetch(c.url.replace(/\/+$/, '') + '/rest/v1/rpc/ts_is_admin', {
      method: 'POST', headers: Object.assign(authHeaders(c.key), { 'Content-Type': 'application/json' }), body: '{}'
    });
    if (!res.ok) throw new Error('Could not verify admin (' + res.status + ')');
    return (await res.json()) === true;
  }
  function base() { return getConfig().url.replace(/\/+$/, ''); }
  function hdr(extra) {
    const c = getConfig();
    return Object.assign(authHeaders(c.key), extra || {});
  }
  async function check(res, what) {
    if (!res.ok) {
      let t = ''; try { t = (await res.text()).slice(0, 200); } catch (e) {}
      throw new Error(what + ' failed (' + res.status + ') ' + t);
    }
    return res;
  }

  const objPath = (kind, id) => encodeURIComponent(getConfig().lib) + '/' + kind + '/' + encodeURIComponent(id);

  async function upload(kind, rec) {
    const res = await fetch(base() + '/storage/v1/object/' + BUCKET + '/' + objPath(kind, rec.id), {
      method: 'POST',
      headers: hdr({ 'x-upsert': 'true', 'Content-Type': rec.blob.type || 'image/png' }),
      body: rec.blob
    });
    await check(res, 'Upload');
  }

  async function upsertRows(rows) {
    if (!rows.length) return;
    const res = await fetch(base() + '/rest/v1/ts_items?on_conflict=lib,id', {
      method: 'POST',
      headers: hdr({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows)
    });
    await check(res, 'Save');
  }

  async function pushAll() {
    const c = getConfig();
    const pushed = ls.get(PUSHED_KEY, {});
    const tombs = ls.get(TOMB_KEY, {});

    const admin = !!getSess();
    for (const kind of kinds()) {
      if (kind === 'template' && !admin) continue;      // guests never write templates
      const recs = await TemplateStore._run(KINDS[kind], 'readonly', (s) => s.getAll()) || [];
      for (const rec of recs) {
        const key = kind + ':' + rec.id;
        const ver = rec.updatedAt || rec.createdAt || 1;
        if (tombs[key] || (pushed[key] || 0) >= ver || !rec.blob) continue;
        await upload(kind, rec);
        const { blob, ...meta } = rec;
        await upsertRows([{ lib: c.lib, id: rec.id, kind, data: meta, deleted: false, updated_at: ver }]);
        pushed[key] = ver;
        ls.set(PUSHED_KEY, pushed);
      }
    }
    for (const key of Object.keys(tombs)) {
      if (key.startsWith('template:') && !admin) continue;
      const [kind, ...rest] = key.split(':');
      const id = rest.join(':');
      await upsertRows([{ lib: c.lib, id, kind, data: {}, deleted: true, updated_at: tombs[key] }]);
      delete tombs[key];
      ls.set(TOMB_KEY, tombs);
    }
  }

  async function pullAll() {
    const c = getConfig();
    const first = !ls.get(CURSOR_KEY, 0);
    const since = Math.max(0, ls.get(CURSOR_KEY, 0) - 60000);   // overlap: clocks differ a bit
    let rows = [], from = since;
    for (;;) {   // page through everything newer than the cursor (500 rows per request)
      const url = base() + '/rest/v1/ts_items?lib=eq.' + encodeURIComponent(c.lib) +
        '&updated_at=gt.' + from + '&order=updated_at.asc&limit=500&select=id,kind,data,deleted,updated_at';
      const page = await (await check(await fetch(url, { headers: hdr() }), 'Download')).json();
      rows = rows.concat(page);
      if (page.length < 500) break;
      from = page[page.length - 1].updated_at;
    }

    const pushed = ls.get(PUSHED_KEY, {});
    let changed = false, maxTs = ls.get(CURSOR_KEY, 0);
    // on the very first pull only fetch the newest strips (the gallery keeps 24)
    let skipStrips = 0;
    if (first) {
      const strips = rows.filter((r) => r.kind === 'strip' && !r.deleted);
      skipStrips = Math.max(0, strips.length - 24);
    }
    for (const row of rows) {
      maxTs = Math.max(maxTs, row.updated_at);
      const kind = row.kind, store = KINDS[kind];
      if (!store || !kinds().includes(kind)) continue;
      const key = kind + ':' + row.id;
      const local = await TemplateStore._run(store, 'readonly', (s) => s.get(row.id));
      const localVer = local ? (local.updatedAt || local.createdAt || 1) : 0;

      if (row.deleted) {
        if (local && localVer <= row.updated_at) {
          await TemplateStore._run(store, 'readwrite', (s) => s.delete(row.id));
          changed = true;
        }
        pushed[key] = row.updated_at;
        continue;
      }
      if (localVer >= row.updated_at) continue;
      if (kind === 'strip' && skipStrips > 0) { skipStrips--; continue; }

      const res = await fetch(base() + '/storage/v1/object/public/' + BUCKET + '/' + objPath(kind, row.id) +
        '?v=' + row.updated_at);
      if (!res.ok) continue;
      const blob = await res.blob();
      await TemplateStore._run(store, 'readwrite', (s) => s.put(Object.assign({}, row.data, { id: row.id, blob, updatedAt: row.updated_at })));
      pushed[key] = row.updated_at;
      changed = true;
    }
    ls.set(PUSHED_KEY, pushed);
    ls.set(CURSOR_KEY, maxTs);
    return changed;
  }

  async function sync() {
    if (!enabled()) { setStatus('off'); return false; }
    if (!navigator.onLine) { setStatus('offline'); return false; }
    if (running) { again = true; return false; }
    running = true; again = false;
    setStatus('syncing');
    try {
      await refreshSession();
      const changed = await pullAll();
      await pushAll();
      status.last = Date.now(); ls.set('ts-cloud-last', status.last);
      setStatus('ok');
      if (changed) pulledCbs.forEach((cb) => { try { cb(); } catch (e) {} });
      return true;
    } catch (e) {
      console.warn('Cloud sync:', e);
      setStatus(navigator.onLine ? 'error' : 'offline', e.message);
      return false;
    } finally {
      running = false;
      if (again) { again = false; setTimeout(sync, 500); }
    }
  }

  // ---- Realtime: Supabase Realtime over a WebSocket (Phoenix protocol, no library) ----
  // When another device writes to ts_items we get a push and sync immediately.
  // Polling stays as a slow safety net, and as the main path if the socket can't connect.
  let RT_TOPIC = 'realtime:ts-items';

  // ---- Device tracking: this device announces itself (presence) and logs activity ----
  const DEV_KEY = 'ts-device-id';
  const BUCKET_MS = 5 * 60 * 1000;                 // activity is logged in 5-minute buckets
  let deviceId = ls.get(DEV_KEY, null);
  if (!deviceId) { deviceId = 'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); ls.set(DEV_KEY, deviceId); }

  function deviceInfo() {
    const ua = navigator.userAgent || '';
    const touch = (navigator.maxTouchPoints || 0) > 1;
    let type = 'desktop';
    if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && touch) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) type = 'tablet';
    else if (/Mobi|iPhone|iPod|Android/i.test(ua)) type = 'mobile';
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /SamsungBrowser/.test(ua) ? 'Samsung' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
    return { type, browser, os };
  }
  const tracking = () => (getConfig() || {}).trackDevices !== false;

  const presence = {};                 // device id -> [metas]  (live, from Realtime Presence)
  const presenceCbs = [];
  function livePeople() {
    return Object.keys(presence).filter((k) => presence[k].length).map((k) => {
      const m = presence[k][0];
      return { id: k, type: m.type, browser: m.browser, os: m.os, role: m.role, since: m.since, tabs: presence[k].length, me: k === deviceId };
    }).sort((a, b) => (a.since || 0) - (b.since || 0));
  }
  function emitPresence() { const l = livePeople(); presenceCbs.forEach((cb) => { try { cb(l); } catch (e) {} }); }
  function metasOf(v) { return (v && v.metas) || []; }
  function presenceState(state) {
    Object.keys(presence).forEach((k) => delete presence[k]);
    Object.keys(state || {}).forEach((k) => { presence[k] = metasOf(state[k]).slice(); });
    emitPresence();
  }
  function presenceDiff(d) {
    Object.keys((d && d.leaves) || {}).forEach((k) => {
      const gone = metasOf(d.leaves[k]).map((m) => m.phx_ref);
      presence[k] = (presence[k] || []).filter((m) => gone.indexOf(m.phx_ref) < 0);
      if (!presence[k].length) delete presence[k];
    });
    Object.keys((d && d.joins) || {}).forEach((k) => {
      const have = (presence[k] || []);
      metasOf(d.joins[k]).forEach((m) => { if (!have.some((x) => x.phx_ref === m.phx_ref)) have.push(m); });
      presence[k] = have;
    });
    emitPresence();
  }
  function clearPresence() { Object.keys(presence).forEach((k) => delete presence[k]); emitPresence(); }

  // log "this device is active now": last-seen row + one activity row per 5-minute bucket
  async function ping() {
    if (!enabled() || !tracking() || !navigator.onLine || document.hidden) return;
    const c = getConfig(), info = deviceInfo(), now = Date.now();
    try {
      await fetch(base() + '/rest/v1/ts_devices?on_conflict=lib,id', {
        method: 'POST',
        headers: hdr({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ lib: c.lib, id: deviceId, type: info.type, browser: info.browser, os: info.os,
          role: getSess() ? 'admin' : 'guest', last_seen: now })
      });
      await fetch(base() + '/rest/v1/ts_device_activity?on_conflict=lib,id,bucket', {
        method: 'POST',
        headers: hdr({ 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }),
        body: JSON.stringify({ lib: c.lib, id: deviceId, bucket: Math.floor(now / BUCKET_MS) })
      });
    } catch (e) { /* tracking must never disturb the booth */ }
  }
  let pingTimer = null;
  let ws = null, wsTimer = null, wsBeat = null, wsRetry = 0, wsRef = 0, wsDebounce = null;

  function setLive(v) {
    if (status.live === v) return;
    status = Object.assign({}, status, { live: v });
    statusCbs.forEach((cb) => { try { cb(status); } catch (e) {} });
  }
  function closeRealtime() {
    clearTimeout(wsTimer); clearInterval(wsBeat); clearInterval(pingTimer);
    if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} ws = null; }
    setLive(false);
  }
  function openRealtime() {
    closeRealtime();
    if (!enabled() || !navigator.onLine || typeof WebSocket === 'undefined') return;
    const c = getConfig();
    let sock;
    try {
      sock = new WebSocket(base().replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' +
        encodeURIComponent(c.key) + '&vsn=1.0.0');
    } catch (e) { return; }
    ws = sock;
    RT_TOPIC = 'realtime:ts-' + String(c.lib).replace(/[^A-Za-z0-9_-]/g, '_');
    let joinRef = null;
    const send = (topic, event, payload) => {
      const ref = String(++wsRef);
      if (sock.readyState === 1) sock.send(JSON.stringify({ topic, event, payload, ref }));
      return ref;
    };
    sock.onopen = () => {
      joinRef = send(RT_TOPIC, 'phx_join', {
        config: {
          broadcast: { self: false }, presence: { key: deviceId },
          postgres_changes: [{ event: '*', schema: 'public', table: 'ts_items', filter: 'lib=eq.' + c.lib }]
        },
        access_token: (getSess() || {}).access_token || (/^sb_/.test(c.key) ? undefined : c.key)
      });
      wsBeat = setInterval(() => send('phoenix', 'heartbeat', {}), 25000);
    };
    sock.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.event === 'phx_reply' && m.topic === RT_TOPIC && m.ref === joinRef) {
        if (m.payload && m.payload.status === 'ok') {
          wsRetry = 0; setLive(true); sync();
          if (tracking()) {                              // announce this device
            const i = deviceInfo();
            send(RT_TOPIC, 'presence', { type: 'presence', event: 'track',
              payload: { type: i.type, browser: i.browser, os: i.os, role: getSess() ? 'admin' : 'guest', since: Date.now() } });
            ping(); clearInterval(pingTimer); pingTimer = setInterval(ping, 120000);
          }
        } else setLive(false);
      } else if (m.event === 'presence_state') {
        presenceState(m.payload);
      } else if (m.event === 'presence_diff') {
        presenceDiff(m.payload);
      } else if (m.event === 'postgres_changes') {
        clearTimeout(wsDebounce); wsDebounce = setTimeout(sync, 250);
      } else if (m.event === 'phx_error' || m.event === 'phx_close') {
        sock.close();
      }
    };
    sock.onclose = () => {
      clearInterval(wsBeat); clearInterval(pingTimer);
      if (ws !== sock) return;
      ws = null; setLive(false); clearPresence();
      wsTimer = setTimeout(openRealtime, Math.min(30000, 1000 * Math.pow(2, wsRetry++)));
    };
    sock.onerror = () => {};
  }

  let tick = 0;
  function schedule() {
    clearInterval(timer);
    // while the live socket is up, poll only every ~2 minutes as a safety net
    if (enabled()) timer = setInterval(() => {
      if (document.hidden) return;
      if (status.live && ++tick % 4) return;
      sync();
    }, 30000);
  }

  window.addEventListener('online', () => { sync(); openRealtime(); });
  window.addEventListener('offline', () => { closeRealtime(); setStatus(enabled() ? 'offline' : 'off'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); ping(); } });

  return {
    getConfig, enabled,
    deviceId, onPresence(cb) { presenceCbs.push(cb); cb(livePeople()); }, get live() { return livePeople(); },
    // admin-only REST helper (uses the signed-in admin's token)
    async rest(path, init) {
      if (!enabled()) throw new Error('nocloud');
      const res = await fetch(base() + '/rest/v1/' + path, Object.assign({}, init, {
        headers: hdr(Object.assign({ 'Content-Type': 'application/json' }, (init && init.headers) || {}))
      }));
      await check(res, 'Request');
      const t = await res.text();
      return t ? JSON.parse(t) : null;
    },
    // Upload one strip image and return its public URL (used for the QR / share links)
    async publishStrip(blob) {
      if (!enabled()) throw new Error('nocloud');
      if (!navigator.onLine) throw new Error('offline');
      const id = 'qr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      const res = await fetch(base() + '/storage/v1/object/' + BUCKET + '/' + objPath('strip', id), {
        method: 'POST', headers: hdr({ 'Content-Type': blob.type || 'image/png' }), body: blob
      });
      await check(res, 'Upload');
      return base() + '/storage/v1/object/public/' + BUCKET + '/' + objPath('strip', id);
    },
    // ---- admin login (Supabase Auth, email + password) ----
    async login(email, password) {
      saveSess(await authCall('token?grant_type=password', { email, password }));
      let ok = false;
      try { ok = await isAdminRemote(); } catch (e) { ls.set(SESS_KEY, null); throw e; }
      if (!ok) { ls.set(SESS_KEY, null); throw new Error('This account is not an admin of this booth.'); }
      openRealtime();
      return getSess();
    },
    async restoreSession() {
      if (!getSess() || !getConfig()) return false;
      await refreshSession();
      if (!getSess()) return false;
      try { return await isAdminRemote(); } catch (e) { return !navigator.onLine; }   // offline: trust the saved login
    },
    logout() { ls.set(SESS_KEY, null); },
    get adminEmail() { return (getSess() || {}).email || ''; },
    get status() { return status; },
    onStatus(cb) { statusCbs.push(cb); cb(status); },
    onPulled(cb) { pulledCbs.push(cb); },

    configure(cfg) {
      const old = getConfig() || {};
      const next = Object.assign({}, old, cfg);
      if (cfg.lib !== undefined && cfg.lib !== old.lib) {      // different library: start fresh
        ls.set(PUSHED_KEY, {}); ls.set(CURSOR_KEY, 0);
      }
      ls.set(CFG_KEY, next);
      schedule();
      openRealtime();
      return sync();
    },
    disable() { const c = getConfig(); if (c) { c.enabled = false; ls.set(CFG_KEY, c); } clearInterval(timer); closeRealtime(); setStatus('off'); },

    sync,
    queue() { clearTimeout(debounce); debounce = setTimeout(sync, 800); },
    tombstone(kind, id) {
      const t = ls.get(TOMB_KEY, {}); t[kind + ':' + id] = Date.now(); ls.set(TOMB_KEY, t);
      this.queue();
    },
    async test(cfg) {      // verify credentials + table before enabling
      const u = cfg.url.replace(/\/+$/, '');
      const res = await fetch(u + '/rest/v1/ts_items?select=id&limit=1', {
        headers: authHeaders(cfg.key)
      });
      await check(res, 'Connection');
      return true;
    },
    start() { schedule(); if (enabled()) { sync(); openRealtime(); } else setStatus('off'); }
  };
})();

if (typeof window !== 'undefined') window.addEventListener('load', () => CloudSync.start());