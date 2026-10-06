# PayMongo GCash checkout (sandbox)

This integration opens PayMongo hosted checkout for GCash. A verified `checkout_session.payment.paid` webhook grants the purchased save credits or 30-day pass to the same booth device and records the sale. The browser never receives the PayMongo secret key. Test-mode sales are labeled separately in the admin report.

The Prices page offers **Pay & Start** plans at server-validated prices: Single Strip (₱15), Double Strip (₱25), Quad Pack + GIF (₱50), and Monthly Pass (₱150). The existing free **Start** route remains available. Strip/GIF credits are used before free saves; a monthly pass allows unlimited strip and GIF saves on that device for 30 days. Strip/GIF credits are tied to the active event; the monthly pass works across events on the same device.

## One-time database setup

Run the complete, rerunnable `supabase-setup.sql` in the Supabase SQL Editor. This creates the payment-order ledger, admin-only read access for the transaction log, monthly-pass entitlements, and the atomic, idempotent checkout-fulfillment function required by the webhook. Orders remain unavailable to anonymous users; only authenticated admins can read them.

## Deploy the Edge Functions

Install the Supabase CLI, then from the repository root:

```sh
supabase login
supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
supabase secrets set PAYMONGO_SECRET_KEY=sk_test_YOUR_TEST_SECRET_KEY PAYMONGO_MODE=test PHOTOBOOTH_LIB=YOUR_LIBRARY_CODE APP_ORIGIN=https://kenzz-smd.github.io/PHOTOBOOTH
supabase functions deploy create-gcash-checkout
supabase functions deploy payment-status
supabase functions deploy paymongo-webhook
```

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not paste either service-role credentials or the PayMongo secret key into HTML, JavaScript, GitHub, or the admin form. The sandbox function rejects a key whose `sk_test_` prefix does not match `PAYMONGO_MODE=test`.

## Configure PayMongo

In the PayMongo **test-mode** dashboard, add a webhook endpoint:

```text
https://YOUR_SUPABASE_PROJECT_REF.supabase.co/functions/v1/paymongo-webhook
```

Subscribe it to **`checkout_session.payment.paid`** and **`checkout_session.payment.failed`**. The webhook handler retrieves the Checkout Session from PayMongo using the server-only secret key and verifies the session reference and environment. Successful payments are checked against the PHP currency and exact order amount before credits or pass access are issued. Duplicate successful webhook deliveries do not issue duplicate entitlements. Declined GCash attempts are shown to the customer, but the order remains retryable in the same hosted checkout; the server reuses a still-pending plan checkout to avoid duplicate orders.

## Run a sandbox transaction

1. In Admin → Payments, enable payments and optionally select an event for the booth device. The four plan prices are fixed server-side and are independent of the free-save limit.
2. From the booth's Prices page, choose **Pay & Start** for a plan. PayMongo opens a hosted sandbox checkout in a new tab while the booth waits for server confirmation.
3. Complete a **test-mode** GCash payment using PayMongo's current sandbox instructions. A confirmed plan starts the booth automatically; the purchased credits or 30-day pass are already active on that device.
4. Check Admin → Payments → Payment transaction log for the device, product, amount, status, and sandbox/live mode. The log is read-only; test payments are excluded from real-money totals.
5. Also test cancellation, a declined payment, a temporary network interruption, and a confirmation timeout. A still-pending checkout is safely reopened on retry; when confirmation is uncertain, use **Check payment status** before trying another checkout.

Existing **Pay with GCash** save-credit checkout continues to use the event's configured prices and bundles. Deploy the updated `create-gcash-checkout`, `payment-status`, and `paymongo-webhook` functions after applying the SQL changes.

## Optional manual GCash QR

In Admin → Payments → GCash QR code, choose a PNG, JPG, or WebP image (up to 5 MB), set the guest-facing label, and upload it. The QR is stored in the existing public `timeless-strips` Storage bucket and appears in the paid-save dialog on the next open. Replace or remove it from the same admin section. Manual QR payments are not verified by the app and do not unlock saves automatically; staff must verify the payment and issue a counter voucher.

This is a test integration, not a live payment configuration. Go live only after the end-to-end sandbox test passes, the merchant account and GCash method are activated, and an operator intentionally replaces the Edge Function secrets with live credentials and `PAYMONGO_MODE=live`.
