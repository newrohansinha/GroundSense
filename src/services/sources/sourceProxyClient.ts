// Client for the allowlisted public-source-proxy edge function.
// All BLS/SEC/GDELT/World Bank fetches go through here (server-side) — the browser never
// directly fetches those CORS/UA-restricted endpoints, so there is no CORS console spam.

import { supabase } from "../../lib/supabase";
import { readEnvKey } from "./freeSourceRegistry";

export const PROXY_FUNCTION = "public-source-proxy";

export type ProxySource = "bls" | "sec" | "gdelt" | "world_bank";

export type ProxyResult = {
  ok: boolean;
  // Mirrors the proxy/source status; "proxy_unavailable" when the function can't be reached.
  status: string;
  data: unknown;
  reason: string | null;
  docsFound?: number;
  userAgentDetected?: boolean;
  proxyUnavailable?: boolean;
};

// Single round-trip to the proxy. Never throws.
export async function callProxy(source: ProxySource, operation: string, params: Record<string, unknown> = {}): Promise<ProxyResult> {
  try {
    const { data, error } = await supabase.functions.invoke(PROXY_FUNCTION, {
      body: { source, operation, params },
    });
    if (error) {
      return {
        ok: false,
        status: "proxy_unavailable",
        data: null,
        reason: `Proxy not reachable — deploy/start "${PROXY_FUNCTION}" (supabase functions deploy ${PROXY_FUNCTION}). ${error.message ?? ""}`.trim(),
        proxyUnavailable: true,
      };
    }
    const body = (data ?? {}) as Partial<ProxyResult>;
    return {
      ok: !!body.ok,
      status: String(body.status ?? (body.ok ? "live" : "error")),
      data: body.data ?? null,
      reason: body.reason ?? null,
      docsFound: body.docsFound,
      userAgentDetected: body.userAgentDetected,
    };
  } catch (e) {
    return {
      ok: false,
      status: "proxy_unavailable",
      data: null,
      reason: `Proxy call failed — ${e instanceof Error ? e.message : "unknown error"}.`,
      proxyUnavailable: true,
    };
  }
}

// The SEC User-Agent the proxy prefers from its own env; we pass the client's VITE_ value
// as a non-secret fallback so SEC works without setting a function secret in dev.
export function clientSecUserAgent(): string | null {
  return readEnvKey("VITE_SEC_EDGAR_USER_AGENT") ?? readEnvKey("SEC_EDGAR_USER_AGENT");
}
