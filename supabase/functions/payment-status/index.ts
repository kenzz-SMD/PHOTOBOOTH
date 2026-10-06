import { json, preflight, readRows, supabaseConfig } from "../_shared/paymongo.ts";

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const config = supabaseConfig();
    const body = await request.json();
    const orderId = String(body.order_id || "");
    const deviceId = String(body.device_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^dev-[a-z0-9]+$/i.test(deviceId)) {
      return json(request, { error: "Invalid payment lookup." }, 400);
    }
    const rows = await readRows<{
      id: string;
      status: string;
      last_payment_status: string;
      media_type: "gif" | "strip";
      quantity: number;
      gif_quantity: number;
      access_days: number;
      plan_id: string | null;
      product_name: string;
      amount: number;
      currency: string;
    }>(
      `ts_pay_orders?select=id,status,last_payment_status,media_type,quantity,gif_quantity,access_days,plan_id,product_name,amount,currency&lib=eq.${encodeURIComponent(config.lib)}&id=eq.${encodeURIComponent(orderId)}&device_id=eq.${encodeURIComponent(deviceId)}&limit=1`,
    );
    if (!rows[0]) return json(request, { error: "Payment order not found." }, 404);
    return json(request, {
      status: rows[0].status,
      payment_attempt_status: rows[0].last_payment_status,
      media_type: rows[0].media_type,
      quantity: rows[0].quantity,
      gif_quantity: rows[0].gif_quantity,
      access_days: rows[0].access_days,
      plan_id: rows[0].plan_id,
      product_name: rows[0].product_name,
      amount: Number(rows[0].amount),
      currency: rows[0].currency,
    });
  } catch (error) {
    console.error("Payment status lookup failed:", error);
    return json(request, { error: "Could not check payment status." }, 500);
  }
});
