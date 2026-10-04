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
  const SEGMENTER_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/' +
                          'selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite';

  let libP = null;
  const pending = {};   // 'IMAGE' | 'VIDEO' -> promise of detector
  const ready = {};     // 'IMAGE' | 'VIDEO' -> detector (for synchronous use)
  let failed = false;
  let segmenterP = null;
  let segmenter = null;

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

  async function initSegmenter() {
    if (!segmenterP) {
      segmenterP = lib().then(async ({ m, files }) => {
        const options = (delegate) => m.ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true
        });
        try { return await options('GPU'); }
        catch (e) { return options('CPU'); }
      }).then((instance) => {
        segmenter = instance;
        return true;
      }).catch((e) => {
        segmenterP = null;
        console.warn('Background segmentation unavailable:', e);
        return false;
      });
    }
    return segmenterP;
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

  // ---- Tracking + smoothing: removes the shake from raw per-frame detections ----
  // 1) Denoise: each detection is blended into a tracked face. Tiny movements (sensor jitter)
  //    are almost ignored; real head movement passes through quickly, so it doesn't lag.
  // 2) Ease: every drawn frame (60 fps) glides toward that target, so motion looks fluid
  //    even though detection runs at ~30 fps.
  // 3) Hold: if detection misses a face for a few frames, the last position is kept (no flicker).
  const tracks = [];
  let lastStep = 0;
  const MAX_MISS = 8;
  const cloneFace = (f) => ({ box: Object.assign({}, f.box), kp: f.kp.map((k) => ({ x: k.x, y: k.y })) });
  const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const mix = (a, b, t) => a + (b - a) * t;

  function denoise(t, r) {
    const c0 = mid(t.box), c1 = mid(r.box);
    const speed = Math.hypot(c1.x - c0.x, c1.y - c0.y) / (t.box.w || 1);   // fraction of face width
    const a = speed < 0.004 ? 0.05 : Math.min(1, 0.1 + speed * 9);
    t.box.x = mix(t.box.x, r.box.x, a);
    t.box.y = mix(t.box.y, r.box.y, a);
    t.box.w = mix(t.box.w, r.box.w, Math.min(a, 0.12));      // size changes slowly
    t.box.h = mix(t.box.h, r.box.h, Math.min(a, 0.12));
    if (t.kp.length === r.kp.length) {
      t.kp.forEach((k, i) => { k.x = mix(k.x, r.kp[i].x, a); k.y = mix(k.y, r.kp[i].y, a); });
    } else { t.kp = r.kp.map((k) => ({ x: k.x, y: k.y })); }
  }

  function updateTracks(raw) {
    const used = new Set();
    raw.forEach((r) => {
      const rc = mid(r.box);
      let best = -1, bd = Infinity;
      tracks.forEach((tr, i) => {
        if (used.has(i)) return;
        const c = mid(tr.t.box), d = Math.hypot(c.x - rc.x, c.y - rc.y);
        if (d < bd) { bd = d; best = i; }
      });
      if (best >= 0 && bd < tracks[best].t.box.w * 0.9) {
        denoise(tracks[best].t, r); tracks[best].miss = 0; used.add(best);
      } else {
        tracks.push({ t: cloneFace(r), c: cloneFace(r), miss: 0 });
        used.add(tracks.length - 1);
      }
    });
    for (let i = tracks.length - 1; i >= 0; i--) {
      if (used.has(i)) continue;
      if (++tracks[i].miss > MAX_MISS) tracks.splice(i, 1);
    }
  }

  function ease(k) {
    tracks.forEach(({ c, t }) => {
      ['x', 'y', 'w', 'h'].forEach((p) => { c.box[p] = mix(c.box[p], t.box[p], k); });
      if (c.kp.length !== t.kp.length) { c.kp = t.kp.map((q) => ({ x: q.x, y: q.y })); return; }
      c.kp.forEach((q, i) => { q.x = mix(q.x, t.kp[i].x, k); q.y = mix(q.y, t.kp[i].y, k); });
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

    initSegmenter,

    segmentVideo(video, ts) {
      if (!segmenter || !video.videoWidth) return null;
      let result;
      try {
        result = segmenter.segmentForVideo(video, ts);
        const masks = result.confidenceMasks || [];
        const personMask = masks[masks.length > 1 ? 1 : 0];
        if (!personMask) return null;
        return {
          data: personMask.getAsFloat32Array().slice(),
          width: personMask.width,
          height: personMask.height
        };
      } catch (e) {
        console.warn('Background segmentation frame failed:', e);
        return null;
      } finally {
        if (result && result.confidenceMasks) {
          result.confidenceMasks.forEach((mask) => mask.close());
        }
        if (result && result.categoryMask) result.categoryMask.close();
      }
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
      try {
        updateTracks(normalize(det.detectForVideo(video, ts), video.videoWidth, video.videoHeight));
        return tracks.map((tr) => tr.c);
      } catch (e) { return null; }
    },

    // Call once per drawn frame: glides the faces toward their latest position, returns them
    step() {
      const now = performance.now();
      const dt = Math.min(100, lastStep ? now - lastStep : 16);
      lastStep = now;
      ease(1 - Math.exp(-dt / 40));
      return tracks.map((tr) => tr.c);
    },

    reset() { tracks.length = 0; }
  };
})();

