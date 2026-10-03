// =====================================================================
//  TIMELESS STRIPS  -  photobooth app
//  Screens: Welcome -> Template -> Camera -> Editing -> Result (+ Gallery)
//  Built-in templates + templates uploaded from admin.html live in
//  templates-store.js
// =====================================================================

const STRIP_W = 600;   // 2in x 6in print ratio
const STRIP_H = 1800;

const DEFAULT_SLOTS = [0, 1, 2, 3].map((i) => ({
  x: 50, y: 50 + i * 430, w: 500, h: 380
}));

// Backup copy of the two built-in templates, used only if templates-store.js is missing,
// so the photobooth still works.
const FALLBACK_TEMPLATES = [
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

const STORE_OK = (typeof TemplateStore !== 'undefined' && typeof StripStore !== 'undefined');
const TEMPLATES = (typeof BUILTIN_TEMPLATES !== 'undefined') ? BUILTIN_TEMPLATES : FALLBACK_TEMPLATES;
let allTemplates = TEMPLATES.slice();
let selectedTemplate = null;

// ===================== ELEMENTS =====================
const $ = (id) => document.getElementById(id);

const adminLink = $('admin-link');
const startBtn = $('start-btn');
const welcomeScreen = $('welcome-screen');
const templateScreen = $('template-screen');
const templateList = $('template-list');
const templateConfirm = $('template-confirm');
const templateLabel = $('template-label');
const boothScreen = $('booth-screen');
const video = $('camera');
const stripBtn = $('strip-btn');
const changeTemplateBtn = $('change-template-btn');
const galleryBtn = $('gallery-btn');
const canvas = $('canvas');
const countdownEl = $('countdown');
const flashEl = $('flash');
const bgAnim = $('bg-anim');
const arCanvas = $('ar-canvas');
const arBar = $('ar-bar');
const arStatus = $('ar-status');
const editAutoCropBtn = $('edit-autocrop-btn');

const editScreen = $('edit-screen');
const editWrap = $('edit-wrap');
const editStage = $('edit-stage');
const editResetBtn = $('edit-reset-btn');
const editRetakeBtn = $('edit-retake-btn');
const editFinalizeBtn = $('edit-finalize-btn');
const filterListEl = $('filter-list');
const stickerListEl = $('sticker-list');

const resultScreen = $('result-screen');
const finalImg = $('final-strip');
const resultEmpty = $('result-empty');
const printBtn = $('print-btn');
const downloadBtn = $('download-btn');
const shareBtn = $('share-btn');
const editAgainBtn = $('edit-again-btn');
const newStripBtn = $('new-strip-btn');
const homeBtn = $('home-btn');
const galleryEl = $('gallery');


let cameraStarted = false;

function toast(msg) {
  const t = $('app-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function currentSlots() {
  return (selectedTemplate && selectedTemplate.slots) || DEFAULT_SLOTS;
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

// ===================== 1. WELCOME =====================
startBtn.addEventListener('click', () => {
  adminLink.classList.add('hidden');
  welcomeScreen.classList.add('hidden');
  templateScreen.classList.remove('hidden');
});

// ===================== TEMPLATE PICKER =====================
function buildTemplateList() {
  templateList.innerHTML = '';

  if (!allTemplates.length) {
    templateList.innerHTML = '<p class="template-error">No templates yet. Add some in the Admin screen.</p>';
    return;
  }

  allTemplates.forEach((tpl) => {
    const card = document.createElement('button');
    card.className = 'template-card';
    card.type = 'button';

    const preview = document.createElement('img');
    preview.src = tpl.src;
    preview.alt = tpl.name;
    preview.classList.add('template-preview');
    preview.onerror = () => {
      card.remove();
      if (!templateList.querySelector('.template-card')) {
        templateList.innerHTML =
          '<p class="template-error">Templates not found. Check that the folder is named ' +
          '<b>templates</b> (lowercase) and sits next to index.html.</p>';
      }
    };

    const label = document.createElement('span');
    label.textContent = tpl.name;

    card.appendChild(preview);
    card.appendChild(label);

    if (selectedTemplate && selectedTemplate.id === tpl.id) card.classList.add('selected');

    card.addEventListener('click', () => {
      document.querySelectorAll('.template-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedTemplate = tpl;
      templateConfirm.disabled = false;
    });

    templateList.appendChild(card);
  });
}
buildTemplateList();

if (!STORE_OK) {
  templateScreen.querySelector('h1').insertAdjacentHTML('afterend',
    '<p class="template-error">⚠ <b>templates-store.js</b> was not found. ' +
    'Uploaded templates and the gallery are unavailable. Put that file in the same folder as index.html.</p>');
}

// Templates uploaded in the admin screen (saved in this browser)
async function refreshTemplates() {
  let custom = [];
  try {
    custom = await TemplateStore.loadForApp();
  } catch (err) {
    console.warn('Custom templates not available:', err);
  }
  allTemplates = TEMPLATES.concat(custom);

  if (selectedTemplate && !allTemplates.some((t) => t.id === selectedTemplate.id) &&
      !templateScreen.classList.contains('hidden')) {
    selectedTemplate = null;
    templateConfirm.disabled = true;
  }
  buildTemplateList();
}
if (STORE_OK) {
  refreshTemplates();
  TemplateStore.onChange(refreshTemplates); // live update when the admin saves
}

templateConfirm.addEventListener('click', () => {
  if (!selectedTemplate) return;

  bgAnim.classList.add('off'); // animated background: welcome + template screens only
  templateScreen.classList.add('hidden');
  boothScreen.classList.remove('hidden');
  templateLabel.textContent = 'Template: ' + selectedTemplate.name;
  stripBtn.textContent = '🎞️ Capture Strip (' + currentSlots().length + ' Photos)';

  // a different template means the old edit no longer fits
  editState = null;
  stickers = [];
  currentStripId = null;

  startCamera();
});

changeTemplateBtn.addEventListener('click', () => {
  bgAnim.classList.remove('off');
  boothScreen.classList.add('hidden');
  templateScreen.classList.remove('hidden');
});

// ===================== 2. CAMERA =====================
function startCamera() {
  if (cameraStarted) return;

  navigator.mediaDevices.getUserMedia({ video: true })
    .then((stream) => {
      video.srcObject = stream;
      cameraStarted = true;
      startAr();
    })
    .catch((err) => {
      console.error('Camera error:', err);
      alert('Could not access camera: ' + err.message);
    });
}

stripBtn.addEventListener('click', () => {
  getAudioCtx(); // unlock sound (browsers need a click first)
  stripBtn.disabled = true;
  changeTemplateBtn.disabled = true;
  galleryBtn.disabled = true;
  captureStrip(1, []);
});

function captureStrip(shotNumber, photos) {
  runCountdown(() => {
    playShutter();
    triggerFlash();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (arFilter !== 'none') {
      drawArFaces(ctx, arFaces, arFilter);   // same smoothed faces as the live preview
    }
    photos.push(canvas.toDataURL('image/png'));

    if (shotNumber < currentSlots().length) {
      countdownEl.textContent = 'Next shot...';
      setTimeout(() => captureStrip(shotNumber + 1, photos), 1000);
    } else {
      countdownEl.textContent = '';
      startEdit(photos);
    }
  });
}


// ===================== AR FACE FILTERS (live) =====================
let arFilter = 'none';
let arReady = false;
let arFaces = [];
let arLoopOn = false;
let arLastTs = 0;

function buildArBar() {
  if (typeof AR_FILTERS === 'undefined') { arBar.classList.add('hidden'); return; }
  arBar.innerHTML = '';
  AR_FILTERS.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ar-chip' + (f.id === arFilter ? ' active' : '');
    b.innerHTML = '<span class="ar-ico">' + f.icon + '</span><span>' + f.name + '</span>';
    b.addEventListener('click', () => {
      arFilter = f.id;
      arBar.querySelectorAll('.ar-chip').forEach((c) => c.classList.toggle('active', c === b));
      if (f.id !== 'none' && !arReady) loadArEngine();
    });
    arBar.appendChild(b);
  });
}

function loadArEngine() {
  if (typeof FaceEngine === 'undefined' || arReady) return;
  arStatus.textContent = 'Loading face filters…';
  FaceEngine.initVideo().then((ok) => {
    arReady = ok;
    arStatus.textContent = ok ? '' : 'Face filters need an internet connection the first time.';
    if (ok) arLoop();
  });
}

function startAr() {
  buildArBar();
  if (typeof FaceEngine !== 'undefined') FaceEngine.preload();   // warm the models
  arLoop();
}

function arLoop() {
  if (arLoopOn) return;
  arLoopOn = true;
  const tick = () => {
    if (boothScreen.classList.contains('hidden') || !video.videoWidth) {
      if (!boothScreen.classList.contains('hidden')) { requestAnimationFrame(tick); return; }
      arLoopOn = false;           // resumed when the booth is shown again
      return;
    }
    const vw = video.videoWidth, vh = video.videoHeight;
    if (arCanvas.width !== vw || arCanvas.height !== vh) { arCanvas.width = vw; arCanvas.height = vh; }
    const ctx = arCanvas.getContext('2d');
    ctx.clearRect(0, 0, vw, vh);
    if (arFilter !== 'none' && arReady) {
      const now = performance.now();
      if (now - arLastTs > 33 && now > arLastTs) {       // ~30 fps detection
        const f = FaceEngine.detectVideo(video, now);
        if (f) arFaces = f;
        arLastTs = now;
      }
      arFaces = FaceEngine.step();           // smooth gliding every frame
      drawArFaces(ctx, arFaces, arFilter);
    } else if (arReady && arFaces.length) {
      FaceEngine.reset(); arFaces = [];      // filter off: forget old positions
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// resume the loop whenever the booth screen is shown again
new MutationObserver(() => {
  if (!boothScreen.classList.contains('hidden') && cameraStarted) arLoop();
}).observe(boothScreen, { attributes: true, attributeFilter: ['class'] });

function runCountdown(callback) {
  let count = 3;
  countdownEl.textContent = count;

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      countdownEl.textContent = count;
    } else {
      clearInterval(timer);
      countdownEl.textContent = '';
      callback();
    }
  }, 1000);
}

// ===================== 3. EDITING =====================
let editState = null;   // [{ img, r, minW, maxW, box:{x,y,w,h} }]  (box is relative to its slot)
let editScale = 0.4;    // on-screen scale of the 600x1800 stage
let selectedSlot = 0;
let editEls = null;
let handleDrag = null;

// ---------- Filters ----------
const FILTERS = [
  { id: 'none',    name: 'Original', ops: [] },
  { id: 'bw',      name: 'B&W',      ops: [['grayscale', 1], ['contrast', 1.15]] },
  { id: 'sepia',   name: 'Sepia',    ops: [['sepia', 0.85], ['contrast', 1.05]] },
  { id: 'warm',    name: 'Warm',     ops: [['sepia', 0.3], ['saturate', 1.35], ['brightness', 1.05]] },
  { id: 'vivid',   name: 'Vivid',    ops: [['saturate', 1.6], ['contrast', 1.1]] },
  { id: 'vintage', name: 'Vintage',  ops: [['sepia', 0.45], ['contrast', 0.9], ['brightness', 1.05], ['saturate', 1.2]] },
  { id: 'soft',    name: 'Soft',     ops: [['contrast', 0.9], ['brightness', 1.08], ['saturate', 1.1]] }
];
let currentFilter = FILTERS[0];

function filterCss(f) {
  return f.ops.length ? f.ops.map(([n, v]) => n + '(' + v + ')').join(' ') : 'none';
}

// Does this browser support ctx.filter? (Safari older than 18 does not)
const canvasFilterSupported = (() => {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const x = c.getContext('2d');
    x.filter = 'invert(1)';
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 1, 1);
    return x.getImageData(0, 0, 1, 1).data[0] < 10;
  } catch (e) { return false; }
})();

