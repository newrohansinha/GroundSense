# public-source-proxy

A minimal, **allowlisted** server-side proxy for the four FREE/public data sources used by
GroundSense Source Hub. It exists only to solve browser-level networking limits — it is **not**
an open/arbitrary URL proxy and requires **no paid keys**.

## Why this exists

| Source | Why a proxy is needed |
|--------|----------------------|
| BLS Public Data API | Browser fetch is blocked (no `Access-Control-Allow-Origin`). |
| SEC EDGAR | Requires a descriptive `User-Agent` header that browsers forbid `fetch` from setting. |
| GDELT Doc API | Browser fetch is inconsistent / CORS-blocked. |
| World Bank | Works from browser, but routed here too for consistency + zero console noise. |

## Security

- Only `source ∈ { bls, sec, gdelt, world_bank }` and known `operation`s are accepted.
- The client sends **structured params only** (e.g. `seriesId`, `ticker`, `indicatorCode`);
  the proxy builds every upstream URL itself. No arbitrary URLs.
- All params are pattern-validated (series/ticker/CIK/country/indicator) and length-limited.
- `POST` + `OPTIONS` only. Timeouts on every upstream call.
- **No secrets are returned.** The SEC `User-Agent` is read server-side; the response only
  reports `userAgentDetected: true|false`, never the email.

## Request shape

```jsonc
POST /functions/v1/public-source-proxy
{
  "source": "bls",
  "operation": "series",
  "params": { "seriesIds": ["WPU101"], "startYear": "2024", "endYear": "2026" }
}
```

Operations: `bls.series`, `sec.companyfacts|submissions|ticker_lookup`,
`gdelt.doc_search`, `world_bank.indicator`.

## Local run

```bash
supabase functions serve public-source-proxy --env-file supabase/.env.local
```

`supabase/.env.local` (optional — only needed for live SEC):

```
SEC_EDGAR_USER_AGENT=GroundSense your-email@example.com
```

## Deploy

```bash
supabase functions deploy public-source-proxy
```

To enable live SEC in production, set the function secret (not committed):

```bash
supabase secrets set SEC_EDGAR_USER_AGENT="GroundSense your-email@example.com"
```

## SEC User-Agent resolution

The proxy prefers `SEC_EDGAR_USER_AGENT` (or `VITE_SEC_EDGAR_USER_AGENT`) from its own
environment. As a dev convenience it also accepts a non-secret `params.userAgent` fallback
(the frontend forwards its `VITE_SEC_EDGAR_USER_AGENT`). Production should set the function
secret. If neither is present, SEC returns `status: "needs_user_agent"`.
