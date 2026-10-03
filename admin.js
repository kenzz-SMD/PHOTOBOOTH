// ===================== ADMIN SCREEN =====================
// ===================== SAFETY CHECK =====================
// admin.js needs templates-store.js (same folder, loaded first in admin.html)
if (typeof TemplateStore === 'undefined' || typeof BUILTIN_TEMPLATES === 'undefined') {
  document.body.insertAdjacentHTML('afterbegin',
    '<div class="fatal"><b>templates-store.js was not found.</b><br>' +
    'Put <code>templates-store.js</code> in the same folder as <code>admin.html</code> ' +
    '(and upload it to GitHub too), then reload with Ctrl + Shift + R.</div>');
  throw new Error('templates-store.js is missing or failed to load');
}

const STRIP_W = 600;
const STRIP_H = 1800;
const MAX_SLOTS = 8;
const MAX_FILE_MB = 15;

const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('file-input');
const pickBtn = $('pick-btn');
const optTransparent = $('opt-transparent');
const uploadLog = $('upload-log');
const grid = $('grid');
const countEl = $('count');

// ---------- small helpers ----------
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  try { if (t.showPopover && !t.matches(':popover-open')) t.showPopover(); } catch (e) {}
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.classList.remove('show');
    try { if (t.hidePopover) t.hidePopover(); } catch (e) {}
  }, 3200);
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type || 'image/png', quality));
}

function confirmDialog(title, message, yesLabel) {
  return new Promise((resolve) => {
    const dlg = $('confirm-dlg');
    $('cf-title').textContent = title;
    $('cf-msg').textContent = message;
    $('cf-yes').textContent = yesLabel || 'Delete';
    const done = (val) => {
      $('cf-yes').onclick = null;
      $('cf-no').onclick = null;
      dlg.close();
      resolve(val);
    };
    $('cf-yes').onclick = () => done(true);
    $('cf-no').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}

// ===================== IMAGE ANALYSIS =====================
// Finds the "photo windows": either transparent areas, or big white boxes.

function labelComponents(mask, W, H) {
  const N = W * H;
  const labels = new Int32Array(N);
  const stack = new Int32Array(N);
  const comps = [];
  let next = 0;

  for (let i = 0; i < N; i++) {
    if (!mask[i] || labels[i]) continue;
    next++;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = next;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;

    while (sp) {
      const p = stack[--sp];
      const x = p % W;
      const y = (p / W) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0)     { const q = p - 1; if (mask[q] && !labels[q]) { labels[q] = next; stack[sp++] = q; } }
      if (x < W - 1) { const q = p + 1; if (mask[q] && !labels[q]) { labels[q] = next; stack[sp++] = q; } }
      if (y > 0)     { const q = p - W; if (mask[q] && !labels[q]) { labels[q] = next; stack[sp++] = q; } }
      if (y < H - 1) { const q = p + W; if (mask[q] && !labels[q]) { labels[q] = next; stack[sp++] = q; } }
    }
    comps.push({ id: next, minX, minY, maxX, maxY, area });
  }
  return { labels, comps };
}

function pickWindows(mask, W, H) {
  const { labels, comps } = labelComponents(mask, W, H);
  const good = comps.filter((c) => {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const fill = c.area / (bw * bh);
    return c.area >= W * H * 0.012 && bw >= 60 && bh >= 60 &&
           fill >= 0.7 && bw * bh < W * H * 0.6;
  });
  good.sort((a, b) =>
    Math.abs(a.minY - b.minY) < 40 ? a.minX - b.minX : a.minY - b.minY);
  return { labels, good };
}

function dilate(mask, W, H, iterations) {
  let cur = mask;
  for (let k = 0; k < iterations; k++) {
    const nxt = cur.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1]) || (x < W - 1 && cur[i + 1]) ||
            (y > 0 && cur[i - W]) || (y < H - 1 && cur[i + W])) nxt[i] = 1;
      }
    }
    cur = nxt;
  }
  return cur;
}