// Pixel version of the same filters (used only when ctx.filter is missing)
function applyOpsToImageData(imgData, ops) {
  const d = imgData.data;
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const steps = ops.map(([name, v]) => {
    if (name === 'grayscale' || name === 'sepia' || name === 'saturate') {
      let m;
      if (name === 'grayscale') {
        const a = 1 - v;
        m = [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a,
             0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a,
             0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a];
      } else if (name === 'sepia') {
        const a = 1 - v;
        m = [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
             0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
             0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a];
      } else {
        m = [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
             0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
             0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v];
      }
      return (px) => {
        const [r, g, b] = px;
        px[0] = clamp255(m[0] * r + m[1] * g + m[2] * b);
        px[1] = clamp255(m[3] * r + m[4] * g + m[5] * b);
        px[2] = clamp255(m[6] * r + m[7] * g + m[8] * b);
      };
    }
    if (name === 'contrast') {
      return (px) => { for (let k = 0; k < 3; k++) px[k] = clamp255((px[k] - 127.5) * v + 127.5); };
    }
    // brightness
    return (px) => { for (let k = 0; k < 3; k++) px[k] = clamp255(px[k] * v); };
  });

  const px = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    px[0] = d[i]; px[1] = d[i + 1]; px[2] = d[i + 2];
    for (const s of steps) s(px);
    d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2];
  }
}

