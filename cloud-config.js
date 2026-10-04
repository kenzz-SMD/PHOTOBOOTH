// ===================== SHARED CLOUD CONFIG =====================
// Fill this in ONCE (same values you use in Admin -> Cloud sync), then deploy the site.
// Every device that opens the photobooth connects automatically - users never see this.
// When the admin uploads / edits / deletes a template, all open devices update by themselves.
window.CLOUD_CONFIG = {
  url: 'https://dlpqoblxhkjvoybbousq.supabase.co', // e.g. 'https://abcd1234.supabase.co'
  key: 'sb_publishable_0LFjyV0WXohLqDPCIw31Nw_6Ntqljyw', // anon public key, e.g. 'eyJhbGciOi...'
  lib: 'cebu-booth-k7x2p9qm4d', // library code, e.g. 'my-booth-4f8a2c91'
  trackDevices: true, // true = each device announces itself so the admin sees "Active Devices"
  syncStrips: false   // false = users' finished photo strips stay private on their own device
};