// Draws img at 600x1800, detects windows, optionally makes white windows transparent.
function analyzeImage(img, makeTransparent) {
  const W = STRIP_W, H = STRIP_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);

  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;
  const N = W * H;
  const trans = new Uint8Array(N);
  const white = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    const a = d[i * 4 + 3];
    if (a < 20) trans[i] = 1;
    else if (d[i * 4] >= 248 && d[i * 4 + 1] >= 248 && d[i * 4 + 2] >= 248) white[i] = 1;
  }

  let mode = 'transparent';
  let found = pickWindows(trans, W, H);
  if (!found.good.length) {
    mode = 'white';
    found = pickWindows(white, W, H);
  }

  const slots = found.good.slice(0, MAX_SLOTS).map((c) => {
    const x = Math.max(0, c.minX - 2);
    const y = Math.max(0, c.minY - 2);
    return {
      x, y,
      w: Math.min(W, c.maxX + 3) - x,
      h: Math.min(H, c.maxY + 3) - y
    };
  });

  let madeTransparent = false;
  if (mode === 'white' && makeTransparent && found.good.length) {
    const ids = new Set(found.good.map((c) => c.id));
    let remove = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (ids.has(found.labels[i])) remove[i] = 1;
    remove = dilate(remove, W, H, 2);
    for (let i = 0; i < N; i++) if (remove[i]) d[i * 4 + 3] = 0;
    ctx.putImageData(imgData, 0, 0);
    madeTransparent = true;
  }

  return { canvas, slots, mode: slots.length ? mode : 'none', madeTransparent };
}

function defaultSlots() {
  return [0, 1, 2, 3].map((i) => ({ x: 50, y: 50 + i * 430, w: 500, h: 380 }));
}

// ===================== UPLOAD =====================
function logLine(text, kind) {
  const p = document.createElement('p');
  p.className = 'log ' + (kind || '');
  p.textContent = text;
  uploadLog.prepend(p);
  while (uploadLog.children.length > 6) uploadLog.lastChild.remove();
  return p;
}