function buildFilterList() {
  filterListEl.innerHTML = '';
  FILTERS.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (f.id === currentFilter.id ? ' active' : '');
    b.dataset.id = f.id;

    const im = document.createElement('img');
    if (editState && editState[0]) im.src = editState[0].img.src;
    im.style.filter = filterCss(f);
    im.alt = '';
    const sp = document.createElement('span');
    sp.textContent = f.name;
    b.append(im, sp);

    b.addEventListener('click', () => {
      currentFilter = f;
      applyFilterToEditor();
      filterListEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
    });
    filterListEl.appendChild(b);
  });
}

function applyFilterToEditor() {
  if (!editEls) return;
  const css = filterCss(currentFilter);
  editEls.slots.forEach(({ img }) => { img.style.filter = css; });
}

// ---------- Photos inside their windows ----------
function makeEditItem(img, slot) {
  const r = img.naturalWidth / img.naturalHeight;
  const minW = Math.max(slot.w, slot.h * r);
  const w = minW;
  const h = w / r;
  return {
    img, r, minW, maxW: minW * 4,
    box: { x: (slot.w - w) / 2, y: (slot.h - h) / 2, w, h }
  };
}

function clampBox(item, slot) {
  item.box.x = Math.min(0, Math.max(slot.w - item.box.w, item.box.x));
  item.box.y = Math.min(0, Math.max(slot.h - item.box.h, item.box.y));
}

function applyBox(i) {
  const b = editState[i].box;
  const s = editEls.slots[i].img.style;
  s.left = b.x + 'px';
  s.top = b.y + 'px';
  s.width = b.w + 'px';
  s.height = b.h + 'px';
}

// Zoom photo i by factor f, keeping the point (cx, cy) (slot coords) fixed
function zoomAt(i, f, cx, cy) {
  const item = editState[i];
  const slot = currentSlots()[i];
  const newW = Math.min(item.maxW, Math.max(item.minW, item.box.w * f));
  const f2 = newW / item.box.w;
  item.box.x = cx - (cx - item.box.x) * f2;
  item.box.y = cy - (cy - item.box.y) * f2;
  item.box.w = newW;
  item.box.h = newW / item.r;
  clampBox(item, slot);
  applyBox(i);
}

function startEdit(photos) {
  Promise.all(photos.map(loadImage)).then((imgs) => {
    const slots = currentSlots();
    editState = imgs.map((img, i) => makeEditItem(img, slots[i]));
    stickers = [];
    selectedSticker = null;
    currentFilter = FILTERS[0];
    currentStripId = null;
    selectedSlot = 0;

    boothScreen.classList.add('hidden');
    editScreen.classList.remove('hidden');
    buildFilterList();
    renderEditor();

    stripBtn.disabled = false;
    changeTemplateBtn.disabled = false;
    galleryBtn.disabled = false;
  });
}

