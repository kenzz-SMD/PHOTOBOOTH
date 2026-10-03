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
      await run(STORE, 'readwrite', (s) => s.put(rec));
      notify();
    },

    async remove(id) {
      await run(STORE, 'readwrite', (s) => s.delete(id));
      notify();
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
    await TemplateStore._run('strips', 'readwrite', (s) => s.put(rec));
    // keep only the newest strips
    const all = await this.list();
    const extra = all.slice(0, Math.max(0, all.length - 24));
    for (const r of extra) await TemplateStore._run('strips', 'readwrite', (s) => s.delete(r.id));
  },
  async list() {   // oldest first
    const all = await TemplateStore._run('strips', 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => a.createdAt - b.createdAt);
  },
  async remove(id) {
    await TemplateStore._run('strips', 'readwrite', (s) => s.delete(id));
  }
};