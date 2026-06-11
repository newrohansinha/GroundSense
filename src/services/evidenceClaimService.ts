// Evidence claim classification for GroundSense quality gate.
// Deterministic keyword-based classification — no LLM calls.

export type ClaimType =
  | "freight_rate_change"
  | "tariff_rate_change"
  | "commodity_price_change"
  | "supply_disruption"
  | "demand_signal"
  | "competitor_signal"
  | "customer_signal"
  | "supplier_signal"
  | "financial_signal"
  | "macro_signal"
  | "irrelevant_or_noise";

export type IssueDriver =
  | "freight_logistics_cost"
  | "tariff_trade_policy"
  | "steel_metals_pricing"
  | "copper_pricing"
  | "aluminum_pricing"
  | "manufacturing_demand"
  | "construction_demand"
  | "competitor_pressure"
  | "service_level_backorders"
  | "supplier_concentration"
  | "inventory_working_capital"
  | "irrelevant";

export type EvidenceDirectness =
  | "company_specific"
  | "customer_segment_specific"
  | "industry_specific"
  | "broad_market"
  | "unrelated";

export type ClassifiedEvidenceClaim = {
  title: string;
  source: string;
  claim_type: ClaimType;
  driver: IssueDriver;
  evidence_directness: EvidenceDirectness;
  alignment_note: string;
};

export type EvidenceAlignmentResult = {
  alignedCount: number;
  irrelevantCount: number;
  alignmentScore: number;
  summary: string;
};

// ─── Noise patterns: clearly unrelated content ────────────────────────────────

const NOISE_PATTERNS: RegExp[] = [
  // Tech / cyber / espionage (not industrial)
  /drone\s*(market|growth|defense|autonomous)/i,
  /oceanlotus/i,
  /apt32/i,
  /cyber\s*espionage/i,
  /espionage.*spy/i,
  /spy\s*on\s*domestic/i,
  /malware\s*campaign/i,
  // Big tech earnings unrelated to industrial
  /oracle\s*reports.*revenue/i,
  /oracle\s*reports.*profit/i,
  /oracle.*negative\s*cash\s*flow/i,
  /negative\s*cash\s*flow\s*from.*ai/i,
  /ai\s*race/i,
  // Defense / military
  /defense\s*spending.*soar/i,
  /military\s*spending\s*boom/i,
  // Crypto / speculation
  /\b(bitcoin|ethereum|crypto|nft|blockchain)\b/i,
  // Entertainment / lifestyle
  /\bcelebrity\b.*\b(scandal|net worth|wedding)/i,
  /\b(taylor swift|pop star|box office)\b/i,
  /gaming\s*revenue.*esport/i,
];

// ─── Driver keyword patterns ───────────────────────────────────────────────────

type DriverPatternSet = { driver: IssueDriver; patterns: RegExp[] };