function renderEditor() {
  const tpl = selectedTemplate;
  const slots = currentSlots();

  editStage.innerHTML = '';
  editStage.classList.remove('sticker-mode');
  editStage.style.background = tpl.background || '#ffffff';
  editEls = { slots: [], frame: null, handles: [], stickerEls: new Map(), stkCtl: null };

  // Photo windows
  slots.forEach((slot, i) => {
    const el = document.createElement('div');
    el.className = 'edit-slot';
    el.style.left = slot.x + 'px';
    el.style.top = slot.y + 'px';
    el.style.width = slot.w + 'px';
    el.style.height = slot.h + 'px';

    const img = document.createElement('img');
    img.src = editState[i].img.src;
    img.draggable = false;
    el.appendChild(img);

    editStage.appendChild(el);
    editEls.slots.push({ el, img });
    applyBox(i);
    attachSlotEvents(i);
  });
  applyFilterToEditor();

  // Template frame on top of photos
  if (tpl.src) {
    const t = document.createElement('img');
    t.src = tpl.src;
    t.className = 'edit-template';
    t.draggable = false;
    editStage.appendChild(t);
  }

  // Selection frame + corner handles for the selected photo
  const frame = document.createElement('div');
  frame.className = 'edit-frame';
  editStage.appendChild(frame);
  editEls.frame = frame;

  ['nw', 'ne', 'sw', 'se'].forEach((corner) => {
    const hnd = document.createElement('div');
    hnd.className = 'edit-handle ' + corner;
    editStage.appendChild(hnd);
    editEls.handles.push({ corner, el: hnd });
    attachHandleEvents(hnd);
  });

  // Stickers (always above the template)
  stickers.forEach(createStickerEl);
  createStickerControls();

  layoutEditor();
}

function layoutEditor() {
  if (!editEls) return;
  const byHeight = Math.min(0.6, Math.max(0.3, (window.innerHeight - 260) / STRIP_H));
  editScale = Math.min(byHeight, (window.innerWidth - 30) / STRIP_W);

  editWrap.style.width = STRIP_W * editScale + 'px';
  editWrap.style.height = STRIP_H * editScale + 'px';
  editStage.style.transform = 'scale(' + editScale + ')';
  editStage.style.setProperty('--hs', 30 / editScale + 'px');
  editStage.style.setProperty('--bw', 3 / editScale + 'px');

  positionSlotControls();
}

function positionSlotControls() {
  const slot = currentSlots()[selectedSlot];
  const hs = 30 / editScale;
  const inset = hs * 0.8;

  const f = editEls.frame.style;
  f.left = slot.x + 'px';
  f.top = slot.y + 'px';
  f.width = slot.w + 'px';
  f.height = slot.h + 'px';

  editEls.handles.forEach(({ corner, el }) => {
    const cx = corner.includes('w') ? slot.x + inset : slot.x + slot.w - inset;
    const cy = corner.includes('n') ? slot.y + inset : slot.y + slot.h - inset;
    el.style.left = cx - hs / 2 + 'px';
    el.style.top = cy - hs / 2 + 'px';
  });
}

function selectSlot(i) {
  selectedSlot = i;
  selectedSticker = null;
  updateStickerControls();
  positionSlotControls();
}

function attachSlotEvents(i) {
  const { el } = editEls.slots[i];
  const pointers = new Map();
  let drag = null;
  let pinch = null;

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    selectSlot(i);
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const item = editState[i];
    if (pointers.size === 1) {
      drag = { sx: e.clientX, sy: e.clientY, bx: item.box.x, by: item.box.y };
      pinch = null;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, w: item.box.w };
      drag = null;
    }
    el.classList.add('dragging');
  });

  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const item = editState[i];
    const slot = currentSlots()[i];

    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = el.getBoundingClientRect();
      const mx = ((a.x + b.x) / 2 - rect.left) / editScale;
      const my = ((a.y + b.y) / 2 - rect.top) / editScale;
      zoomAt(i, (pinch.w * d / pinch.dist) / item.box.w, mx, my);
    } else if (drag) {
      item.box.x = drag.bx + (e.clientX - drag.sx) / editScale;
      item.box.y = drag.by + (e.clientY - drag.sy) / editScale;
      clampBox(item, slot);
      applyBox(i);
    }
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    const item = editState[i];
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      drag = { sx: p.x, sy: p.y, bx: item.box.x, by: item.box.y };
      pinch = null;
    } else if (pointers.size === 0) {
      drag = null;
      pinch = null;
      el.classList.remove('dragging');
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  // Mouse wheel zoom (desktop)
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    selectSlot(i);
    const rect = el.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / editScale;
    const cy = (e.clientY - rect.top) / editScale;
    zoomAt(i, e.deltaY < 0 ? 1.08 : 1 / 1.08, cx, cy);
  }, { passive: false });
}

