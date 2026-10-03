// ===================== TEMPLATES =====================
// Strip size is 600 x 1800 px (2in x 6in print ratio).
// Template images live in the /templates folder (PNG, 600x1800).
// They are drawn ON TOP of the photos, so the photo areas
// ("windows") must be transparent.
//
// To add a template, add one line below.
// "slots" = where each of the 4 photos goes: { x, y, w, h }.
// If your design uses different positions, set custom slots for it.

const STRIP_W = 600;
const STRIP_H = 1800;

const DEFAULT_SLOTS = [0, 1, 2, 3].map((i) => ({
  x: 50, y: 50 + i * 430, w: 500, h: 380
}));

const TEMPLATES = [
  {
    id: 'template1', name: 'Kiss Please', src: 'templates/template1.png',
    slots: [
      { x: 52, y: 75,   w: 483, h: 313 },
      { x: 58, y: 435,  w: 483, h: 313 },
      { x: 52, y: 801,  w: 483, h: 313 },
      { x: 52, y: 1172, w: 483, h: 313 }
    ]
  },
  {
    id: 'template2', name: 'Life in Frames', src: 'templates/template2.png',
    slots: [
      { x: 58, y: 75,   w: 483, h: 313 },
      { x: 58, y: 438,  w: 483, h: 313 },
      { x: 58, y: 801,  w: 483, h: 313 },
      { x: 58, y: 1164, w: 483, h: 313 }
    ]
  },
  // Add more templates here:
  // { id: 'birthday', name: 'Birthday', src: 'templates/birthday.png', slots: [ {x:..,y:..,w:..,h:..}, x4 ] },
];

let selectedTemplate = null;

// ===================== ELEMENTS =====================
const startBtn = document.getElementById('start-btn');
const welcomeScreen = document.getElementById('welcome-screen');
const templateScreen = document.getElementById('template-screen');
const templateList = document.getElementById('template-list');
const templateConfirm = document.getElementById('template-confirm');
const templateLabel = document.getElementById('template-label');
const changeTemplateBtn = document.getElementById('change-template-btn');
const boothScreen = document.getElementById('booth-screen');
const video = document.getElementById('camera');
const stripBtn = document.getElementById('strip-btn');
const canvas = document.getElementById('canvas');
const stripCanvas = document.getElementById('strip-canvas');
const result = document.getElementById('result');
const countdownEl = document.getElementById('countdown');
const printBtn = document.getElementById('print-btn');
const downloadBtn = document.getElementById('download-btn');
const flashEl = document.getElementById('flash');

let cameraStarted = false;

// ===================== STEP 1: WELCOME -> TEMPLATES =====================
startBtn.addEventListener('click', () => {
  welcomeScreen.classList.add('hidden');
  templateScreen.classList.remove('hidden');
});

// Build the template picker
function buildTemplateList() {
  templateList.innerHTML = '';

  TEMPLATES.forEach((tpl) => {
    const card = document.createElement('button');
    card.className = 'template-card';
    card.type = 'button';

    let preview;
    if (tpl.src) {
      preview = document.createElement('img');
      preview.src = tpl.src;
      preview.alt = tpl.name;
      // If the image file doesn't exist yet, don't show the card
      preview.onerror = () => card.remove();
    } else {
      preview = document.createElement('div');
      preview.className = 'template-plain';
      preview.style.background = tpl.background || '#fff';
    }
    preview.classList.add('template-preview');

    const label = document.createElement('span');
    label.textContent = tpl.name;

    card.appendChild(preview);
    card.appendChild(label);

    card.addEventListener('click', () => {
      document.querySelectorAll('.template-card')
        .forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedTemplate = tpl;
      templateConfirm.disabled = false;
    });

    templateList.appendChild(card);
  });
}
buildTemplateList();