const DRIVER_PATTERNS: DriverPatternSet[] = [
  {
    driver: "freight_logistics_cost",
    patterns: [
      /freight\s*(rate|cost|market|spike|surge|rise|increase)/i,
      /container\s*(rate|freight|shipping|cost|price)/i,
      /shipping\s*(cost|rate|surge|increase|disruption)/i,
      /ocean\s*(freight|carrier|rate|shipping)/i,
      /port\s*(congestion|delay|disruption|backlog)/i,
      /logistics\s*(cost|disruption|pressure)/i,
      /carrier\s*(surcharge|rate|congestion)/i,
      /supply\s*chain\s*(disruption|pressure|cost)/i,
      /demurrage|drayage/i,
      /trucking\s*(rate|cost|capacity)/i,
      /freight.*geopolit/i,
      /freight.*peak.season/i,
    ],
  },
  {
    driver: "tariff_trade_policy",
    patterns: [
      /tariff/i,
      /trade\s*(war|policy|tension|restriction|deal|dispute)/i,
      /import\s*(duty|tariff|restriction)/i,
      /customs\s*duty/i,
      /anti.dumping/i,
      /section\s*(232|301)/i,
      /trade\s*deficit/i,
      /trade\s*sanction/i,
      /wto\s*(ruling|dispute)/i,
    ],
  },
  {
    driver: "steel_metals_pricing",
    patterns: [
      /steel\s*(price|tariff|production|import|demand|market)/i,
      /steel\s*(bolster|domestic|output)/i,
      /iron\s*ore/i,
      /hot.rolled\s*steel/i,
      /cold.rolled\s*steel/i,
      /domestic\s*steel\s*production/i,
      /steel\s*import/i,
      /steel.*\d+\s*%/i,
      /scrap\s*metal/i,
      /rebar\s*price/i,
    ],
  },
  {
    driver: "copper_pricing",
    patterns: [
      /copper\s*(price|demand|supply|market|decline|fall|rise)/i,
      /copper.*geopolit/i,
      /copper.*rate\s*hike/i,
    ],
  },
  {
    driver: "aluminum_pricing",
    patterns: [
      /aluminum\s*(price|tariff|production|demand)/i,
      /aluminium\s*(price|tariff|market)/i,
      /bauxite/i,
    ],
  },
  {
    driver: "construction_demand",
    patterns: [
      /construction\s*(spending|demand|activity|start|market|growth|boom|sector)/i,
      /building\s*permit/i,
      /housing\s*(start|market|construction)/i,
      /nonresidential\s*(construction|spending)/i,
      /commercial\s*(construction|real\s*estate|building)/i,
      /infrastructure\s*(spending|investment)/i,
      /homebuilder/i,
      /contractor\s*(demand|activity)/i,
      /construction.*mro/i,
      /mro.*construction/i,
    ],
  },
  {
    driver: "manufacturing_demand",
    patterns: [
      /manufacturing\s*(demand|output|activity|growth|pmi|order|expansion)/i,
      /industrial\s*(demand|output|production|activity|growth)/i,
      /ism\s*manufacturing/i,
      /pmi.*manufactur/i,
      /manufactur.*pmi/i,
      /factory\s*(order|output|utilization)/i,
      /capacity\s*utilization.*manufactur/i,
    ],
  },
  {
    driver: "competitor_pressure",
    patterns: [
      /grainger/i,
      /msc\s*industrial/i,
      /applied\s*industrial/i,
      /fastenal.*competitor/i,
      /distributor.*compet/i,
      /market\s*share.*distribution/i,
    ],
  },
  {
    driver: "service_level_backorders",
    patterns: [
      /backorder/i,
      /stockout/i,
      /fill\s*rate/i,
      /out.of.stock/i,
      /delivery\s*delay/i,
      /inventory\s*shortage/i,
    ],
  },
  {
    driver: "supplier_concentration",
    patterns: [
      /supplier\s*concentration/i,
      /sole\s*source/i,
      /single\s*source/i,
      /vendor\s*dependency/i,
      /supply\s*disruption.*single/i,
    ],
  },
  {
    driver: "inventory_working_capital",
    patterns: [
      /inventory\s*(level|build|depletion|turnover)/i,
      /working\s*capital/i,
      /cash\s*conversion\s*cycle/i,
      /days\s*inventory/i,
    ],
  },
];

// ─── Detection helpers ────────────────────────────────────────────────────────

function isNoise(title: string, source: string): boolean {
  const text = `${title} ${source}`;
  return NOISE_PATTERNS.some((p) => p.test(text));
}

function detectDriver(title: string, source: string): IssueDriver {
  const text = `${title} ${source}`;
  for (const { driver, patterns } of DRIVER_PATTERNS) {
    if (patterns.some((p) => p.test(text))) return driver;
  }
  return "irrelevant";
}