function attachHandleEvents(hnd) {
  hnd.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hnd.setPointerCapture(e.pointerId);

    const i = selectedSlot;
    const slot = currentSlots()[i];
    const rect = editStage.getBoundingClientRect();
    const cx = rect.left + (slot.x + slot.w / 2) * editScale;
    const cy = rect.top + (slot.y + slot.h / 2) * editScale;

    handleDrag = {
      i, cx, cy, pid: e.pointerId,
      startDist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      startW: editState[i].box.w
    };
  });

  hnd.addEventListener('pointermove', (e) => {
    if (!handleDrag || e.pointerId !== handleDrag.pid) return;
    const { i, cx, cy, startDist, startW } = handleDrag;
    const slot = currentSlots()[i];
    const d = Math.hypot(e.clientX - cx, e.clientY - cy);
    zoomAt(i, (startW * d / startDist) / editState[i].box.w, slot.w / 2, slot.h / 2);
  });

  const end = () => { handleDrag = null; };
  hnd.addEventListener('pointerup', end);
  hnd.addEventListener('pointercancel', end);
}

// ---------- Stickers ----------
const EMOJI_STICKERS = ['❤️', '💖', '⭐', '✨', '😎', '🥰', '😂', '😜', '🎀', '🌸', '🦋', '🔥',
                        '👑', '🎉', '💫', '🌈', '🍓', '☁️', '🌙', '🤍'];
let stickers = [];          // [{ id, img, x, y, size, rot }]  x,y = centre on the strip
let selectedSticker = null;
let stickerCounter = 0;
const emojiCache = {};

async function emojiToImage(emoji) {
  if (emojiCache[emoji]) return emojiCache[emoji];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.font = '200px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(emoji, 128, 140);
  const img = await loadImage(c.toDataURL('image/png'));
  emojiCache[emoji] = img;
  return img;
}

function buildStickerPalette() {
  stickerListEl.innerHTML = '';
  EMOJI_STICKERS.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stk-btn';
    b.textContent = em;
    b.addEventListener('click', async () => addSticker(await emojiToImage(em)));
    stickerListEl.appendChild(b);
  });

  if (typeof ICONS !== 'undefined') {
    Object.keys(ICONS).forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stk-btn';
      const im = document.createElement('img');
      im.src = ICONS[k];
      im.alt = '';
      b.appendChild(im);
      b.addEventListener('click', async () => addSticker(await loadImage(ICONS[k])));
      stickerListEl.appendChild(b);
    });
  }
}

function addSticker(img) {
  if (!editEls) return;
  if (stickers.length >= 30) { toast('Maximum 30 stickers.'); return; }
  const slot = currentSlots()[selectedSlot] || { x: 0, y: 0, w: STRIP_W, h: STRIP_H };
  const st = {
    id: ++stickerCounter, img,
    x: slot.x + slot.w / 2, y: slot.y + slot.h / 2,
    size: 140, rot: 0
  };
  stickers.push(st);
  createStickerEl(st);
  selectSticker(st.id);
}

function placeSticker(el, st) {
  el.style.left = st.x - st.size / 2 + 'px';
  el.style.top = st.y - st.size / 2 + 'px';
  el.style.width = st.size + 'px';
  el.style.height = st.size + 'px';
  el.style.transform = 'rotate(' + st.rot + 'rad)';
}

function createStickerEl(st) {
  const el = document.createElement('img');
  el.className = 'edit-sticker';
  el.src = st.img.src;
  el.draggable = false;
  placeSticker(el, st);
  editStage.appendChild(el);
  editEls.stickerEls.set(st.id, el);

  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectSticker(st.id);
    el.setPointerCapture(e.pointerId);
    drag = { sx: e.clientX, sy: e.clientY, x: st.x, y: st.y };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    st.x = clamp(drag.x + (e.clientX - drag.sx) / editScale, 0, STRIP_W);
    st.y = clamp(drag.y + (e.clientY - drag.sy) / editScale, 0, STRIP_H);
    placeSticker(el, st);
    updateStickerControls();
  });
  const end = () => { drag = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function createStickerControls() {
  const ctl = document.createElement('div');
  ctl.className = 'stk-ctl';
  ctl.style.display = 'none';

  const del = document.createElement('div');
  del.className = 'stk-del';
  del.textContent = '✕';
  del.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    removeSelectedSticker();
  });

  const hnd = document.createElement('div');
  hnd.className = 'stk-handle';
  let g = null;
  hnd.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const st = stickers.find((s) => s.id === selectedSticker);
    if (!st) return;
    hnd.setPointerCapture(e.pointerId);
    const rect = editStage.getBoundingClientRect();
    const cx = rect.left + st.x * editScale;
    const cy = rect.top + st.y * editScale;
    g = {
      st, cx, cy,
      a0: Math.atan2(e.clientY - cy, e.clientX - cx),
      d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      size0: st.size, rot0: st.rot
    };
  });
  hnd.addEventListener('pointermove', (e) => {
    if (!g) return;
    const a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
    const d = Math.hypot(e.clientX - g.cx, e.clientY - g.cy);
    g.st.size = clamp(g.size0 * d / g.d0, 40, 560);
    g.st.rot = g.rot0 + (a - g.a0);
    placeSticker(editEls.stickerEls.get(g.st.id), g.st);
    updateStickerControls();
  });
  const end = () => { g = null; };
  hnd.addEventListener('pointerup', end);
  hnd.addEventListener('pointercancel', end);

  ctl.append(del, hnd);
  editStage.appendChild(ctl);
  editEls.stkCtl = ctl;
}

function selectSticker(id) {
  selectedSticker = id;
  updateStickerControls();
}

