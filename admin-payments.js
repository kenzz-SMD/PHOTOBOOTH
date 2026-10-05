// Payment settings, event overrides, counter vouchers and sales reporting.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const libFilter = () => 'lib=eq.' + encodeURIComponent(PaySystem.lib());
  const jsonHeaders = { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  let events = [];
  let bundles = [];
  let started = false;

  function createCard() {
    if ($('pay-card')) return;
    const card = document.createElement('section');
    card.id = 'pay-card';
    card.className = 'card pay-card';
    card.innerHTML =
      '<h2>💳 Paid saves <span id="pay-state" class="pill">Loading</span></h2>' +
      '<p class="muted small">Free saves are shared across GIFs and strips on this device, per event. Payment, vouchers and sales require an online Supabase connection. Run the updated <code>supabase-setup.sql</code> in Supabase SQL Editor to enable these controls.</p>' +
      '<div class="pay-block"><h3>Booth setup</h3><div class="pay-grid">' +
        '<label class="pay-toggle"><input id="pay-enabled" type="checkbox"> Turn on paid saves</label>' +
        '<label>Free saves per device<input id="pay-free" type="number" min="0" step="1" value="3"></label>' +
        '<label><span><input id="pay-gif-on" type="checkbox"> Charge for GIF saves</span><input id="pay-gif-price" type="number" min="0" step="0.01" value="20" aria-label="GIF price in pesos"></label>' +
        '<label><span><input id="pay-strip-on" type="checkbox"> Charge for strip saves</span><input id="pay-strip-price" type="number" min="0" step="0.01" value="20" aria-label="Strip price in pesos"></label>' +
      '</div><button id="pay-save-settings" type="button" class="btn">Save payment settings</button>' +
      '<p id="pay-settings-msg" class="muted small" role="status"></p></div>' +
        '<div class="pay-block"><h3>Payment QR for guests</h3><p class="muted small">Upload your current GCash/Maya merchant QR. Re-upload anytime to replace it. The QR image is public so guests can scan it; cashier approval is still required to authorize the download.</p>' +
          '<div class="pay-grid"><label>Payment provider / instructions<input id="pay-qr-label" type="text" maxlength="100" placeholder="GCash · Send the amount shown"></label>' +
          '<label>Optional payment link<input id="pay-payment-link" type="url" placeholder="https://…" autocomplete="off"></label>' +
          '<label>Upload replacement QR (PNG, JPG, WebP; max 3 MB)<input id="pay-qr-file" type="file" accept="image/png,image/jpeg,image/webp"></label></div>' +
          '<div id="pay-qr-preview-wrap" class="pay-qr-preview hidden"><img id="pay-qr-preview" alt="Current guest payment QR"></div>' +
          '<button id="pay-save-qr" type="button" class="btn">Save / update payment QR</button><p id="pay-qr-msg" class="muted small" role="status"></p></div>' +
        '<div class="pay-block"><h3>Events</h3><p class="muted small">Choose an event on this booth device, then set its charging mode. “Paid” uses the global media switches and prices unless you enter event-specific overrides.</p>' +
        '<div class="pay-grid"><label>Active event on this device<select id="pay-device-event"><option value="">No event</option></select></label>' +
        '<label>Event to edit<select id="pay-event-edit"><option value="">Create a new event</option></select></label>' +
        '<label>Event name<input id="pay-event-name" type="text" maxlength="80" placeholder="Wedding reception"></label>' +
        '<label>Charge mode<select id="pay-event-mode"><option value="inherit">Use global settings</option><option value="free">Free event</option><option value="paid">Paid event</option></select></label>' +
        '<label>Free saves override<input id="pay-event-free" type="number" min="0" step="1" placeholder="Use global"></label>' +
        '<label>GIF price override (₱)<input id="pay-event-gif-price" type="number" min="0" step="0.01" placeholder="Use global"></label>' +
        '<label>Strip price override (₱)<input id="pay-event-strip-price" type="number" min="0" step="0.01" placeholder="Use global"></label>' +
        '<label>GIF charging<select id="pay-event-gif"><option value="">Use global</option><option value="true">Charge</option><option value="false">Free</option></select></label>' +
        '<label>Strip charging<select id="pay-event-strip"><option value="">Use global</option><option value="true">Charge</option><option value="false">Free</option></select></label>' +
      '</div><div class="pay-actions"><button id="pay-save-event" type="button" class="btn">Save event</button><button id="pay-new-event" type="button" class="btn ghost">New event</button></div>' +
      '<p id="pay-event-msg" class="muted small" role="status"></p></div>' +
      '<div class="pay-block"><h3>Bundles</h3><div class="pay-grid">' +
        '<label>Bundle name<input id="pay-bundle-name" type="text" maxlength="60" placeholder="3 GIFs"></label>' +
        '<label>Format<select id="pay-bundle-format"><option value="gif">GIFs</option><option value="strip">Strips</option></select></label>' +
        '<label>Saves in bundle<input id="pay-bundle-qty" type="number" min="2" step="1" value="3"></label>' +
        '<label>Bundle price (₱)<input id="pay-bundle-price" type="number" min="0" step="0.01" value="50"></label>' +
        '<label>Available for event<select id="pay-bundle-event"><option value="">All events</option></select></label>' +
      '</div><button id="pay-add-bundle" type="button" class="btn">Add bundle</button><div id="pay-bundles" class="pay-list"></div></div>' +
      '<div class="pay-block"><h3>Counter vouchers</h3><p class="muted small">Create a code after collecting payment at the counter. The full sale is recorded when the code is issued; the guest redeems one save at a time.</p>' +
        '<div class="pay-grid"><label>Format<select id="pay-voucher-format"><option value="gif">GIFs</option><option value="strip">Strips</option></select></label>' +
        '<label>Saves in voucher<input id="pay-voucher-qty" type="number" min="1" step="1" value="1"></label>' +
        '<label>Total collected (₱)<input id="pay-voucher-price" type="number" min="0" step="0.01" value="20"></label>' +
        '<label>For event<select id="pay-voucher-event"><option value="">All events</option></select></label>' +
      '</div><button id="pay-issue-voucher" type="button" class="btn">Issue voucher code</button><p id="pay-voucher-code" class="pay-code hidden" role="status"></p><p id="pay-voucher-msg" class="muted small"></p></div>' +
      '<div class="pay-block"><h3>Cashier approval & device reset</h3><div class="pay-grid">' +
        '<label>Staff PIN (4–8 digits)<input id="pay-pin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></label>' +
        '<label>Event to reset<select id="pay-reset-event"><option value="">No event</option></select></label>' +
        '<label>Device to reset<select id="pay-reset-device"><option value="">No device usage found</option></select></label>' +
      '</div><div class="pay-actions"><button id="pay-set-pin" type="button" class="btn">Set staff PIN</button><button id="pay-refresh-devices" type="button" class="btn ghost">Refresh devices</button><button id="pay-reset" type="button" class="btn danger">Reset free saves</button></div><p id="pay-ops-msg" class="muted small" role="status"></p></div>' +
      '<div class="pay-block"><h3>Sales report</h3><div class="pay-report-head"><label>From date<input id="pay-report-date" type="date"></label><button id="pay-refresh-report" type="button" class="btn ghost">Refresh report</button></div>' +
        '<div id="pay-report-summary" class="pay-report-summary"></div><div class="pay-table-wrap"><table class="pay-table"><thead><tr><th>Day</th><th>Event</th><th>GIFs</th><th>Strips</th><th>Sales</th></tr></thead><tbody id="pay-report-rows"></tbody></table></div>' +
        '<p class="muted small">Voucher sales are counted when codes are issued. PIN sales are counted when approved. Automatic GCash and Maya payments are not connected yet.</p></div>';
    const main = document.querySelector('main');
    const cloud = $('cloud-card');
    if (cloud) main.insertBefore(card, cloud);
    else main.appendChild(card);
    bind();
  }

  function message(id, text, isError) {
    const node = $(id);
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('pay-error', !!isError);
  }
  function validMoney(value) { return Number.isFinite(Number(value)) && Number(value) >= 0; }
  function id(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function renderEvents() {
    ['pay-device-event', 'pay-event-edit', 'pay-bundle-event', 'pay-voucher-event', 'pay-reset-event'].forEach((name) => {
      const el = $(name);
      if (!el) return;
      const includeAll = name === 'pay-bundle-event' || name === 'pay-voucher-event';
      const firstText = name === 'pay-event-edit' ? 'Create a new event' : includeAll ? 'All events' : 'No event';
      const previous = el.value;
      el.replaceChildren(new Option(firstText, ''));
      events.forEach((event) => el.add(new Option(event.name, event.id)));
      if (Array.from(el.options).some((option) => option.value === previous)) el.value = previous;
    });
    $('pay-device-event').value = PaySystem.activeEventId();
    renderBundles();
  }
  function renderBundles() {
    const box = $('pay-bundles');
    box.replaceChildren();
    if (!bundles.length) { box.textContent = 'No bundles yet.'; return; }
    bundles.forEach((bundle) => {
      const row = document.createElement('div');
      row.className = 'pay-list-row';
      const text = document.createElement('span');
      const event = events.find((item) => item.id === bundle.event_id);
      text.textContent = bundle.name + ' · ' + bundle.quantity + ' ' + bundle.media_type.toUpperCase() +
        ' · ₱' + Number(bundle.price).toFixed(2) + (event ? ' · ' + event.name : ' · all events');
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'btn ghost small'; remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        try {
          await DeviceTracker.rest('ts_pay_bundles?lib=eq.' + encodeURIComponent(PaySystem.lib()) + '&id=eq.' + encodeURIComponent(bundle.id), { method: 'DELETE' });
          await loadBundles();
        } catch (err) { message('pay-settings-msg', err.message, true); }
      });
      row.append(text, remove);
      box.appendChild(row);
    });
  }
  async function loadBundles() {
    bundles = await DeviceTracker.rest('ts_pay_bundles?select=*&' + libFilter() + '&active=eq.true&order=quantity.asc') || [];
    renderBundles();
  }
  function showEvent(event) {
    $('pay-event-name').value = event ? event.name : '';
    $('pay-event-mode').value = event ? event.charge_mode : 'inherit';
    $('pay-event-free').value = event && event.free_saves != null ? event.free_saves : '';
    $('pay-event-gif-price').value = event && event.gif_price != null ? event.gif_price : '';
    $('pay-event-strip-price').value = event && event.strip_price != null ? event.strip_price : '';
    $('pay-event-gif').value = event && event.gif_paid != null ? String(event.gif_paid) : '';
    $('pay-event-strip').value = event && event.strip_paid != null ? String(event.strip_paid) : '';
  }
  function collectNullableNumber(inputId) {
    const value = $(inputId).value.trim();
    return value === '' ? null : Number(value);
  }
  async function saveSettings() {
    const free = Number($('pay-free').value);
    if (!Number.isInteger(free) || free < 0 ||
        !validMoney($('pay-gif-price').value) || !validMoney($('pay-strip-price').value)) {
      throw new Error('Enter a valid free-save count and non-negative prices.');
    }
    await DeviceTracker.rest('ts_pay_settings?on_conflict=lib', {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({
        lib: PaySystem.lib(), enabled: $('pay-enabled').checked, free_saves: free,
        gif_paid: $('pay-gif-on').checked, strip_paid: $('pay-strip-on').checked,
        gif_price: Number($('pay-gif-price').value), strip_price: Number($('pay-strip-price').value),
        updated_at: Date.now()
      })
    });
    message('pay-settings-msg', 'Payment settings saved.');
    $('pay-state').textContent = $('pay-enabled').checked ? 'On' : 'Off · all saves free';
  }
  async function loadSettings() {
    const result = await PaySystem.load();
    events = result.events || [];
    bundles = result.bundles || [];
    const s = result.settings;
    if (s) {
      $('pay-enabled').checked = s.enabled;
      $('pay-free').value = s.free_saves;
      $('pay-gif-on').checked = s.gif_paid;
      $('pay-strip-on').checked = s.strip_paid;
      $('pay-gif-price').value = s.gif_price;
      $('pay-strip-price').value = s.strip_price;
      $('pay-qr-label').value = s.payment_qr_label || '';
      $('pay-payment-link').value = s.payment_link || '';
      renderQrPreview(s.payment_qr_url || '');
      $('pay-state').textContent = s.enabled ? 'On' : 'Off · all saves free';
    } else $('pay-state').textContent = 'Not configured';
    renderEvents();
    showEvent(events.find((event) => event.id === $('pay-event-edit').value));
  }
  function renderQrPreview(url) {
    const wrap = $('pay-qr-preview-wrap');
    const image = $('pay-qr-preview');
    image.src = url || '';
    wrap.classList.toggle('hidden', !url);
  }
  async function savePaymentQr() {
    const file = $('pay-qr-file').files[0];
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024)) {
      throw new Error('Choose a PNG, JPG, or WebP QR image no larger than 3 MB.');
    }
    const link = $('pay-payment-link').value.trim();
    if (link && !/^https:\/\//i.test(link)) throw new Error('Payment link must start with https://');
    let imageUrl = $('pay-qr-preview').getAttribute('src') || null;
    if (file) imageUrl = await DeviceTracker.uploadPaymentQr(file);
    const label = $('pay-qr-label').value.trim();
    await DeviceTracker.rest('ts_pay_settings?on_conflict=lib', {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({
        lib: PaySystem.lib(), payment_qr_url: imageUrl,
        payment_qr_label: label || null, payment_link: link || null,
        updated_at: Date.now()
      })
    });
    renderQrPreview(imageUrl);
    $('pay-qr-file').value = '';
    message('pay-qr-msg', imageUrl ? 'Guest payment QR updated.' : 'Payment QR removed.');
  }
  async function saveEvent() {
    const name = $('pay-event-name').value.trim();
    if (!name) throw new Error('Enter an event name.');
    const free = collectNullableNumber('pay-event-free');
    const gifPrice = collectNullableNumber('pay-event-gif-price');
    const stripPrice = collectNullableNumber('pay-event-strip-price');
    if ((free != null && (!Number.isInteger(free) || free < 0)) ||
        (gifPrice != null && !validMoney(gifPrice)) || (stripPrice != null && !validMoney(stripPrice))) {
      throw new Error('Event overrides must be non-negative numbers.');
    }
    const eventId = $('pay-event-edit').value || id('event');
    const row = {
      lib: PaySystem.lib(), id: eventId, name, charge_mode: $('pay-event-mode').value,
      free_saves: free, gif_price: gifPrice, strip_price: stripPrice,
      gif_paid: $('pay-event-gif').value === '' ? null : $('pay-event-gif').value === 'true',
      strip_paid: $('pay-event-strip').value === '' ? null : $('pay-event-strip').value === 'true'
    };
    await DeviceTracker.rest('ts_pay_events?on_conflict=lib,id', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify(row)
    });
    await loadSettings();
    $('pay-event-edit').value = eventId;
    showEvent(events.find((event) => event.id === eventId));
    message('pay-event-msg', 'Event saved. Select it under “Active event on this device” to use it at this booth.');
  }
  async function addBundle() {
    const name = $('pay-bundle-name').value.trim();
    const quantity = Number($('pay-bundle-qty').value);
    const price = Number($('pay-bundle-price').value);
    if (!name || !Number.isInteger(quantity) || quantity < 2 || !validMoney(price)) {
      throw new Error('Enter a bundle name, at least 2 saves, and a valid price.');
    }
    await DeviceTracker.rest('ts_pay_bundles', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        lib: PaySystem.lib(), id: id('bundle'), event_id: $('pay-bundle-event').value || null,
        name, media_type: $('pay-bundle-format').value, quantity, price, active: true
      })
    });
    $('pay-bundle-name').value = '';
    await loadBundles();
  }
  function makeVoucherCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let code = '';
    for (let i = 0; i < bytes.length; i++) code += alphabet[bytes[i] % alphabet.length];
    return code.match(/.{1,4}/g).join('-');
  }
  async function sha256(text) {
    const bytes = new TextEncoder().encode(text.trim().toUpperCase());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }
  async function issueVoucher() {
    const quantity = Number($('pay-voucher-qty').value);
    const amount = Number($('pay-voucher-price').value);
    if (!Number.isInteger(quantity) || quantity < 1 || !validMoney(amount)) {
      throw new Error('Enter a positive save count and a valid amount collected.');
    }
    const code = makeVoucherCode();
    await DeviceTracker.rest('rpc/ts_pay_issue_voucher', {
      method: 'POST',
      body: JSON.stringify({
        p_lib: PaySystem.lib(), p_code_hash: await sha256(code),
        p_event_id: $('pay-voucher-event').value || null,
        p_media_type: $('pay-voucher-format').value, p_quantity: quantity, p_amount: amount
      })
    });
    $('pay-voucher-code').textContent = 'Voucher code (show or print now): ' + code;
    $('pay-voucher-code').classList.remove('hidden');
    message('pay-voucher-msg', 'Voucher issued and sale recorded.');
    await refreshReport();
  }
  async function refreshDevices() {
    const eventId = $('pay-reset-event').value || 'default';
    const data = await DeviceTracker.rest('ts_pay_usage?select=device_id,free_saves&' + libFilter() +
      '&event_id=eq.' + encodeURIComponent(eventId) + '&order=updated_at.desc&limit=500');
    const select = $('pay-reset-device');
    select.replaceChildren(new Option('Choose a device', ''));
    (data || []).forEach((row) => {
      const label = row.device_id + ' · ' + row.free_saves + ' free saves used';
      select.add(new Option(label, row.device_id));
    });
    if (!data || !data.length) select.replaceChildren(new Option('No device usage found', ''));
  }
  function dayKey(ms) {
    const date = new Date(Number(ms));
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  async function refreshReport() {
    const day = $('pay-report-date').value;
    const start = day ? new Date(day + 'T00:00:00').getTime() : 0;
    const query = 'select=*&' + libFilter() + (start ? '&created_at=gte.' + start : '') + '&order=created_at.desc,id.desc&limit=1000';
    const sales = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await DeviceTracker.rest('ts_pay_sales?' + query, {
        headers: { Range: offset + '-' + (offset + 999), 'Range-Unit': 'items' }
      });
      sales.push(...page);
      if (page.length < 1000) break;
    }
    const groups = new Map();
    (sales || []).forEach((sale) => {
      const key = dayKey(sale.created_at) + '|' + sale.event_name;
      if (!groups.has(key)) groups.set(key, { day: dayKey(sale.created_at), event: sale.event_name, gif: 0, strip: 0, amount: 0 });
      const group = groups.get(key);
      if (sale.media_type === 'gif') group.gif += Number(sale.quantity);
      else group.strip += Number(sale.quantity);
      group.amount += Number(sale.amount);
    });
    const rows = Array.from(groups.values()).sort((a, b) => b.day.localeCompare(a.day) || a.event.localeCompare(b.event));
    const totalGif = rows.reduce((sum, row) => sum + row.gif, 0);
    const totalStrip = rows.reduce((sum, row) => sum + row.strip, 0);
    const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
    $('pay-report-summary').textContent = totalGif + ' GIFs sold · ' + totalStrip + ' strips sold · ₱' + totalAmount.toFixed(2) + ' total';
    const tbody = $('pay-report-rows');
    tbody.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = 5; td.textContent = 'No sales for this period yet.'; tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      [row.day, row.event, row.gif, row.strip, '₱' + row.amount.toFixed(2)].forEach((value) => {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
  function bind() {
    $('pay-save-settings').addEventListener('click', () => saveSettings().catch((err) => message('pay-settings-msg', err.message, true)));
    $('pay-save-qr').addEventListener('click', () => savePaymentQr().catch((err) => message('pay-qr-msg', err.message, true)));
    $('pay-event-edit').addEventListener('change', () => showEvent(events.find((event) => event.id === $('pay-event-edit').value)));
    $('pay-new-event').addEventListener('click', () => { $('pay-event-edit').value = ''; showEvent(null); });
    $('pay-save-event').addEventListener('click', () => saveEvent().catch((err) => message('pay-event-msg', err.message, true)));
    $('pay-device-event').addEventListener('change', (event) => {
      PaySystem.setActiveEvent(event.target.value);
      message('pay-event-msg', event.target.value ? 'Active event set for this booth device.' : 'No event is active on this booth device.');
    });
    $('pay-add-bundle').addEventListener('click', () => addBundle().catch((err) => message('pay-settings-msg', err.message, true)));
    $('pay-issue-voucher').addEventListener('click', () => issueVoucher().catch((err) => message('pay-voucher-msg', err.message, true)));
    $('pay-set-pin').addEventListener('click', async () => {
      try {
        const pin = $('pay-pin').value;
        await DeviceTracker.rest('rpc/ts_pay_set_pin', { method: 'POST', body: JSON.stringify({ p_lib: PaySystem.lib(), p_pin: pin }) });
        $('pay-pin').value = '';
        message('pay-ops-msg', 'Staff PIN saved securely.');
      } catch (err) { message('pay-ops-msg', err.message, true); }
    });
    $('pay-reset-event').addEventListener('change', () => refreshDevices().catch((err) => message('pay-ops-msg', err.message, true)));
    $('pay-refresh-devices').addEventListener('click', () => refreshDevices().catch((err) => message('pay-ops-msg', err.message, true)));
    $('pay-reset').addEventListener('click', async () => {
      const deviceId = $('pay-reset-device').value;
      if (!deviceId) { message('pay-ops-msg', 'Choose a device first.', true); return; }
      if (!confirm('Reset the free-save count for ' + deviceId + '?')) return;
      try {
        await DeviceTracker.rest('rpc/ts_pay_reset_device', {
          method: 'POST', body: JSON.stringify({
            p_lib: PaySystem.lib(), p_event_id: $('pay-reset-event').value,
            p_device_id: deviceId
          })
        });
        message('pay-ops-msg', 'Free saves reset for ' + deviceId + '.');
        await refreshDevices();
      } catch (err) { message('pay-ops-msg', err.message, true); }
    });
    $('pay-refresh-report').addEventListener('click', () => refreshReport().catch((err) => message('pay-settings-msg', err.message, true)));
    $('pay-report-date').addEventListener('change', () => refreshReport().catch((err) => message('pay-settings-msg', err.message, true)));
    $('pay-voucher-format').addEventListener('change', () => {
      $('pay-voucher-price').value = $('pay-voucher-format').value === 'gif' ? $('pay-gif-price').value : $('pay-strip-price').value;
    });
  }
  async function start() {
    if (started || !PaySystem.configured()) return;
    started = true;
    createCard();
    try {
      await loadSettings();
      await Promise.all([refreshDevices(), refreshReport()]);
    } catch (err) {
      $('pay-state').textContent = 'Connection error';
      message('pay-settings-msg', 'Payment controls could not load: ' + err.message, true);
    }
  }
  window.addEventListener('admin-unlocked', start);
  if (!document.body.classList.contains('locked')) start();
})();