async function processFile(file) {
  if (!/^image\/(png|jpeg)$/.test(file.type)) {
    logLine('✗ ' + file.name + ': only PNG or JPG files are allowed.', 'err');
    return;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    logLine('✗ ' + file.name + ': file is larger than ' + MAX_FILE_MB + ' MB.', 'err');
    return;
  }

  const line = logLine('… Analyzing ' + file.name, '');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const origW = img.naturalWidth, origH = img.naturalHeight;
    const result = analyzeImage(img, optTransparent.checked);
    // Optimize: keep whichever is smaller, PNG or high-quality WebP (both keep transparency)
    const png = await canvasToBlob(result.canvas, 'image/png');
    const webp = await canvasToBlob(result.canvas, 'image/webp', 0.92);
    const blob = (webp && webp.type === 'image/webp' && webp.size < png.size * 0.85) ? webp : png;

    const needsAdjust = result.slots.length === 0;
    const rec = {
      id: TemplateStore.uid(),
      name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Template',
      width: STRIP_W, height: STRIP_H,
      origWidth: origW, origHeight: origH,
      origBytes: file.size, bytes: blob.size,
      slots: needsAdjust ? defaultSlots() : result.slots,
      mode: result.mode, madeTransparent: result.madeTransparent,
      createdAt: Date.now(), blob
    };
    await TemplateStore.save(rec);

    let msg = '✓ ' + file.name + ': ' + origW + '×' + origH + ' → ' + STRIP_W + '×' + STRIP_H +
      ', ' + fmtBytes(file.size) + ' → ' + fmtBytes(blob.size) + ', ';
    msg += needsAdjust ? 'no photo windows detected (please set them with Edit)'
                       : result.slots.length + ' photo slot(s) detected';
    if (result.madeTransparent) msg += ', white boxes made transparent';
    const ratio = origW / origH;
    if (Math.abs(ratio - 1 / 3) > 0.02) msg += ' ⚠ not a 1:3 strip, image was stretched';
    line.className = 'log ' + (needsAdjust ? 'warn' : 'ok');
    line.textContent = msg;

    await renderGrid();
    if (needsAdjust) openEditor(rec);
  } catch (err) {
    console.error(err);
    line.className = 'log err';
    line.textContent = '✗ ' + file.name + ': ' + err.message;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function handleFiles(files) {
  for (const f of files) await processFile(f);
}

pickBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  handleFiles([...fileInput.files]);
  fileInput.value = '';
});
dropzone.addEventListener('click', (e) => { if (e.target === dropzone) fileInput.click(); });
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('over'); }));
dropzone.addEventListener('drop', (e) => handleFiles([...e.dataTransfer.files]));
// Don't let a missed drop navigate away from the page
['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

// ===================== TEMPLATE LIST =====================
let thumbUrls = [];

function makeCard(t) {
  const card = document.createElement('div');
  card.className = 'tcard';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  const im = document.createElement('img');
  im.src = t.src;
  im.alt = t.name;
  thumb.appendChild(im);
  card.appendChild(thumb);

  const name = document.createElement('div');
  name.className = 'tname';
  name.textContent = t.name;
  if (t.builtin) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = 'Built-in';
    name.appendChild(b);
  }
  card.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'tmeta';
  const dims = t.width + '×' + t.height +
    (t.origWidth && (t.origWidth !== t.width || t.origHeight !== t.height)
      ? ' (orig ' + t.origWidth + '×' + t.origHeight + ')' : '');
  const lines = [
    'ID: ' + t.id,
    'Size: ' + dims,
    'Slots: ' + t.slots.length
  ];
  if (t.bytes) lines.push('File: ' + fmtBytes(t.bytes) +
    (t.origBytes ? ' (was ' + fmtBytes(t.origBytes) + ')' : ''));
  lines.forEach((l) => {
    const d = document.createElement('div');
    d.textContent = l;
    meta.appendChild(d);
  });
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'tactions';
  if (t.builtin) {
    const note = document.createElement('span');
    note.className = 'muted small';
    note.textContent = 'Defined in templates-store.js';
    actions.appendChild(note);
  } else {
    const edit = document.createElement('button');
    edit.className = 'btn small';
    edit.textContent = '✏️ Edit';
    edit.onclick = () => openEditor(t.rec);
    const del = document.createElement('button');
    del.className = 'btn small danger';
    del.textContent = '🗑 Delete';
    del.onclick = async () => {
      const ok = await confirmDialog(
        'Delete "' + t.name + '"?',
        'This removes the template from the photobooth. This cannot be undone.');
      if (!ok) return;
      await TemplateStore.remove(t.id);
      await renderGrid();
      toast('Deleted "' + t.name + '"');
    };
    actions.appendChild(edit);
    actions.appendChild(del);
  }
  card.appendChild(actions);
  return card;
}

async function renderGrid() {
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls = [];
  grid.innerHTML = '';

  const custom = await TemplateStore.list().catch(() => []);
  const items = BUILTIN_TEMPLATES.map((b) => ({
    id: b.id, name: b.name, src: b.src, slots: b.slots,
    width: STRIP_W, height: STRIP_H, builtin: true
  }));
  custom.forEach((r) => {
    const src = URL.createObjectURL(r.blob);
    thumbUrls.push(src);
    items.push({
      id: r.id, name: r.name, src, slots: r.slots,
      width: r.width, height: r.height,
      origWidth: r.origWidth, origHeight: r.origHeight,
      bytes: r.bytes, origBytes: r.origBytes, rec: r
    });
  });

  items.forEach((t) => grid.appendChild(makeCard(t)));
  countEl.textContent = items.length;
}

// ===================== EDIT (rename + slot coordinates) =====================
const edDlg = $('edit-dlg');
const edStage = $('ed-stage');
const edWrap = $('ed-wrap');
const edName = $('ed-name');
const edTbody = $('ed-table').querySelector('tbody');
let ed = null; // { rec, url, slots, scale }

function edScale() {
  return clamp((window.innerHeight - 260) / STRIP_H, 0.2, 0.5);
}

function placeRect(el, s) {
  el.style.left = s.x + 'px';
  el.style.top = s.y + 'px';
  el.style.width = s.w + 'px';
  el.style.height = s.h + 'px';
}

function syncInputs(i) {
  const row = edTbody.children[i];
  if (!row) return;
  ['x', 'y', 'w', 'h'].forEach((k) => {
    const inp = row.querySelector('input[data-k="' + k + '"]');
    if (inp && document.activeElement !== inp) inp.value = ed.slots[i][k];
  });
}

