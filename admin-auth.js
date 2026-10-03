// ===================== ADMIN LOGIN GATE =====================
// The admin dashboard stays hidden until a Supabase Auth admin signs in. The real protection is
// on the server: only admins listed in ts_admins can write templates (see supabase-setup.sql).
(function () {
  const $ = (id) => document.getElementById(id);
  const msg = $('login-msg');
  const unlock = () => { document.body.classList.remove('locked'); if (typeof CloudSync !== 'undefined') CloudSync.sync(); };

  async function boot() {
    if (typeof CloudSync === 'undefined' || !CloudSync.getConfig()) {
      msg.textContent = 'Cloud is not configured. Fill in cloud-config.js first.';
      return;
    }
    if (await CloudSync.restoreSession()) unlock();
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (typeof CloudSync === 'undefined' || !CloudSync.getConfig()) { msg.textContent = 'Cloud is not configured.'; return; }
    const card = $('login-form'), btn = $('login-btn');
    card.classList.remove('shake');
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
      void card.offsetWidth;                 // restart the shake animation
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