function updateStickerControls() {
  if (!editEls || !editEls.stkCtl) return;
  const ctl = editEls.stkCtl;
  const st = stickers.find((s) => s.id === selectedSticker);
  if (!st) {
    ctl.style.display = 'none';
    editStage.classList.remove('sticker-mode');
    return;
  }
  editStage.classList.add('sticker-mode');
  ctl.style.display = 'block';
  placeSticker(ctl, st);
}

function removeSelectedSticker() {
  const idx = stickers.findIndex((s) => s.id === selectedSticker);
  if (idx < 0) return;
  const el = editEls.stickerEls.get(stickers[idx].id);
  if (el) el.remove();
  editEls.stickerEls.delete(stickers[idx].id);
  stickers.splice(idx, 1);
  selectedSticker = null;
  updateStickerControls();
}

// click on empty stage / press Delete
editStage.addEventListener('pointerdown', (e) => {
  if (e.target === editStage) { selectedSticker = null; updateStickerControls(); }
});
document.addEventListener('keydown', (e) => {
  if (editScreen.classList.contains('hidden')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSticker !== null) {
    e.preventDefault();
    removeSelectedSticker();
  }
});

window.addEventListener('resize', () => {
  if (!editScreen.classList.contains('hidden')) layoutEditor();
});


// ===================== AI AUTO-CROP =====================
// Detect faces in every photo, then centre and zoom each photo on its faces.
async function autoAlign() {
  if (typeof FaceEngine === 'undefined' || !editState) return;
  editAutoCropBtn.disabled = true;
  const old = editAutoCropBtn.textContent;
  editAutoCropBtn.textContent = '⏳ Finding faces…';
  try {
    const slots = currentSlots();
    let found = 0, unavailable = false;
    for (let i = 0; i < editState.length; i++) {
      const item = editState[i], slot = slots[i];
      const faces = await FaceEngine.detectImage(item.img);
      if (faces === null) { unavailable = true; break; }
      if (!faces.length) continue;
      found++;
      const nw = item.img.naturalWidth, nh = item.img.naturalHeight;
      // bounding rectangle of all faces (natural image pixels), padded
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      faces.forEach((f) => {
        x0 = Math.min(x0, f.box.x); y0 = Math.min(y0, f.box.y);
        x1 = Math.max(x1, f.box.x + f.box.w); y1 = Math.max(y1, f.box.y + f.box.h);
      });
      const padX = (x1 - x0) * 0.9, padTop = (y1 - y0) * 0.9, padBot = (y1 - y0) * 0.6;
      x0 -= padX; x1 += padX; y0 -= padTop; y1 += padBot;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);
      // scale so the padded face region just fits inside the slot
      const scale = Math.min(slot.w / rw, slot.h / rh);       // slot px per image px
      let w = nw * scale;
      w = Math.min(item.maxW, Math.max(item.minW, w));
      const k = w / nw;
      item.box.w = w;
      item.box.h = nh * k;
      item.box.x = slot.w / 2 - cx * k;
      item.box.y = slot.h / 2 - cy * k;
      clampBox(item, slot);
      applyBox(i);
    }
    if (unavailable) toast('Face detection needs internet the first time.');
    else toast(found ? 'Aligned faces in ' + found + ' of ' + editState.length + ' photos ✨'
                     : 'No faces found.');
  } finally {
    editAutoCropBtn.disabled = false;
    editAutoCropBtn.textContent = old;
  }
}
editAutoCropBtn.addEventListener('click', autoAlign);

// ---------- Edit screen buttons ----------
editResetBtn.addEventListener('click', () => {
  const slots = currentSlots();
  editState = editState.map((it, i) => makeEditItem(it.img, slots[i]));
  stickers = [];
  selectedSticker = null;
  currentFilter = FILTERS[0];
  buildFilterList();
  renderEditor();
});

editRetakeBtn.addEventListener('click', () => {
  editState = null;
  stickers = [];
  currentStripId = null;
  editScreen.classList.add('hidden');
  boothScreen.classList.remove('hidden');
});

editFinalizeBtn.addEventListener('click', async () => {
  editFinalizeBtn.disabled = true;
  try {
    const blob = await composeStrip();
    if (!currentStripId) currentStripId = 'strip-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      await StripStore.save({
        id: currentStripId, blob,
        templateName: selectedTemplate.name, createdAt: Date.now()
      });
    } catch (err) {
      console.warn('Could not save to gallery:', err);
    }
    editScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    showStrip(blob, false);
    renderGallery();
    if (printAutoEl.checked) printStrip(blob).catch((e) => console.warn('Auto-print failed:', e));
  } catch (err) {
    console.error(err);
    toast('Something went wrong while building the strip.');
  } finally {
    editFinalizeBtn.disabled = false;
  }
});

// ===================== COMPOSE FINAL STRIP =====================
function drawPhoto(ctx, it, slot) {
  const hasFilter = currentFilter.ops.length > 0;

  if (!hasFilter || canvasFilterSupported) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(slot.x, slot.y, slot.w, slot.h);
    ctx.clip();
    if (hasFilter) ctx.filter = filterCss(currentFilter);
    ctx.drawImage(it.img, slot.x + it.box.x, slot.y + it.box.y, it.box.w, it.box.h);
    ctx.restore();
    return;
  }

  // Fallback: filter the pixels by hand, then paste into the strip
  const off = document.createElement('canvas');
  off.width = Math.round(slot.w);
  off.height = Math.round(slot.h);
  const octx = off.getContext('2d');
  octx.drawImage(it.img, it.box.x, it.box.y, it.box.w, it.box.h);
  const data = octx.getImageData(0, 0, off.width, off.height);
  applyOpsToImageData(data, currentFilter.ops);
  octx.putImageData(data, 0, 0);
  ctx.drawImage(off, slot.x, slot.y, slot.w, slot.h);
}

