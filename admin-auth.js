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
    msg.textContent = 'Signing in…';
    try {
      await CloudSync.login($('login-email').value.trim(), $('login-pass').value);
      $('login-pass').value = '';
      msg.textContent = '';
      unlock();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  $('logout-btn').addEventListener('click', () => { CloudSync.logout(); location.reload(); });
  boot();
})();