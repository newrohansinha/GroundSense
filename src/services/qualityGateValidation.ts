// Quality gate validation fixtures.
// Run: npx ts-node src/services/qualityGateValidation.ts
// Or call validateQualityGateFixtures() from browser console.

import { evaluateOpportunityGate, evaluateRiskGate } from "./issueQualityGateService";
import { classifyEvidenceItems, computeEvidenceAlignment } from "./evidenceClaimService";

type FixtureResult = {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  details?: string;
};

// ─── Fixture 1: Bad construction opportunity (drone/cyber/Oracle evidence) ────
// MUST quarantine. Never publish to executive dashboard.

function testBadConstructionOpportunity(): FixtureResult {
  const opportunity = {
    id: "test-bad-construction-01",
    title: "Construction Demand Opportunity",
    summary: "Construction Demand Opportunity. 3 signals.",
    confidence: 30,
    evidence_items: [
      {
        title: "Global Drone Market Enters Hyper-Growth Phase as Defense Spending and Industrial Automation Soar",
        source: "techcrunch.com",
      },
      {
        title: "Vietnam-aligned OceanLotus pivots to spy on domestic targets as it takes a more selective approach abroad, ESET Research finds",
        source: "eset.com",
      },
      {
        title: "Oracle reports record revenue and profit — and $24 billion of negative cash flow from the AI race",
        source: "fortune.com",
      },
    ],
  };

  const result = evaluateOpportunityGate(opportunity);

  const passed = result.decision === "quarantine";
  return {
    name: "Bad construction opportunity (drone/cyber/Oracle evidence)",
    passed,
    expected: "quarantine",
    actual: result.decision,
    details: `Quality score: ${result.qualityScore}, Alignment: ${result.evidenceAlignmentScore}%, Aligned: ${result.alignedCount}/${result.evidenceCount}. Reasons: ${result.reasons.join("; ")}`,
  };
}

// ─── Fixture 2: Freight risk (legitimate evidence) ────────────────────────────
// MUST publish.

function testFreightRisk(): FixtureResult {
  const risk = {
    id: "test-freight-01",
    risk_title: "Asia-to-US Container Freight Rates Spike Amid Geopolitical Tensions and Congestion",
    risk_type: "freight_cost",
    issue_category: "freight_logistics_cost",
    display_section: "risk_register",
    confidence: 80,
    evidence_items: [
      {
        title: "Asia-to-US Container Freight Rates Spike Amid Geopolitical Tensions and Congestion",
        source: "freightwaves.com",
      },
      {
        title: "Port Congestion Drives Carrier Surcharges on Trans-Pacific Lanes",
        source: "supplychaindive.com",
      },
      {
        title: "Shipping Costs Rise 15% as Peak Season Demand Hits Container Markets",
        source: "reuters.com",
      },
    ],
  };

  const result = evaluateRiskGate(risk);

  const passed = result.decision === "publish";
  return {
    name: "Freight risk (legitimate freight/shipping evidence)",
    passed,
    expected: "publish",
    actual: result.decision,
    details: `Quality score: ${result.qualityScore}, Alignment: ${result.evidenceAlignmentScore}%, Aligned: ${result.alignedCount}/${result.evidenceCount}`,
  };
}

// ─── Fixture 3: Steel/tariff risk ────────────────────────────────────────────
// MUST publish.

function testSteelTariffRisk(): FixtureResult {
  const risk = {
    id: "test-steel-tariff-01",
    risk_title: "US Steel Tariffs Continue to Bolster Domestic Production",
    risk_type: "tariff_risk",
    issue_category: "tariff_trade_policy",
    display_section: "risk_register",
    confidence: 75,
    evidence_items: [
      {
        title: "US Steel Tariffs Continue to Bolster Domestic Production",
        source: "supplychaindive.com",
      },
      {
        title: "Steel Imports Fall 30% in 2026 as Tariff Policy Supports Domestic Mills",
        source: "reuters.com",
      },
    ],
  };

  const result = evaluateRiskGate(risk);

  const passed = result.decision === "publish";
  return {
    name: "Steel/tariff risk (legitimate tariff evidence)",
    passed,
    expected: "publish",
    actual: result.decision,
    details: `Quality score: ${result.qualityScore}, Alignment: ${result.evidenceAlignmentScore}%, Aligned: ${result.alignedCount}/${result.evidenceCount}`,
  };
}

// ─── Fixture 4: Evidence classifier — noise detection ─────────────────────────

function testEvidenceClassifier(): FixtureResult {
  const evidenceItems = [
    { title: "Global Drone Market Enters Hyper-Growth Phase", source: "techcrunch.com" },
    { title: "OceanLotus pivots to spy on domestic targets", source: "eset.com" },
    { title: "Oracle reports record revenue and negative cash flow from AI race", source: "fortune.com" },
  ];

  const claims = classifyEvidenceItems(evidenceItems, "construction_demand");
  const allIrrelevant = claims.every(
    (c) => c.driver === "irrelevant" || c.claim_type === "irrelevant_or_noise"
  );

  return {
    name: "Evidence classifier detects drone/cyber/Oracle as irrelevant noise",
    passed: allIrrelevant,
    expected: "all 3 classified as irrelevant_or_noise",
    actual: claims.map((c) => `${c.title.slice(0, 30)}: ${c.claim_type}`).join("; "),
    details: `Alignment score: ${computeEvidenceAlignment(claims, "construction_demand").alignmentScore}%`,
  };
}

// ─── Fixture 5: Not forecast eligible when quarantined ────────────────────────

function testForecastEligibility(): FixtureResult {
  const opportunity = {
    id: "test-forecast-01",
    title: "Construction Demand Opportunity",
    confidence: 30,
    evidence_items: [
      { title: "Global Drone Market Enters Hyper-Growth Phase", source: "techcrunch.com" },
      { title: "OceanLotus pivots to spy on domestic targets", source: "eset.com" },
    ],
  };

  const result = evaluateOpportunityGate(opportunity);
  const passed = result.decision === "quarantine" && result.forecastEligible === false;

  return {
    name: "Quarantined opportunity is not forecast eligible",
    passed,
    expected: "quarantine + forecastEligible=false",
    actual: `${result.decision} + forecastEligible=${result.forecastEligible}`,
  };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export function validateQualityGateFixtures(): { allPassed: boolean; results: FixtureResult[] } {
  const fixtures = [
    testBadConstructionOpportunity,
    testFreightRisk,
    testSteelTariffRisk,
    testEvidenceClassifier,
    testForecastEligibility,
  ];

  const results = fixtures.map((fn) => {
    try {
      return fn();
    } catch (err) {
      return {
        name: fn.name,
        passed: false,
        expected: "no error",
        actual: `threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  const allPassed = results.every((r) => r.passed);

  console.group("GroundSense Quality Gate Validation");
  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    const style = r.passed ? "color: green" : "color: red";
    console.log(`%c${icon} ${r.name}`, style);
    if (!r.passed) {
      console.log(`  Expected: ${r.expected}`);
      console.log(`  Actual:   ${r.actual}`);
    }
    if (r.details) console.log(`  Details:  ${r.details}`);
  }
  console.log(
    `%c${allPassed ? "✓ All fixtures passed" : "✗ Some fixtures failed"} (${results.filter((r) => r.passed).length}/${results.length})`,
    allPassed ? "color: green; font-weight: bold" : "color: red; font-weight: bold"
  );
  console.groupEnd();

  return { allPassed, results };
}