function toClaimType(driver: IssueDriver): ClaimType {
  const map: Partial<Record<IssueDriver, ClaimType>> = {
    freight_logistics_cost: "freight_rate_change",
    tariff_trade_policy: "tariff_rate_change",
    steel_metals_pricing: "commodity_price_change",
    copper_pricing: "commodity_price_change",
    aluminum_pricing: "commodity_price_change",
    manufacturing_demand: "demand_signal",
    construction_demand: "demand_signal",
    competitor_pressure: "competitor_signal",
    service_level_backorders: "supply_disruption",
    supplier_concentration: "supplier_signal",
    inventory_working_capital: "financial_signal",
    irrelevant: "irrelevant_or_noise",
  };
  return map[driver] ?? "macro_signal";
}

function detectDirectness(title: string, source: string, driver: IssueDriver): EvidenceDirectness {
  if (driver === "irrelevant") return "unrelated";
  const text = `${title} ${source}`.toLowerCase();
  if (/fastenal|fast\b|fastn/i.test(text)) return "company_specific";
  if (/(earnings|guidance|ceo|management|segment\s*revenue|customer\s*order|backlog|pipeline)/i.test(text)) {
    return "customer_segment_specific";
  }
  const industrySources = [
    "supplychaindive", "manufacturingdive", "freightwaves", "thomasnet",
    "industrial distribution", "mro", "ism report", "freight waves",
  ];
  if (industrySources.some((s) => text.includes(s))) return "industry_specific";
  return "broad_market";
}

// Related drivers (tariff and steel/metals are co-related in GroundSense context)
function isRelatedDriver(detected: IssueDriver, issueDriver: string): boolean {
  const related: Record<string, IssueDriver[]> = {
    tariff_trade_policy: ["steel_metals_pricing", "aluminum_pricing", "copper_pricing"],
    steel_metals_pricing: ["tariff_trade_policy"],
    aluminum_pricing: ["tariff_trade_policy"],
    copper_pricing: ["tariff_trade_policy"],
  };
  return related[issueDriver]?.includes(detected) ?? false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function classifyEvidenceItems(
  evidenceItems: { title?: string; source?: string; [key: string]: unknown }[],
  issueDriver: string
): ClassifiedEvidenceClaim[] {
  return evidenceItems.map((item) => {
    const title = String(item.title || "");
    const source = String(item.source || "");

    if (isNoise(title, source)) {
      return {
        title,
        source,
        claim_type: "irrelevant_or_noise" as ClaimType,
        driver: "irrelevant" as IssueDriver,
        evidence_directness: "unrelated" as EvidenceDirectness,
        alignment_note: "Detected as noise or unrelated content — does not support this issue",
      };
    }

    const detected = detectDriver(title, source);
    const claim_type = toClaimType(detected);
    const evidence_directness = detectDirectness(title, source, detected);
    const aligned = detected === issueDriver || isRelatedDriver(detected, issueDriver);

    return {
      title,
      source,
      claim_type,
      driver: detected,
      evidence_directness,
      alignment_note: aligned
        ? `Aligned with ${issueDriver}`
        : detected === "irrelevant"
        ? `No matching operating driver detected`
        : `Detected as ${detected} — expected ${issueDriver}`,
    };
  });
}

export function computeEvidenceAlignment(
  claims: ClassifiedEvidenceClaim[],
  issueDriver: string
): EvidenceAlignmentResult {
  if (claims.length === 0) {
    return { alignedCount: 0, irrelevantCount: 0, alignmentScore: 0, summary: "No evidence items" };
  }

  const aligned = claims.filter(
    (c) =>
      c.driver !== "irrelevant" &&
      c.claim_type !== "irrelevant_or_noise" &&
      (c.driver === issueDriver || isRelatedDriver(c.driver, issueDriver))
  );

  const irrelevant = claims.filter(
    (c) => c.driver === "irrelevant" || c.claim_type === "irrelevant_or_noise"
  );

  const alignmentScore = Math.round((aligned.length / claims.length) * 100);

  return {
    alignedCount: aligned.length,
    irrelevantCount: irrelevant.length,
    alignmentScore,
    summary: `${aligned.length} of ${claims.length} evidence items align with ${issueDriver}`,
  };
}
