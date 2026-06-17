// Source Fusion validation fixtures (Part 15).
// Pure, dependency-free assertions over the verified-shock + claim-extraction logic.
// No test runner is installed, so these are exercised via tsc on build and can be run
// from a dev console: `import { runSourceFusionFixtures } from ...; runSourceFusionFixtures()`.

import { getRegistrySnapshot, hasConfiguredKey, getSourceById } from "./freeSourceRegistry";
import { deriveShockFromMetric, verifyArticleClaimAgainstMetrics } from "./verifiedShockService";
import { extractClaimsFromText } from "./articleMetricClaimService";
import type { ArticleMetricClaim, NormalizedMetric } from "./types";

export type FixtureResult = { name: string; pass: boolean; detail: string };

function metric(partial: Partial<NormalizedMetric>): NormalizedMetric {
  return {
    source_id: "manual_structured_metric_csv",
    metric_key: "m",
    metric_name: "metric",
    category: "tariff",
    driver: "tariff",
    unit: "%",
    value: null,
    baseline_value: null,
    current_value: null,
    percent_change: null,
    trust_tier: "user_imported_structured_data",
    ...partial,
  };
}

function claim(partial: Partial<ArticleMetricClaim>): ArticleMetricClaim {
  return {
    claim_text: "",
    extracted_value: null,
    extracted_unit: null,
    metric_key: null,
    driver: null,
    period_text: null,
    verification_status: "article_claim_only",
    ...partial,
  };
}