async function composeStrip() {
  const tpl = selectedTemplate;
  const slots = currentSlots();

  const out = document.createElement('canvas');
  out.width = STRIP_W;
  out.height = STRIP_H;
  const ctx = out.getContext('2d');

  // Background
  ctx.fillStyle = tpl.background || '#ffffff';
  ctx.fillRect(0, 0, STRIP_W, STRIP_H);

  // Photos (clipped to their windows) with the chosen filter
  slots.forEach((slot, i) => drawPhoto(ctx, editState[i], slot));

  // Template frame on top
  if (tpl.src) {
    try {
      const frame = await loadImage(tpl.src);
      ctx.drawImage(frame, 0, 0, STRIP_W, STRIP_H);
    } catch (err) {
      console.error('Could not load template:', err);
    }
  }

  // Stickers on top of everything
  stickers.forEach((st) => {
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(st.rot);
    ctx.drawImage(st.img, -st.size / 2, -st.size / 2, st.size, st.size);
    ctx.restore();
  });

  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}

// ===================== 4. RESULT + GALLERY =====================
let currentBlob = null;
let currentUrl = null;
let currentStripId = null;
let viewingPast = false;
let galleryUrls = [];

function showStrip(blob, isPast) {
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentBlob = blob;
  viewingPast = isPast;

  const has = !!blob;
  finalImg.classList.toggle('hidden', !has);
  resultEmpty.classList.toggle('hidden', has);
  [printBtn, downloadBtn, shareBtn].forEach((b) => { b.disabled = !has; });
  // "Edit Again" only for the strip that was just made in this session
  editAgainBtn.classList.toggle('hidden', !(has && !isPast && editState));

  if (has) {
    currentUrl = URL.createObjectURL(blob);
    finalImg.src = currentUrl;
  } else {
    currentUrl = null;
    finalImg.removeAttribute('src');
  }
}

async function renderGallery() {
  galleryUrls.forEach((u) => URL.revokeObjectURL(u));
  galleryUrls = [];
  galleryEl.innerHTML = '';

  let recs = [];
  try {
    recs = (await StripStore.list()).reverse(); // newest first
  } catch (err) {
    console.warn('Gallery not available:', err);
  }

  if (!recs.length) {
    galleryEl.innerHTML = '<p class="muted">Your finished strips will show up here.</p>';
    return;
  }

  recs.forEach((r) => {
    const url = URL.createObjectURL(r.blob);
    galleryUrls.push(url);

    const card = document.createElement('div');
    card.className = 'g-card';

    const im = document.createElement('img');
    im.src = url;
    im.alt = 'Past strip';
    im.title = 'Click to view';
    im.addEventListener('click', () => {
      showStrip(r.blob, true);
      resultScreen.scrollIntoView({ behavior: 'smooth' });
    });

    const meta = document.createElement('div');
    meta.className = 'g-meta';
    meta.textContent = (r.templateName || 'Strip') + ' · ' +
      new Date(r.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'g-del';
    del.textContent = '🗑 Delete';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this strip from the gallery?')) return;
      await StripStore.remove(r.id);
      if (r.id === currentStripId) currentStripId = null;
      await renderGallery();
    });

    card.append(im, meta, del);
    galleryEl.appendChild(card);
  });
}

// ===================== PRINT =====================
const printLayoutEl = $('print-layout');
const printCopiesEl = $('print-copies');
const printAutoEl = $('print-auto');

(function loadPrintPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('ts-print') || '{}');
    if (p.layout) printLayoutEl.value = p.layout;
    if (p.copies) printCopiesEl.value = p.copies;
    printAutoEl.checked = !!p.auto;
  } catch (e) {}
  const save = () => {
    try {
      localStorage.setItem('ts-print', JSON.stringify({
        layout: printLayoutEl.value, copies: printCopiesEl.value, auto: printAutoEl.checked
      }));
    } catch (e) {}
  };
  [printLayoutEl, printCopiesEl, printAutoEl].forEach((el) => el.addEventListener('change', save));
})();

