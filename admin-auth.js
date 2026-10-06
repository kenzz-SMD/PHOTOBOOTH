// ===================== ADMIN LOGIN GATE =====================
// The admin dashboard stays hidden until a Supabase Auth admin signs in. The real protection is
// on the server: only admins listed in ts_admins can write templates (see supabase-setup.sql).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const msg = $('login-msg');
  const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
  const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel', 'mousemove'];
  let idleTimer = 0;
  let lastActivity = 0;

  function clearIdleTimer() {
    window.clearTimeout(idleTimer);
    idleTimer = 0;
  }

  function lock(reason) {
    clearIdleTimer();
    if (typeof CloudSync !== 'undefined') CloudSync.logout();
    document.body.classList.add('locked');
    delete document.body.dataset.tab;
    $('login-pass').value = '';
    msg.className = reason ? 'small login-err' : 'muted small';
    msg.textContent = reason || '';
    window.dispatchEvent(new Event('admin-locked'));
    if (reason) $('login-email').focus();
  }

  function scheduleIdleLock() {
    clearIdleTimer();
    if (document.body.classList.contains('locked')) return;
    const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivity);
    if (remaining <= 0) {
      lock('You were signed out after 3 minutes of inactivity. Sign in to continue.');
      return;
    }
    idleTimer = window.setTimeout(scheduleIdleLock, remaining);
  }

  function recordActivity() {
    if (document.body.classList.contains('locked')) return;
    lastActivity = Date.now();
    scheduleIdleLock();
  }

  function unlock() {
    document.body.classList.remove('locked');
    lastActivity = Date.now();
    scheduleIdleLock();
    window.dispatchEvent(new Event('admin-unlocked'));
    if (typeof CloudSync !== 'undefined') CloudSync.sync();
  }

  ACTIVITY_EVENTS.forEach((eventName) => {
    document.addEventListener(eventName, recordActivity, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || document.body.classList.contains('locked')) return;
    scheduleIdleLock();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'ts-cloud-session' && event.oldValue &&
        (!event.newValue || event.newValue === 'null') &&
        !document.body.classList.contains('locked')) {
      lock('Your admin session ended in another tab. Sign in again to continue.');
    }
  });

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
      try {
        if (await CloudSync.restoreSession()) { unlock(); return done(); }
      } catch (error) {
        console.error('Could not restore the admin session:', error);
        msg.textContent = 'Your saved sign-in could not be verified. Please sign in again.';
      }
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

  $('logout-btn').addEventListener('click', () => {
    lock('');
    msg.textContent = 'You have been signed out.';
    $('login-email').focus();
  });
  boot();
})();