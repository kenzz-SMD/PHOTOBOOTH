// ===================== SHARED CLOUD CONFIG =====================
// Fill this in ONCE (same values you use in Admin -> Cloud sync), then deploy the site.
// Every device that opens the photobooth connects automatically - users never see this.
// When the admin uploads / edits / deletes a template, all open devices update by themselves.
window.CLOUD_CONFIG = {
  url: '',            // e.g. 'https://abcd1234.supabase.co'
  key: '',            // anon public key, e.g. 'eyJhbGciOi...'
  lib: '',            // library code, e.g. 'my-booth-4f8a2c91'
  syncStrips: false   // false = users' finished photo strips stay private on their own device
};