function normalizeSlot(s) {
  s.w = clamp(Math.round(s.w) || 40, 40, STRIP_W);
  s.h = clamp(Math.round(s.h) || 40, 40, STRIP_H);
  s.x = clamp(Math.round(s.x) || 0, 0, STRIP_W - s.w);
  s.y = clamp(Math.round(s.y) || 0, 0, STRIP_H - s.h);
}

function renderEditor() {
  ed.scale = edScale();
  edWrap.style.width = STRIP_W * ed.scale + 'px';
  edWrap.style.height = STRIP_H * ed.scale + 'px';
  edStage.style.transform = 'scale(' + ed.scale + ')';
  edStage.style.setProperty('--hs', 26 / ed.scale + 'px');
  edStage.style.setProperty('--bw', 3 / ed.scale + 'px');
  edStage.style.setProperty('--fs', 22 / ed.scale + 'px');

  edStage.innerHTML = '';
  const img = document.createElement('img');
  img.src = ed.url;
  img.className = 'ed-img';
  img.draggable = false;
  edStage.appendChild(img);

  edTbody.innerHTML = '';
  ed.slots.forEach((s, i) => {
    // rectangle on the preview
    const r = document.createElement('div');
    r.className = 'ed-slot';
    const num = document.createElement('span');
    num.className = 'ed-num';
    num.textContent = i + 1;
    const h = document.createElement('i');
    h.className = 'ed-h';
    r.append(num, h);
    placeRect(r, s);
    edStage.appendChild(r);
    attachRectDrag(r, i);

    // row in the table
    const tr = document.createElement('tr');
    const th = document.createElement('td');
    th.textContent = i + 1;
    tr.appendChild(th);
    ['x', 'y', 'w', 'h'].forEach((k) => {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.dataset.k = k;
      inp.value = s[k];
      inp.addEventListener('input', () => {
        s[k] = parseInt(inp.value, 10) || 0;
        const copy = { ...s };
        normalizeSlot(copy);
        placeRect(r, copy);
      });
      inp.addEventListener('change', () => {
        normalizeSlot(s);
        placeRect(r, s);
        syncInputs(i);
      });
      td.appendChild(inp);
      tr.appendChild(td);
    });
    const tdDel = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '✕';
    del.title = 'Remove slot';
    del.onclick = () => {
      if (ed.slots.length <= 1) { toast('A template needs at least one slot.'); return; }
      ed.slots.splice(i, 1);
      renderEditor();
    };
    tdDel.appendChild(del);
    tr.appendChild(tdDel);
    edTbody.appendChild(tr);
  });

  $('ed-info').textContent =
    STRIP_W + '×' + STRIP_H + ' px · ' + ed.slots.length + ' slot(s) · ' +
    'the photobooth takes ' + ed.slots.length + ' photos for this template';
}

