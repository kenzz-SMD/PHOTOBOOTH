import { json, preflight, readRows, requiredEnv, supabaseConfig, supabaseRequest, paymongoRequest, paymongoSecret } from "../_shared/paymongo.ts";

type Settings = {
  enabled: boolean;
  free_saves: number;
  gif_paid: boolean;
  strip_paid: boolean;
  gif_price: number;
  strip_price: number;
};
type EventRule = {
  id: string;
  name: string;
  charge_mode: "inherit" | "free" | "paid";
  free_saves: number | null;
  gif_paid: boolean | null;
  strip_paid: boolean | null;
  gif_price: number | null;
  strip_price: number | null;
};
type Bundle = {
  id: string;
  event_id: string | null;
  name: string;
  media_type: "gif" | "strip";
  quantity: number;
  price: number;
  active: boolean;
};
type Plan = {
  id: string;
  name: string;
  amount: number;
  stripQuantity: number;
  gifQuantity: number;
  accessDays: number;
};

const plans: Record<string, Plan> = {
  single_strip: { id: "single_strip", name: "Single Strip", amount: 15, stripQuantity: 1, gifQuantity: 0, accessDays: 0 },
  double_strip: { id: "double_strip", name: "Double Strip", amount: 25, stripQuantity: 2, gifQuantity: 0, accessDays: 0 },
  quad_gif: { id: "quad_gif", name: "Quad Pack + GIF", amount: 50, stripQuantity: 4, gifQuantity: 1, accessDays: 0 },
  monthly_pass: { id: "monthly_pass", name: "Monthly Pass (30 days)", amount: 150, stripQuantity: 0, gifQuantity: 0, accessDays: 30 },
};

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const config = supabaseConfig();
    const appOrigin = requiredEnv("APP_ORIGIN").replace(/\/+$/, "");
    const { testMode } = paymongoSecret();
    const body = await request.json();
    const lib = String(body.lib || "");
    const deviceId = String(body.device_id || "");
    const eventId = String(body.event_id || "");
    const plan = plans[String(body.plan_id || "")] || null;
    const mediaType = plan ? "strip" : body.media_type;
    const bundleId = String(body.bundle_id || "");
    if (lib !== config.lib || !/^dev-[a-z0-9]+$/i.test(deviceId) || deviceId.length > 100) {
      return json(request, { error: "Invalid booth session." }, 400);
    }
    if (mediaType !== "gif" && mediaType !== "strip") return json(request, { error: "Unsupported save format." }, 400);

    const settingsRows = await readRows<Settings>(
      `ts_pay_settings?select=*&lib=eq.${encodeURIComponent(lib)}&limit=1`,
    );
    const settings = settingsRows[0];
    if (!settings?.enabled) return json(request, { error: "Paid saves are currently disabled." }, 409);

    let event: EventRule | null = null;
    if (eventId) {
      const rows = await readRows<EventRule>(
        `ts_pay_events?select=*&lib=eq.${encodeURIComponent(lib)}&id=eq.${encodeURIComponent(eventId)}&limit=1`,
      );
      event = rows[0] || null;
      if (!event) return json(request, { error: "The selected event no longer exists." }, 409);
    }
    const eventKey = eventId || "default";
    const eventFilter = eventId
      ? `event_id=eq.${encodeURIComponent(eventId)}`
      : "event_id=is.null";
    const itemFilter = plan
      ? `plan_id=eq.${encodeURIComponent(plan.id)}`
      : `media_type=eq.${mediaType}&bundle_id=${bundleId
        ? `eq.${encodeURIComponent(bundleId)}`
        : "is.null"}`;
    const pendingOrders = await readRows<{
      id: string;
      reference_number: string;
      checkout_session_id: string;
      test_mode: boolean;
    }>(
      `ts_pay_orders?select=id,reference_number,checkout_session_id,test_mode&lib=eq.${encodeURIComponent(lib)}&device_id=eq.${encodeURIComponent(deviceId)}&${itemFilter}&status=eq.pending&${eventFilter}&checkout_session_id=not.is.null&order=created_at.desc&limit=1`,
    );
    const pendingOrder = pendingOrders[0];
    if (pendingOrder) {
      const existingResponse = await paymongoRequest(
        `/v2/checkout_sessions/${encodeURIComponent(pendingOrder.checkout_session_id)}`,
      );
      if (!existingResponse.ok) throw new Error(`Could not check the existing checkout (${existingResponse.status})`);
      const existingBody = await existingResponse.json();
      const existingSession = existingBody?.data;
      const existingAttributes = existingSession?.attributes;
      if (existingSession?.id !== pendingOrder.checkout_session_id ||
          existingAttributes?.reference_number !== pendingOrder.reference_number ||
          Boolean(existingAttributes?.livemode) === pendingOrder.test_mode) {
        throw new Error("Existing checkout verification failed.");
      }
      if (existingAttributes?.status === "expired") {
        const expired = await supabaseRequest(
          `ts_pay_orders?id=eq.${encodeURIComponent(pendingOrder.id)}&status=eq.pending`,
          { method: "PATCH", body: JSON.stringify({ status: "expired" }) },
        );
        if (!expired.ok) throw new Error(`Could not expire the existing checkout (${expired.status})`);
      } else {
        const existingUrl = existingAttributes?.checkout_url;
        if (typeof existingUrl !== "string" || !existingUrl.startsWith("https://checkout.paymongo.com/")) {
          throw new Error("PayMongo did not return the existing checkout link.");
        }
        const reopened = await supabaseRequest(
          `ts_pay_orders?id=eq.${encodeURIComponent(pendingOrder.id)}&status=eq.pending`,
          { method: "PATCH", body: JSON.stringify({ last_payment_status: "pending" }) },
        );
        if (!reopened.ok) throw new Error(`Could not reopen the existing checkout (${reopened.status})`);
        return json(request, {
          order_id: pendingOrder.id,
          checkout_url: existingUrl,
          test_mode: pendingOrder.test_mode,
        });
      }
    }
    if (!plan) {
      const paid = event?.charge_mode === "free" ? false :
        (mediaType === "gif" ? event?.gif_paid ?? settings.gif_paid : event?.strip_paid ?? settings.strip_paid);
      if (!paid) return json(request, { error: "This save format is free for the selected event." }, 409);

      const freeLimit = event?.free_saves ?? settings.free_saves;
      const usageRows = await readRows<{ free_saves: number }>(
        `ts_pay_usage?select=free_saves&lib=eq.${encodeURIComponent(lib)}&event_id=eq.${encodeURIComponent(eventKey)}&device_id=eq.${encodeURIComponent(deviceId)}&limit=1`,
      );
      if ((usageRows[0]?.free_saves || 0) < freeLimit) {
        return json(request, { error: "Free saves remain. Save one first, then pay for additional saves." }, 409);
      }
    }

    let bundle: Bundle | null = null;
    if (bundleId && !plan) {
      const rows = await readRows<Bundle>(
        `ts_pay_bundles?select=*&lib=eq.${encodeURIComponent(lib)}&id=eq.${encodeURIComponent(bundleId)}&active=eq.true&limit=1`,
      );
      bundle = rows[0] || null;
      if (!bundle || bundle.media_type !== mediaType || (bundle.event_id && bundle.event_id !== eventId)) {
        return json(request, { error: "This bundle is not available for the selected event or format." }, 409);
      }
    }

    const price = plan ? plan.amount : bundle ? Number(bundle.price) :
      Number(mediaType === "gif" ? event?.gif_price ?? settings.gif_price : event?.strip_price ?? settings.strip_price);
    const quantity = plan ? Math.max(plan.stripQuantity, 1) : bundle ? Number(bundle.quantity) : 1;
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return json(request, { error: "The selected price or bundle is invalid." }, 409);
    }

    const orderId = crypto.randomUUID();
    const referenceNumber = `TS-${orderId.replaceAll("-", "")}`;
    const order = {
      id: orderId,
      lib,
      event_id: eventId || null,
      event_name: event?.name || "No event",
      device_id: deviceId,
      media_type: mediaType,
      bundle_id: bundle?.id || null,
      plan_id: plan?.id || null,
      product_name: plan?.name || bundle?.name || `${mediaType.toUpperCase()} save`,
      quantity,
      gif_quantity: plan?.gifQuantity || 0,
      access_days: plan?.accessDays || 0,
      amount: price,
      currency: "PHP",
      status: "pending",
      reference_number: referenceNumber,
      test_mode: testMode,
    };
    const inserted = await supabaseRequest("ts_pay_orders", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(order),
    });
    if (!inserted.ok) throw new Error(`Could not create payment order (${inserted.status})`);

    const checkoutResponse = await paymongoRequest("/v2/checkout_sessions", {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [{
              name: plan?.name || (bundle ? bundle.name : `${mediaType.toUpperCase()} save`),
              amount: Math.round(price * 100),
              currency: "PHP",
              quantity: 1,
            }],
            payment_method_types: ["gcash"],
            success_url: `${appOrigin}/payment-return.html?order=${encodeURIComponent(orderId)}&device=${encodeURIComponent(deviceId)}&state=success`,
            cancel_url: `${appOrigin}/payment-return.html?order=${encodeURIComponent(orderId)}&device=${encodeURIComponent(deviceId)}&state=cancel`,
            reference_number: referenceNumber,
            metadata: { order_id: orderId, booth: "timeless-strips" },
          },
        },
      }),
    });
    const checkoutBody = await checkoutResponse.json().catch(() => ({}));
    if (!checkoutResponse.ok) {
      await supabaseRequest(`ts_pay_orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH", body: JSON.stringify({ status: "failed" }),
      });
      console.error("PayMongo checkout create failed:", checkoutBody);
      return json(request, { error: "PayMongo could not start checkout. Check the sandbox key and GCash availability." }, 502);
    }
    const session = checkoutBody?.data;
    const checkoutUrl = session?.attributes?.checkout_url;
    if (typeof checkoutUrl !== "string" || !checkoutUrl.startsWith("https://checkout.paymongo.com/") || !session?.id) {
      throw new Error("PayMongo returned an invalid checkout session.");
    }
    const updated = await supabaseRequest(`ts_pay_orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: JSON.stringify({ checkout_session_id: session.id }),
    });
    if (!updated.ok) throw new Error(`Could not link the payment session (${updated.status})`);
    return json(request, { order_id: orderId, checkout_url: checkoutUrl, test_mode: testMode });
  } catch (error) {
    console.error("Create GCash checkout failed:", error);
    return json(request, { error: error instanceof Error ? error.message : "Could not start checkout." }, 500);
  }
});
