// ===================== CELEBRATION + LOADING EFFECTS =====================
// Fx.confetti()                    - colourful burst (canvas, ~3 s, removes itself)
// Fx.loading.show(key, {delay})    - fun "developing your photos" overlay; Fx.loading.hide()
// Pure code, no image/GIF files, so it stays light. Skipped for people who prefer reduced motion.
const Fx = (() => {
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tr = (k, d) => (typeof I18N !== 'undefined' ? I18N.t(k) : d);

  // ---------------- confetti ----------------
  const COLORS = ['#ff6b81', '#ff9a56', '#ffd166', '#34d399', '#60a5fa', '#c084fc', '#ff8fab', '#ffffff'];
  let running = false;

  function confetti(opts) {
    if (reduce() || running) return;
    const o = Object.assign({ count: 150 }, opts || {});
    running = true;
    const cv = document.createElement('canvas');
    cv.id = 'fx-confetti';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    const parts = [];
    const add = (x, y, vx, vy) => parts.push({
      x, y, vx, vy, w: 6 + Math.random() * 8, h: 10 + Math.random() * 10, rot: Math.random() * 6.28,
      vr: (Math.random() - .5) * .35, color: COLORS[(Math.random() * COLORS.length) | 0],
      shape: Math.random() < .25 ? 'heart' : Math.random() < .5 ? 'dot' : 'rect', wob: Math.random() * 6.28, life: 0
    });
    // two cannons from the bottom corners + a shower from the top
    for (let i = 0; i < o.count; i++) {
      const side = i % 3;
      if (side === 0) add(0, H, 7 + Math.random() * 9, -(13 + Math.random() * 12));
      else if (side === 1) add(W, H, -(7 + Math.random() * 9), -(13 + Math.random() * 12));
      else add(Math.random() * W, -20 - Math.random() * H * .3, (Math.random() - .5) * 3, 1 + Math.random() * 3);
    }

    function heart(c, s) {
      c.beginPath();
      c.moveTo(0, s * .3);
      c.bezierCurveTo(-s, -s * .4, -s * .5, -s, 0, -s * .4);
      c.bezierCurveTo(s * .5, -s, s, -s * .4, 0, s * .3);
      c.fill();
    }

    const start = performance.now();
    (function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        p.life++;
        p.vy += .32; p.vx *= .992; p.vy *= .992;           // gravity + air drag
        p.x += p.vx + Math.sin(p.wob + p.life * .08) * .6;
        p.y += p.vy; p.rot += p.vr;
        if (p.y > H + 40) continue;
        alive++;
        const fade = t > 2400 ? Math.max(0, 1 - (t - 2400) / 800) : 1;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life * .1)) + 2);
        else if (p.shape === 'dot') { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 6.28); ctx.fill(); }
        else heart(ctx, p.w);
        ctx.restore();
      }
      if (alive && t < 3200) requestAnimationFrame(frame);
      else { cv.remove(); running = false; }
    })(start);
  }

  // ---------------- loading overlay ----------------
  let el = null, showTimer = null, msgTimer = null, shownAt = 0, hideTimer = null, active = 0;

  function build() {
    el = document.createElement('div');
    el.id = 'fx-loading';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="fxl-card">' +
        '<div class="fxl-strip"><i></i><i></i><i></i><i></i></div>' +
        '<div class="fxl-dots"><b></b><b></b><b></b></div>' +
        '<p class="fxl-msg"></p>' +
      '</div>';
    document.body.appendChild(el);
  }

  function setMsg(key) {
    const keys = key ? [key] : ['load.1', 'load.2', 'load.3'];
    let i = 0;
    const p = el.querySelector('.fxl-msg');
    const put = () => { p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap'); p.textContent = tr(keys[i % keys.length]); i++; };
    put();
    clearInterval(msgTimer);
    if (keys.length > 1) msgTimer = setInterval(put, 1600);
  }

  function reveal(key) {
    if (!el) build();
    clearTimeout(hideTimer);
    setMsg(key);
    shownAt = performance.now();
    el.classList.add('on');
  }

  const loading = {
    // delay: only appear if the work takes longer than this (avoids a flash on fast work)
    show(key, o) {
      active++;
      if (active > 1) return;
      const delay = (o && o.delay) || 0;
      clearTimeout(showTimer);
      if (delay) showTimer = setTimeout(() => reveal(key), delay); else reveal(key);
    },
    hide() {
      active = Math.max(0, active - 1);
      if (active) return;
      clearTimeout(showTimer);
      if (!el || !el.classList.contains('on')) return;
      const wait = Math.max(0, 500 - (performance.now() - shownAt));   // never flash for less than 0.5 s
      hideTimer = setTimeout(() => { el.classList.remove('on'); clearInterval(msgTimer); }, wait);
    }
  };

  return { confetti, loading };
})();