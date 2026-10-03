// ===================== ADMIN LOGIN GATE =====================
// The admin dashboard stays hidden until a Supabase Auth admin signs in. The real protection is
// on the server: only admins listed in ts_admins can write templates (see supabase-setup.sql).
(function () {
  const $ = (id) => document.getElementById(id);
  const msg = $('login-msg');
  const unlock = () => { document.body.classList.remove('locked'); if (typeof CloudSync !== 'undefined') CloudSync.sync(); };

  const card0 = $('login-form');
  // Once the entrance animation is done, drop it so later class changes never replay it
  card0.addEventListener('animationend', (e) => {
    if (e.animationName === 'cardRise') card0.classList.add('ready');
    if (e.animationName === 'shake') card0.classList.remove('shake');
  });

  async function boot() {
    const done = () => document.body.classList.remove('booting');
    if (typeof CloudSync === 'undefined' || !CloudSync.getConfig()) {
      msg.textContent = 'Cloud is not configured. Fill in cloud-config.js first.';
      return done();
    }
    // Already signed in on this device? Go straight to the dashboard without flashing the login.
    if (CloudSync.adminEmail) {
      try { if (await CloudSync.restoreSession()) { unlock(); return done(); } } catch (e) {}
    }
    done();
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (typeof CloudSync === 'undefined' || !CloudSync.getConfig()) { msg.textContent = 'Cloud is not configured.'; return; }
    const card = $('login-form'), btn = $('login-btn');
    msg.className = 'muted small';
    msg.textContent = 'Signing in…';
    btn.disabled = true; btn.classList.add('loading'); btn.textContent = 'Signing in';
    try {
      await CloudSync.login($('login-email').value.trim(), $('login-pass').value);
      $('login-pass').value = '';
      msg.textContent = 'Welcome back! ✨';
      card.classList.add('success');
      setTimeout(() => { unlock(); card.classList.remove('success'); }, 650);
    } catch (err) {
      msg.className = 'small login-err';
      msg.textContent = err.message;
      card.classList.remove('shake'); void card.offsetWidth;   // restart the shake animation
      card.classList.add('shake');
    } finally {
      btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'Sign in';
    }
  });

  $('pw-toggle').addEventListener('click', () => {
    const p = $('login-pass'), show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    $('pw-toggle').textContent = show ? '🙈' : '👁️';
  });

  $('logout-btn').addEventListener('click', () => { CloudSync.logout(); location.reload(); });
  boot();
})();