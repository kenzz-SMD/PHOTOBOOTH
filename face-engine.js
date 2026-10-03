// ===================== FACE ENGINE + AR FILTERS =====================
// Face detection (MediaPipe Tasks Vision, loaded from a CDN the first time and then
// cached by the service worker so it keeps working offline) used for:
//   * AI auto-crop   - centre + zoom each photo on the faces
//   * AR face filters - hats, glasses, ears... drawn on the live camera and burned into photos
//
// Every function fails gracefully: if the library can't be loaded (first visit while
// offline) the booth simply works without face features.

const FaceEngine = (() => {
  const VER = '0.10.14';
  const BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + VER + '/vision_bundle.mjs';
  const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + VER + '/wasm';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/' +
                'blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

  let libP = null;
  const pending = {};   // 'IMAGE' | 'VIDEO' -> promise of detector
  const ready = {};     // 'IMAGE' | 'VIDEO' -> detector (for synchronous use)
  let failed = false;

  function lib() {
    if (!libP) {
      libP = import(BUNDLE)
        .then(async (m) => ({ m, files: await m.FilesetResolver.forVisionTasks(WASM) }))
        .catch((e) => { libP = null; throw e; });
    }
    return libP;
  }

  async function create(mode) {
    const { m, files } = await lib();
    const make = (delegate) => m.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: mode,
      minDetectionConfidence: 0.5
    });
    try { return await make('GPU'); } catch (e) { return await make('CPU'); }
  }

  function get(mode) {
    if (!pending[mode]) {
      pending[mode] = create(mode).then((d) => { ready[mode] = d; failed = false; return d; });
      pending[mode].catch(() => { delete pending[mode]; failed = true; });
    }
    return pending[mode];
  }

  // kp order: [rightEye, leftEye, nose, mouth, rightEar, leftEar]
  function normalize(result, w, h) {
    return (result.detections || []).map((d) => {
      const b = d.boundingBox;
      return {
        box: { x: b.originX, y: b.originY, w: b.width, h: b.height },
        kp: (d.keypoints || []).map((k) => ({ x: k.x * w, y: k.y * h }))
      };
    });
  }

  return {
    get failed() { return failed; },

    // Start downloading / warming the models (safe to call many times)
    preload() { return get('IMAGE').catch(() => null); },

    async initVideo() {
      try { await get('VIDEO'); return true; }
      catch (e) { console.warn('AR face detection unavailable:', e); return false; }
    },

    // Faces in a still image / canvas. Returns null when the engine isn't available.
    async detectImage(src) {
      try {
        const det = await get('IMAGE');
        const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
        return normalize(det.detect(src), w, h);
      } catch (e) { console.warn('Face detection unavailable:', e); return null; }
    },

    // Synchronous - returns null until initVideo() has resolved true
    detectVideo(video, ts) {
      const det = ready.VIDEO;
      if (!det || !video.videoWidth) return null;
      try { return normalize(det.detectForVideo(video, ts), video.videoWidth, video.videoHeight); }
      catch (e) { return null; }
    }
  };
})();

// ===================== AR FILTER DRAWING =====================
const AR_FILTERS = [
  { id: 'none',     name: 'None',        icon: '🚫' },
  { id: 'shades',   name: 'Shades',      icon: '🕶️' },
  { id: 'hearts',   name: 'Heart eyes',  icon: '😍' },
  { id: 'tophat',   name: 'Top hat',     icon: '🎩' },
  { id: 'crown',    name: 'Crown',       icon: '👑' },
  { id: 'grad',     name: 'Grad cap',    icon: '🎓' },
  { id: 'catears',  name: 'Cat ears',    icon: '🐱' },
  { id: 'clown',    name: 'Clown nose',  icon: '🤡' },
  { id: 'catface',  name: 'Cat face',    icon: '😺' }
];

const AR_EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function arEmoji(ctx, emoji, x, y, size, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot || 0);
  ctx.font = Math.round(size) + 'px ' + AR_EMOJI_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, 0);
  ctx.restore();
}

