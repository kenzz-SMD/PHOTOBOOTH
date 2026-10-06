// Shared booth payment API. Entitlements and receipts are enforced by Supabase RPCs.
(function () {
  'use strict';
  const ACTIVE_EVENT_KEY = 'ts-pay-active-event';
  const SETTINGS_CACHE_KEY = 'ts-pay-settings-cache';
  let settingsCache = null;
  const readCache = () => {
    if (settingsCache) return settingsCache;
    try { settingsCache = JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || 'null'); } catch (e) {}
    return settingsCache;
  };
  const config = () => {
    if (typeof DeviceTracker !== 'undefined' && DeviceTracker.configured()) {
      return typeof CloudSync !== 'undefined' ? CloudSync.getConfig() : window.CLOUD_CONFIG;
    }
    return null;
  };
  const lib = () => (config() || {}).lib || '';
  const configured = () => !!(config() && lib());
  const rpc = (name, body) => DeviceTracker.rest('rpc/' + name, {
    method: 'POST',
    body: JSON.stringify(Object.assign({ p_lib: lib() }, body))
  });
  const rows = (table, query) => DeviceTracker.rest(table + '?' + query);

  async function load() {
    if (!configured()) return { settings: null, events: [], bundles: [] };
    const key = encodeURIComponent(lib());
    const result = await Promise.all([
      rows('ts_pay_settings', 'select=*&lib=eq.' + key + '&limit=1'),
      rows('ts_pay_events', 'select=*&lib=eq.' + key + '&order=name.asc'),
      rows('ts_pay_bundles', 'select=*&lib=eq.' + key + '&active=eq.true&order=quantity.asc')
    ]);
    const data = { settings: result[0][0] || null, events: result[1] || [], bundles: result[2] || [] };
    settingsCache = { settings: data.settings, events: data.events };
    try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settingsCache)); } catch (e) {}
    return data;
  }

  function activeEventId() {
    try { return localStorage.getItem(ACTIVE_EVENT_KEY) || ''; } catch (e) { return ''; }
  }
  function setActiveEvent(id) {
    if (id) localStorage.setItem(ACTIVE_EVENT_KEY, id);
    else localStorage.removeItem(ACTIVE_EVENT_KEY);
    window.dispatchEvent(new CustomEvent('pay-event-changed', { detail: { id: id || '' } }));
  }

  async function status() {
    if (!configured()) return { enabled: false, free_remaining: 3, free_total: 3, gif_paid: false, strip_paid: false };
    try {
      return await rpc('ts_pay_status', {
        p_event_id: activeEventId(),
        p_device_id: DeviceTracker.deviceId
      });
    } catch (err) {
      const cached = readCache();
      if (!cached || navigator.onLine || (cached.settings && cached.settings.enabled)) throw err;
      return { enabled: false, free_remaining: Number((cached.settings || {}).free_saves || 3),
        free_total: Number((cached.settings || {}).free_saves || 3), gif_paid: false, strip_paid: false };
    }
  }

  function definitelyFreeOffline(mediaType) {
    const cached = readCache();
    if (navigator.onLine || !cached) return false;
    const settings = cached.settings;
    if (!settings || !settings.enabled) return true;
    const event = (cached.events || []).find((row) => row.id === activeEventId());
    if (event && event.charge_mode === 'free') return true;
    const eventFormat = event && event[mediaType + '_paid'];
    const globalFormat = settings[mediaType + '_paid'];
    return eventFormat === false || (eventFormat == null && !globalFormat);
  }

  async function claim(mediaType, requestId) {
    if (!configured()) return { allowed: true, reason: 'unconfigured' };
    try {
      return await rpc('ts_pay_consume_save_once', {
        p_event_id: activeEventId(),
        p_device_id: DeviceTracker.deviceId,
        p_media_type: mediaType,
        p_request_id: requestId || crypto.randomUUID()
      });
    } catch (err) {
      if (definitelyFreeOffline(mediaType)) return { allowed: true, reason: 'offline-free' };
      throw err;
    }
  }

  async function purchase(mediaType, details) {
    if (!configured()) throw new Error('Payment service is not configured.');
    return rpc('ts_pay_purchase_save', {
      p_event_id: activeEventId(),
      p_device_id: DeviceTracker.deviceId,
      p_media_type: mediaType,
      p_voucher: details.voucher || null,
      p_staff_pin: null,
      p_bundle_id: details.bundleId || null
    });
  }

  function createCheckout(mediaType, bundleId) {
    if (!configured()) throw new Error('Payment service is not configured.');
    return DeviceTracker.invokeFunction('create-gcash-checkout', {
      lib: lib(),
      device_id: DeviceTracker.deviceId,
      event_id: activeEventId(),
      media_type: mediaType,
      bundle_id: bundleId || ''
    });
  }

  function createPlanCheckout(planId) {
    if (!configured()) throw new Error('Payment service is not configured.');
    return DeviceTracker.invokeFunction('create-gcash-checkout', {
      lib: lib(),
      device_id: DeviceTracker.deviceId,
      event_id: activeEventId(),
      plan_id: planId
    });
  }

  function paymentStatus(orderId) {
    if (!configured()) throw new Error('Payment service is not configured.');
    return DeviceTracker.invokeFunction('payment-status', {
      order_id: orderId,
      device_id: DeviceTracker.deviceId
    });
  }

  window.PaySystem = {
    configured, lib, activeEventId, setActiveEvent, load, status, claim, purchase, createCheckout, createPlanCheckout, paymentStatus,
    get deviceId() { return typeof DeviceTracker !== 'undefined' ? DeviceTracker.deviceId : ''; }
  };
})();