function attachRectDrag(el, i) {
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const s = ed.slots[i];
    drag = {
      resize: e.target.classList.contains('ed-h'),
      sx: e.clientX, sy: e.clientY, x: s.x, y: s.y, w: s.w, h: s.h
    };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const s = ed.slots[i];
    const dx = (e.clientX - drag.sx) / ed.scale;
    const dy = (e.clientY - drag.sy) / ed.scale;
    if (drag.resize) {
      s.w = clamp(Math.round(drag.w + dx), 40, STRIP_W - s.x);
      s.h = clamp(Math.round(drag.h + dy), 40, STRIP_H - s.y);
    } else {
      s.x = clamp(Math.round(drag.x + dx), 0, STRIP_W - s.w);
      s.y = clamp(Math.round(drag.y + dy), 0, STRIP_H - s.h);
    }
    placeRect(el, s);
    syncInputs(i);
  });
  const end = () => { drag = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function openEditor(rec) {
  ed = {
    rec,
    url: URL.createObjectURL(rec.blob),
    slots: rec.slots.map((s) => ({ ...s })),
    scale: 0.4
  };
  edName.value = rec.name;
  renderEditor();
  edDlg.showModal();
}

function closeEditor() {
  if (ed) URL.revokeObjectURL(ed.url);
  ed = null;
  if (edDlg.open) edDlg.close();
}

$('ed-close').onclick = closeEditor;
$('ed-cancel').onclick = closeEditor;
edDlg.addEventListener('cancel', () => { if (ed) { URL.revokeObjectURL(ed.url); ed = null; } });

$('ed-add').onclick = () => {
  if (ed.slots.length >= MAX_SLOTS) { toast('Maximum ' + MAX_SLOTS + ' slots.'); return; }
  const last = ed.slots[ed.slots.length - 1];
  const s = last ? { ...last, y: last.y + 40 } : { x: 60, y: 60, w: 480, h: 300 };
  normalizeSlot(s);
  ed.slots.push(s);
  renderEditor();
};

$('ed-detect').onclick = async () => {
  try {
    const img = await loadImg(ed.url);
    const result = analyzeImage(img, false);
    if (!result.slots.length) { toast('No photo windows detected in this image.'); return; }
    ed.slots = result.slots;
    renderEditor();
    toast('Detected ' + result.slots.length + ' slot(s).');
  } catch (err) {
    toast('Could not analyze: ' + err.message);
  }
};

$('ed-save').onclick = async () => {
  const name = edName.value.trim();
  if (!name) { toast('Please enter a name.'); edName.focus(); return; }
  ed.slots.forEach(normalizeSlot);
  const rec = { ...ed.rec, name, slots: ed.slots.map((s) => ({ ...s })) };
  try {
    await TemplateStore.save(rec);
    closeEditor();
    await renderGrid();
    toast('Saved "' + name + '". The photobooth will use it right away.');
  } catch (err) {
    toast('Could not save: ' + err.message);
  }
};

window.addEventListener('resize', () => { if (ed && edDlg.open) renderEditor(); });

// ===================== EXPORT / IMPORT =====================
$('export-btn').onclick = async () => {
  try {
    const json = await TemplateStore.exportAll();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'timeless-strips-templates.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Exported your uploaded templates.');
  } catch (err) {
    toast('Export failed: ' + err.message);
  }
};

$('import-btn').onclick = () => $('import-input').click();
$('import-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const n = await TemplateStore.importAll(await f.text());
    await renderGrid();
    toast('Imported ' + n + ' template(s).');
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
});

// ===================== START =====================
TemplateStore.onChange(() => renderGrid());
renderGrid();

// ===================== CLOUD SYNC CARD =====================
(function cloudCard() {
  if (typeof CloudSync === 'undefined') { const c = $('cloud-card'); if (c) c.remove(); return; }
  const url = $('cloud-url'), key = $('cloud-key'), lib = $('cloud-lib'), msg = $('cloud-msg'), pill = $('cloud-pill');
  const cfg = CloudSync.getConfig();
  if (cfg) { url.value = cfg.url || ''; key.value = cfg.key || ''; lib.value = cfg.lib || ''; }

  CloudSync.onStatus((st) => {
    pill.className = 'pill ' + st.state;
    pill.textContent = { off: 'off', syncing: 'syncing…', ok: st.live ? '● live' : 'synced', offline: 'offline', error: 'error' }[st.state] || st.state;
    msg.textContent = st.state === 'error' ? st.msg
      : st.last ? 'Last synced ' + new Date(st.last).toLocaleString() : '';
  });
  CloudSync.onPulled(() => renderGrid());

  $('cloud-save').onclick = async () => {
    const c = { url: url.value.trim(), key: key.value.trim(), lib: lib.value.trim() };
    if (!c.url || !c.key || !c.lib) { toast('Fill in all three fields.'); return; }
    msg.textContent = 'Checking connection…';
    try {
      await CloudSync.test(c);
    } catch (e) {
      msg.textContent = e.message + ' — did you run supabase-setup.sql?';
      return;
    }
    await CloudSync.configure(Object.assign(c, { enabled: true }));
    toast('Cloud sync is on.');
  };
  $('cloud-now').onclick = () => CloudSync.sync();
  $('cloud-off').onclick = () => { CloudSync.disable(); toast('Cloud sync turned off.'); };
})();