function arTriangle(ctx, a, b, c, fill) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// Geometry helpers every filter needs
function arGeometry(face) {
  const k = face.kp;
  const b = face.box;
  let eA = k[0] || { x: b.x + b.w * 0.3, y: b.y + b.h * 0.4 };
  let eB = k[1] || { x: b.x + b.w * 0.7, y: b.y + b.h * 0.4 };
  if (eA.x > eB.x) { const t = eA; eA = eB; eB = t; }          // eA = left in image
  const ec = { x: (eA.x + eB.x) / 2, y: (eA.y + eB.y) / 2 };
  const angle = Math.atan2(eB.y - eA.y, eB.x - eA.x);
  const right = { x: Math.cos(angle), y: Math.sin(angle) };     // along the eyes
  const up = { x: Math.sin(angle), y: -Math.cos(angle) };       // towards forehead
  const nose = k[2] || { x: ec.x - up.x * b.h * 0.25, y: ec.y - up.y * b.h * 0.25 };
  return { eA, eB, ec, angle, right, up, nose, fw: b.w, fh: b.h, eyeDist: Math.hypot(eB.x - eA.x, eB.y - eA.y) };
}

function drawArFace(ctx, face, id) {
  const g = arGeometry(face);
  // point relative to the eye centre: u along "up", r along "right"
  const at = (u, r) => ({
    x: g.ec.x + g.up.x * u + g.right.x * r,
    y: g.ec.y + g.up.y * u + g.right.y * r
  });

  switch (id) {
    case 'shades':
      arEmoji(ctx, '🕶️', g.ec.x, g.ec.y, g.eyeDist * 2.7, g.angle);
      break;
    case 'hearts':
      arEmoji(ctx, '❤️', g.eA.x, g.eA.y, g.eyeDist * 0.95, g.angle);
      arEmoji(ctx, '❤️', g.eB.x, g.eB.y, g.eyeDist * 0.95, g.angle);
      break;
    case 'tophat': {
      const p = at(g.fh * 0.72, 0);
      arEmoji(ctx, '🎩', p.x, p.y, g.fw * 1.25, g.angle);
      break;
    }
    case 'crown': {
      const p = at(g.fh * 0.68, 0);
      arEmoji(ctx, '👑', p.x, p.y, g.fw * 1.0, g.angle);
      break;
    }
    case 'grad': {
      const p = at(g.fh * 0.7, 0);
      arEmoji(ctx, '🎓', p.x, p.y, g.fw * 1.35, g.angle);
      break;
    }
    case 'catears':
      [-1, 1].forEach((side) => {
        const base = at(g.fh * 0.5, side * g.fw * 0.3);
        const half = g.fw * 0.15;
        const b1 = { x: base.x - g.right.x * half, y: base.y - g.right.y * half };
        const b2 = { x: base.x + g.right.x * half, y: base.y + g.right.y * half };
        const tip = {
          x: base.x + g.up.x * g.fw * 0.42 + g.right.x * side * g.fw * 0.06,
          y: base.y + g.up.y * g.fw * 0.42 + g.right.y * side * g.fw * 0.06
        };
        arTriangle(ctx, b1, b2, tip, '#2b2b2b');
        const i1 = { x: b1.x * 0.7 + b2.x * 0.3, y: b1.y * 0.7 + b2.y * 0.3 };
        const i2 = { x: b1.x * 0.3 + b2.x * 0.7, y: b1.y * 0.3 + b2.y * 0.7 };
        const itip = { x: base.x + (tip.x - base.x) * 0.7, y: base.y + (tip.y - base.y) * 0.7 };
        arTriangle(ctx, i1, i2, itip, '#ff8fb0');
      });
      break;
    case 'clown': {
      const r = g.fw * 0.11;
      ctx.save();
      ctx.beginPath();
      ctx.arc(g.nose.x, g.nose.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#e8203a';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(g.nose.x - r * 0.3, g.nose.y - r * 0.35, r * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'catface': {
      const c = { x: (g.ec.x + g.nose.x) / 2, y: (g.ec.y + g.nose.y) / 2 };
      arEmoji(ctx, '😺', c.x, c.y, g.fw * 1.5, g.angle);
      break;
    }
  }
}

function drawArFaces(ctx, faces, id) {
  if (!id || id === 'none' || !faces) return;
  faces.forEach((f) => drawArFace(ctx, f, id));
}