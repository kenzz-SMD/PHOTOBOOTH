import { json, paymongoRequest, paymongoSecret, readRows, supabaseRequest } from "../_shared/paymongo.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const { testMode } = paymongoSecret();
    const body = await request.json();
    const event = body?.data;
    const eventType = event?.type;
    if (eventType !== "checkout_session.payment.paid" &&
        eventType !== "checkout_session.payment.failed") {
      return new Response("Ignored", { status: 200 });
    }
    const checkoutId = String(event?.data?.id || "");
    if (!checkoutId) return new Response("Missing checkout session", { status: 400 });

    const matchingOrders = await readRows<{
      id: string;
      lib: string;
      reference_number: string;
      checkout_session_id: string;
      amount: number;
      status: string;
      test_mode: boolean;
    }>(
      `ts_pay_orders?select=*&checkout_session_id=eq.${encodeURIComponent(checkoutId)}&limit=1`,
    );
    const order = matchingOrders[0];
    if (!order) return new Response("Unknown checkout session", { status: 404 });
    if (order.status === "paid") return new Response("Already fulfilled", { status: 200 });
    if (order.test_mode !== testMode) return new Response("Payment mode mismatch", { status: 400 });

    const verifiedResponse = await paymongoRequest(`/v2/checkout_sessions/${encodeURIComponent(checkoutId)}`);
    if (!verifiedResponse.ok) throw new Error(`PayMongo verification failed (${verifiedResponse.status})`);
    const verifiedBody = await verifiedResponse.json();
    const session = verifiedBody?.data;
    const attributes = session?.attributes;
    if (session?.id !== checkoutId || attributes?.reference_number !== order.reference_number ||
        Boolean(attributes?.livemode) === testMode) {
      return new Response("Checkout verification failed", { status: 400 });
    }

    const payments = Array.isArray(attributes?.payments) ? attributes.payments : [];
    if (eventType === "checkout_session.payment.failed") {
      const failedPayment = payments.find((candidate: { attributes?: Record<string, unknown> }) =>
        candidate?.attributes?.status === "failed");
      if (!failedPayment) return new Response("No failed payment to record", { status: 200 });
      const failed = await supabaseRequest(
        `ts_pay_orders?id=eq.${encodeURIComponent(order.id)}&status=eq.pending`,
        {
          method: "PATCH",
          body: JSON.stringify({ last_payment_status: "failed" }),
        },
      );
      if (!failed.ok) throw new Error(`Could not record declined payment attempt (${failed.status})`);
      return new Response("Declined payment attempt recorded; checkout remains retryable", { status: 200 });
    }
    const payment = payments.find((candidate: { id?: string; attributes?: Record<string, unknown> }) =>
      candidate?.attributes?.status === "paid" &&
      String(candidate?.attributes?.currency || "").toUpperCase() === "PHP");
    if (!payment) return new Response("No successful payment", { status: 200 });
    const paymentAttributes = payment.attributes || {};
    const paidCentavos = Number(paymentAttributes.net_amount ?? paymentAttributes.amount);
    if (typeof payment.id !== "string" || !payment.id ||
        !Number.isSafeInteger(paidCentavos) || paidCentavos <= 0) {
      return new Response("Invalid paid amount", { status: 400 });
    }

    const fulfillment = await supabaseRequest("rpc/ts_pay_fulfill_checkout", {
      method: "POST",
      body: JSON.stringify({
        p_order_id: order.id,
        p_checkout_session_id: checkoutId,
        p_payment_id: payment.id,
        p_paid_amount_centavos: paidCentavos,
        p_currency: paymentAttributes.currency,
        p_livemode: Boolean(attributes?.livemode),
      }),
    });
    if (!fulfillment.ok) {
      const detail = (await fulfillment.text()).slice(0, 300);
      throw new Error(`Order fulfillment failed (${fulfillment.status}): ${detail}`);
    }
    return new Response("Payment verified and fulfilled", { status: 200 });
  } catch (error) {
    console.error("PayMongo webhook failed:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
});