// ===================== AR FILTER DRAWING =====================
const AR_FILTERS = [
  { id: 'none',     name: 'None',        icon: '🚫' },
  { id: 'shades',   name: 'Shades',      icon: '🕶️' },
  { id: 'glasses',  name: 'Glasses',     icon: '🤓' },
  { id: 'hearts',   name: 'Heart eyes',  icon: '😍' },
  { id: 'mask',     name: 'Face mask',   icon: '😷' },
  { id: 'mustache', name: 'Mustache',    icon: '🥸' },
  { id: 'tophat',   name: 'Top hat',     icon: '🎩' },
  { id: 'crown',    name: 'Crown',       icon: '👑' },
  { id: 'grad',     name: 'Grad cap',    icon: '🎓' },
  { id: 'catears',  name: 'Cat ears',    icon: '🐱' },
  { id: 'clown',    name: 'Clown nose',  icon: '🤡' },
  { id: 'catface',  name: 'Cat face',    icon: '😺' },
  { id: 'bunny',    name: 'Bunny ears',  icon: '🐰' },
  { id: 'floppy',   name: 'Floppy ears', icon: '🐇' }
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

function arRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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
    case 'glasses': {
      ctx.save();
      ctx.translate(g.ec.x, g.ec.y);
      ctx.rotate(g.angle);
      ctx.lineWidth = Math.max(2, g.eyeDist * 0.1);
      ctx.strokeStyle = '#342b46';
      ctx.fillStyle = 'rgba(203, 232, 255, 0.42)';
      [-1, 1].forEach((side) => {
        arRoundRect(ctx, side * g.eyeDist * 0.55 - g.eyeDist * 0.48, -g.eyeDist * 0.36, g.eyeDist * 0.96, g.eyeDist * 0.72, g.eyeDist * 0.18);
        ctx.fill();
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(-g.eyeDist * 0.1, 0);
      ctx.lineTo(g.eyeDist * 0.1, 0);
      ctx.moveTo(-g.eyeDist * 1.05, -g.eyeDist * 0.12);
      ctx.lineTo(-g.eyeDist * 1.32, -g.eyeDist * 0.2);
      ctx.moveTo(g.eyeDist * 1.05, -g.eyeDist * 0.12);
      ctx.lineTo(g.eyeDist * 1.32, -g.eyeDist * 0.2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'mask': {
      const p = at(-g.fh * 0.3, 0);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(g.angle);
      ctx.fillStyle = '#a9e6d2';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, g.fw * 0.018);
      arRoundRect(ctx, -g.fw * 0.4, -g.fh * 0.13, g.fw * 0.8, g.fh * 0.38, g.fw * 0.12);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(54, 126, 117, 0.55)';
      ctx.lineWidth = Math.max(1, g.fw * 0.012);
      [-0.04, 0.05, 0.14].forEach((y) => {
        ctx.beginPath();
        ctx.moveTo(-g.fw * 0.3, g.fh * y);
        ctx.lineTo(g.fw * 0.3, g.fh * y);
        ctx.stroke();
      });
      ctx.restore();
      break;
    }
    case 'mustache': {
      const p = at(-g.fh * 0.34, 0);
      arEmoji(ctx, '🥸', p.x, p.y, g.eyeDist * 2.2, g.angle);
      break;
    }
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
    case 'bunny':  drawBunnyEars(ctx, g, false); break;
    case 'floppy': drawBunnyEars(ctx, g, true);  break;
    case 'catface': {
      const c = { x: (g.ec.x + g.nose.x) / 2, y: (g.ec.y + g.nose.y) / 2 };
      arEmoji(ctx, '😺', c.x, c.y, g.fw * 1.5, g.angle);
      break;
    }
  }
}

// One fluffy bunny ear drawn pointing "up" (negative y) from its base at (0,0)
function arBunnyEar(ctx, w, h) {
  const shape = (ew, eh, y0) => {
    ctx.beginPath();
    ctx.moveTo(-ew / 2, y0);
    ctx.bezierCurveTo(-ew * 0.75, y0 - eh * 0.5, -ew * 0.5, y0 - eh, 0, y0 - eh);
    ctx.bezierCurveTo(ew * 0.5, y0 - eh, ew * 0.75, y0 - eh * 0.5, ew / 2, y0);
    ctx.closePath();
  };
  shape(w, h, 0);                                   // fluffy outer ear
  ctx.fillStyle = '#f3f6f6'; ctx.fill();
  ctx.lineWidth = Math.max(1.5, w * 0.07); ctx.strokeStyle = '#c9d6d6'; ctx.stroke();
  shape(w * 0.52, h * 0.78, -h * 0.05);             // pink inner ear
  const g = ctx.createLinearGradient(0, 0, 0, -h);
  g.addColorStop(0, '#e86f9a'); g.addColorStop(1, '#f7a8c4');
  ctx.fillStyle = g; ctx.fill();
}

// Bunny ears on a headband (ears only - no nose). floppy = ears droop to the sides.
function drawBunnyEars(ctx, g, floppy) {
  const fw = g.fw, fh = g.fh;
  ctx.save();
  ctx.translate(g.ec.x, g.ec.y);
  ctx.rotate(g.angle);                              // local frame: x = along the eyes, -y = up
  const cy = -fh * 0.15, rx = fw * 0.56, ry = fh * 0.47;
  const onBand = (x) => cy - ry * Math.sqrt(Math.max(0, 1 - (x / rx) * (x / rx)));

  [-1, 1].forEach((side) => {                       // ears sit behind the band
    const x = side * fw * (floppy ? 0.3 : 0.2);
    ctx.save();
    ctx.translate(x, onBand(x) + fh * 0.02);
    ctx.rotate(floppy ? side * 1.2 : side * 0.14);
    arBunnyEar(ctx, fw * (floppy ? 0.34 : 0.28), fw * (floppy ? 0.62 : 0.85));
    ctx.restore();
  });

  ctx.lineCap = 'round';                            // headband on top of the ear bases
  ctx.beginPath();
  ctx.ellipse(0, cy, rx, ry, 0, Math.PI, Math.PI * 2);
  ctx.lineWidth = fw * 0.055; ctx.strokeStyle = '#e6eded'; ctx.stroke();
  ctx.lineWidth = fw * 0.02;  ctx.strokeStyle = '#f08bb0'; ctx.stroke();
  ctx.restore();
}

function drawArFaces(ctx, faces, id) {
  if (!id || id === 'none' || !faces) return;
  faces.forEach((f) => drawArFace(ctx, f, id));
}