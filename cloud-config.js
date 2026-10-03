// Site-wide cloud settings. Fill these in ONCE and deploy this file with the site:
// every device that opens the booth then syncs automatically (no setup per device).
// (Admin page -> Cloud sync -> "Download cloud-config.js" creates this file for you.)
window.TS_CLOUD_CONFIG = {
  enabled: false,                 // set to true after filling in the three values below
  url: '',                        // https://xxxx.supabase.co
  key: '',                        // anon public key
  lib: ''                         // library code, e.g. 'my-booth-4f8a2c91'
};