// Prints through a hidden iframe so no pop-up is needed (and kiosk-printing works).
async function printStrip(blob) {
  if (!blob) return;
  const dataUrl = await blobToDataURL(blob);
  const copies = Math.max(1, Math.min(10, parseInt(printCopiesEl.value, 10) || 1));
  const twoUp = printLayoutEl.value === 'twoup';
  // 2-up: one 4x6 sheet holds two 2x6 strips (cut in the middle); copies = sheets
  const sheets = twoUp ? copies : 1;
  const page = twoUp ? '4in 6in' : '2in 6in';
  const imgs = (twoUp ? 2 : 1);

  let html = '<!doctype html><html><head><meta charset="utf-8"><title>Photo strip</title><style>' +
    '@page{size:' + page + ';margin:0}' +
    'html,body{margin:0;padding:0}' +
    '.sheet{width:' + (twoUp ? '4in' : '2in') + ';height:6in;display:flex;page-break-after:always;break-after:page;overflow:hidden}' +
    '.sheet:last-child{page-break-after:auto;break-after:auto}' +
    'img{width:2in;height:6in;display:block}' +
    '</style></head><body>';
  const total = twoUp ? sheets : copies;
  for (let i = 0; i < total; i++) {
    html += '<div class="sheet">' + '<img src="' + dataUrl + '">'.repeat(imgs) + '</div>';
  }
  html += '</body></html>';

  const old = document.getElementById('print-frame');
  if (old) old.remove();
  const f = document.createElement('iframe');
  f.id = 'print-frame';
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
  document.body.appendChild(f);
  const doc = f.contentWindow.document;
  doc.open(); doc.write(html); doc.close();

  const imgEls = Array.from(doc.images);
  await Promise.all(imgEls.map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
  f.contentWindow.focus();
  f.contentWindow.print();
  toast('Sent to printer 🖨️');
}

printBtn.addEventListener('click', () => printStrip(currentBlob).catch((e) => {
  console.error(e); toast('Could not print.');
}));

function downloadBlob(blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'timeless-strip-' + Date.now() + '.png';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

downloadBtn.addEventListener('click', () => {
  if (currentBlob) downloadBlob(currentBlob);
});

shareBtn.addEventListener('click', async () => {
  if (!currentBlob) return;
  const file = new File([currentBlob], 'timeless-strip.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My Timeless Strip' });
    } catch (err) {
      if (err && err.name !== 'AbortError') toast('Could not share: ' + err.message);
    }
  } else {
    downloadBlob(currentBlob);
    toast("Sharing isn't supported on this browser, so the strip was saved instead.");
  }
});

editAgainBtn.addEventListener('click', () => {
  if (!editState) return;
  resultScreen.classList.add('hidden');
  editScreen.classList.remove('hidden');
  buildFilterList();
  renderEditor();
});

newStripBtn.addEventListener('click', () => {
  editState = null;
  stickers = [];
  currentStripId = null;
  resultScreen.classList.add('hidden');
  boothScreen.classList.remove('hidden');
});

homeBtn.addEventListener('click', () => location.reload());

galleryBtn.addEventListener('click', async () => {
  boothScreen.classList.add('hidden');
  resultScreen.classList.remove('hidden');
  await renderGallery();
  const first = galleryEl.querySelector('.g-card img');
  if (first) first.click(); else showStrip(null, true);
  window.scrollTo(0, 0);
});

// ===================== FLASH + SHUTTER SOUND =====================
function triggerFlash() {
  flashEl.classList.remove('flash-on');
  void flashEl.offsetWidth; // restart the animation
  flashEl.classList.add('flash-on');
}

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Synthesized camera "click" (no audio file needed)
function playShutter() {
  const ctx = getAudioCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.12);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1200;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.6, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(now);
}

// ===================== ANIMATED BACKGROUND =====================
(function loadIcons() {
  document.querySelectorAll('img[data-icon]').forEach((img) => {
    if (typeof ICONS !== 'undefined' && ICONS[img.dataset.icon]) {
      img.src = ICONS[img.dataset.icon];
    } else {
      img.remove(); // icons.js missing: just skip the icon
      console.warn('icons.js not found - make sure it is next to index.html');
    }
  });
})();

(function createSparkles() {
  const box = $('bg-sparkles');
  if (!box) return;

  const COUNT = 30;
  for (let i = 0; i < COUNT; i++) {
    const sp = document.createElement('span');
    sp.className = 'sparkle' + (Math.random() < 0.35 ? ' gold' : '');

    const size = 10 + Math.random() * 26;           // 10 - 36 px
    const duration = 2.8 + Math.random() * 3.2;     // 2.8 - 6 s
    sp.style.width = size + 'px';
    sp.style.height = size + 'px';
    sp.style.left = Math.random() * 100 + '%';
    sp.style.top = Math.random() * 100 + '%';
    sp.style.animationDuration = duration + 's';
    sp.style.animationDelay = -Math.random() * duration + 's';

    box.appendChild(sp);
  }
})();


// ===================== START =====================
buildStickerPalette();


// ===================== OFFLINE MODE + CLOUD BADGE =====================
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline mode unavailable:', e));
}

(function netBadge() {
  const badge = $('net-badge');
  if (!badge) return;
  let cloud = { state: 'off' };
  function paint() {
    const online = navigator.onLine;
    let text = online ? '● Online' : '○ Offline – working locally';
    let cls = online ? 'net-online' : 'net-offline';
    if (typeof CloudSync !== 'undefined' && CloudSync.enabled()) {
      if (cloud.state === 'syncing') text += ' · ☁ syncing…';
      else if (cloud.state === 'ok') text += cloud.live ? ' · ☁ live' : ' · ☁ synced';
      else if (cloud.state === 'error') { text += ' · ☁ sync error'; cls = 'net-error'; }
      else if (!online) text += ' · ☁ will sync later';
    }
    badge.textContent = text;
    badge.className = cls;
  }
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  if (typeof CloudSync !== 'undefined') {
    CloudSync.onStatus((st) => { cloud = st; paint(); });
    // another device changed something: refresh templates + gallery
    CloudSync.onPulled(() => {
      if (typeof refreshTemplates === 'function') refreshTemplates();
      if (!resultScreen.classList.contains('hidden')) renderGallery();
    });
  }
  paint();
})();