export function runSourceFusionFixtures(): FixtureResult[] {
  const results: FixtureResult[] = [];

  // Test 1 — Article-only freight number, no freight metric → article_claim_only.
  {
    const c = claim({ driver: "freight", extracted_value: 30, extracted_unit: "%" });
    const { status } = verifyArticleClaimAgainstMetrics(c, []);
    results.push({
      name: "1. Freight article claim, no metric → article_claim_only",
      pass: status === "article_claim_only",
      detail: `status=${status}`,
    });
  }

  // Test 2 — Manual tariff CSV 25 → 15 → verified_manual_structured_metric + shock created.
  {
    const m = metric({ metric_key: "steel_tariff", driver: "tariff", baseline_value: 25, current_value: 15, percent_change: -40 });
    const shock = deriveShockFromMetric(m, 1);
    results.push({
      name: "2. Manual tariff 25→15 → verified_manual_structured_metric shock",
      pass: !!shock && shock.verification_status === "verified_manual_structured_metric" && shock.shock_type === "tariff_rate_change" && shock.current_value === 15,
      detail: shock ? `status=${shock.verification_status} type=${shock.shock_type} current=${shock.current_value}` : "no shock",
    });
  }

  // Test 3 — Copper article claim, no commodity metric configured → article_claim_only (pending review).
  {
    const c = claim({ driver: "copper", extracted_value: 12, extracted_unit: "%" });
    const { status } = verifyArticleClaimAgainstMetrics(c, [metric({ driver: "tariff", metric_key: "steel_tariff", current_value: 15 })]);
    results.push({
      name: "3. Copper claim, no copper metric → article_claim_only",
      pass: status === "article_claim_only",
      detail: `status=${status}`,
    });
  }

  // Test 4 — Official (BLS) metric → shock with official verification + provenance.
  {
    const m = metric({ source_id: "bls_public_api", trust_tier: "official_government", category: "producer_prices", driver: "steel", metric_key: "bls_wpu101", baseline_value: 100, current_value: 112, percent_change: 12, unit: "index" });
    const shock = deriveShockFromMetric(m, 1);
    results.push({
      name: "4. BLS metric → verified_official_source ppi_change shock",
      pass: !!shock && shock.verification_status === "verified_official_source" && shock.shock_type === "ppi_change" && (shock.percent_change ?? 0) === 12,
      detail: shock ? `status=${shock.verification_status} type=${shock.shock_type} pct=${shock.percent_change}` : "no shock",
    });
  }

  // Test 5 — Conflicting article claim vs structured metrics from divergent sources → conflicting_sources.
  {
    const c = claim({ driver: "steel", extracted_value: 50, extracted_unit: "%" });
    const metrics = [
      metric({ source_id: "bls_public_api", trust_tier: "official_government", driver: "steel", metric_key: "steel_a", current_value: 100 }),
      metric({ source_id: "manual_structured_metric_csv", trust_tier: "user_imported_structured_data", driver: "steel", metric_key: "steel_b", current_value: 150 }),
    ];
    const { status, matchedMetric } = verifyArticleClaimAgainstMetrics(c, metrics);
    results.push({
      name: "5. Conflicting steel metrics → conflicting_sources, official wins",
      pass: status === "conflicting_sources" && matchedMetric?.source_id === "bls_public_api",
      detail: `status=${status} winner=${matchedMetric?.source_id}`,
    });
  }

  // Test 6 — Unconfigured FRED/Census/USITC → not_configured_key_required (no throw).
  {
    const snap = getRegistrySnapshot();
    const keyed = ["fred_api", "census_trade_api", "usitc_dataweb_api"];
    const allGraceful = keyed.every((id) => {
      const s = getSourceById(id)!;
      const configured = hasConfiguredKey(s);
      const entry = snap.find((x) => x.id === id)!;
      return configured ? entry.baseline_status === "live" : entry.baseline_status === "not_configured_key_required";
    });
    results.push({
      name: "6. Unconfigured free-key sources → not_configured_key_required (no throw)",
      pass: allGraceful,
      detail: keyed.map((id) => `${id}:${snap.find((x) => x.id === id)?.baseline_status}`).join(", "),
    });
  }

  // Test 7 — Article extractor pulls a tariff "25% to 15%" claim.
  {
    const claims = extractClaimsFromText("The tariff on steel was cut from 25% to 15% this quarter.");
    const tariff = claims.find((c) => c.driver === "tariff");
    results.push({
      name: "7. Extractor finds tariff 25%→15% claim",
      pass: !!tariff && tariff.extracted_value === 15,
      detail: `claims=${claims.length} tariffValue=${tariff?.extracted_value}`,
    });
  }

  // Test 8 — SEC status reflects User-Agent presence (Part 2).
  {
    const sec = getRegistrySnapshot().find((x) => x.id === "sec_edgar_api")!;
    // Without VITE_SEC_EDGAR_USER_AGENT the baseline must be needs_user_agent (never generic).
    const expected = (sec.configured && sec.baseline_status === "live") || sec.baseline_status === "needs_user_agent";
    results.push({
      name: "8. SEC status is needs_user_agent (or live if UA set), never generic",
      pass: expected,
      detail: `status=${sec.baseline_status}`,
    });
  }

  // Test 9 — GDELT is context_only at baseline.
  {
    const g = getRegistrySnapshot().find((x) => x.id === "gdelt_doc_api")!;
    results.push({
      name: "9. GDELT baseline = context_only",
      pass: g.baseline_status === "context_only",
      detail: `status=${g.baseline_status}`,
    });
  }

  // Test 10 — Macro/context metric → low-confidence macro context shock (capped).
  {
    const m = metric({ source_id: "world_bank_indicators", trust_tier: "official_multilateral", category: "macroeconomic", driver: "macro_demand_context", metric_key: "wb_gdp", baseline_value: 2.1, current_value: 2.8, percent_change: 33, unit: "%" });
    const shock = deriveShockFromMetric(m, 1);
    results.push({
      name: "10. World Bank macro shock is capped low-confidence context",
      pass: !!shock && (shock.confidence_score ?? 100) <= 45,
      detail: shock ? `conf=${shock.confidence_score} note=${shock.notes.slice(0, 30)}` : "no shock",
    });
  }

  return results;
}

// Convenience: returns true if all fixtures pass.
export function allFixturesPass(): boolean {
  return runSourceFusionFixtures().every((r) => r.pass);
}
