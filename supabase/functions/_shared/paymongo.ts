export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing function secret: ${name}`);
  return value;
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") || "";
  const appUrl = Deno.env.get("APP_ORIGIN") || "";
  const configured = appUrl ? new URL(appUrl).origin : "";
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed = origin === configured || local;
  return {
    "Access-Control-Allow-Origin": allowed ? origin : configured,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

export function preflight(request: Request): Response | null {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  return null;
}

export function supabaseConfig() {
  return {
    url: requiredEnv("SUPABASE_URL").replace(/\/+$/, ""),
    key: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    lib: requiredEnv("PHOTOBOOTH_LIB"),
  };
}

export async function supabaseRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const config = supabaseConfig();
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export async function readRows<T>(path: string): Promise<T[]> {
  const response = await supabaseRequest(path);
  if (!response.ok) throw new Error(`Database query failed (${response.status})`);
  return await response.json() as T[];
}

export function paymongoSecret(): { key: string; testMode: boolean } {
  const key = requiredEnv("PAYMONGO_SECRET_KEY");
  const mode = Deno.env.get("PAYMONGO_MODE") || "test";
  if (mode !== "test" && mode !== "live") throw new Error("PAYMONGO_MODE must be test or live");
  const testMode = mode === "test";
  if (testMode !== key.startsWith("sk_test_")) {
    throw new Error("PayMongo secret key prefix does not match PAYMONGO_MODE");
  }
  return { key, testMode };
}

export async function paymongoRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const { key } = paymongoSecret();
  return fetch(`https://api.paymongo.com${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${btoa(`${key}:`)}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}