// ===================== STEP 2: TEMPLATE -> BOOTH =====================
templateConfirm.addEventListener('click', () => {
  if (!selectedTemplate) return;

  templateScreen.classList.add('hidden');
  boothScreen.classList.remove('hidden');
  templateLabel.textContent = 'Template: ' + selectedTemplate.name;

  // Clear any previous strip made with another template
  result.innerHTML = '';
  printBtn.classList.add('hidden');
  downloadBtn.classList.add('hidden');

  startCamera();
});

changeTemplateBtn.addEventListener('click', () => {
  boothScreen.classList.add('hidden');
  templateScreen.classList.remove('hidden');
});

function startCamera() {
  if (cameraStarted) return;

  navigator.mediaDevices.getUserMedia({ video: true })
    .then((stream) => {
      video.srcObject = stream;
      cameraStarted = true;
    })
    .catch((err) => {
      console.error('Camera error:', err);
      alert('Could not access camera: ' + err.message);
    });
}

// ===================== STEP 3: CAPTURE 4 PHOTOS =====================
stripBtn.addEventListener('click', () => {
  getAudioCtx(); // unlock sound (browsers need a click first)
  stripBtn.disabled = true;
  changeTemplateBtn.disabled = true;
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
    photos.push(canvas.toDataURL('image/png'));

    if (shotNumber < 4) {
      countdownEl.textContent = 'Next shot...';
      setTimeout(() => {
        captureStrip(shotNumber + 1, photos);
      }, 1000);
    } else {
      composeStrip(photos);
    }
  });
}

// ===================== COMPOSE STRIP WITH TEMPLATE =====================
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Draw an image to fill a slot without stretching (center crop)
function drawCover(ctx, img, slot) {
  const scale = Math.max(slot.w / img.width, slot.h / img.height);
  const sw = slot.w / scale;
  const sh = slot.h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h);
}

async function composeStrip(photos) {
  const tpl = selectedTemplate;
  const slots = tpl.slots || DEFAULT_SLOTS;

  stripCanvas.width = STRIP_W;
  stripCanvas.height = STRIP_H;
  const ctx = stripCanvas.getContext('2d');

  // Background
  ctx.fillStyle = tpl.background || '#ffffff';
  ctx.fillRect(0, 0, STRIP_W, STRIP_H);

  // Photos
  const photoImgs = await Promise.all(photos.map(loadImage));
  photoImgs.forEach((img, i) => drawCover(ctx, img, slots[i]));

  // Template frame on top
  if (tpl.src) {
    try {
      const frame = await loadImage(tpl.src);
      ctx.drawImage(frame, 0, 0, STRIP_W, STRIP_H);
    } catch (err) {
      console.error('Could not load template:', err);
    }
  }

  const finalImg = document.createElement('img');
  finalImg.src = stripCanvas.toDataURL('image/png');
  finalImg.className = 'strip';
  finalImg.id = 'final-strip';

  result.innerHTML = '';
  result.appendChild(finalImg);
  printBtn.classList.remove('hidden');
  downloadBtn.classList.remove('hidden');
  stripBtn.disabled = false;
  changeTemplateBtn.disabled = false;
}

// ===================== COUNTDOWN =====================
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

// ===================== PRINT =====================
printBtn.addEventListener('click', () => {
  const img = document.getElementById('final-strip');
  if (!img) return;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
      <head>
        <title>Print Photo Strip</title>
        <style>
          @page { size: 2in 6in; margin: 0; }
          body { margin: 0; display: flex; justify-content: center; align-items: center; }
          img { width: 2in; height: 6in; }
        </style>
      </head>
      <body>
        <img src="${img.src}">
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
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

// ===================== DOWNLOAD =====================
downloadBtn.addEventListener('click', () => {
  const img = document.getElementById('final-strip');
  if (!img) return;

  const link = document.createElement('a');
  link.href = img.src;
  link.download = 'photostrip-' + Date.now() + '.png';
  document.body.appendChild(link);
  link.click();
  link.remove();
});