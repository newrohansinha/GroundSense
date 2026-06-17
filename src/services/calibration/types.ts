// Calibration Center — shared types.
// Pure types. No Supabase, no React.

export type DomainKey =
  | "freight"
  | "supplier"
  | "crm"
  | "financial"
  | "inventory"
  | "competitive"
  | "outcomes";

export type SourceType =
  | "imported_csv"
  | "manual"
  | "approved"
  | "demo"
  | "inferred"
  | "derived";

export type ColumnType = "text" | "number" | "money" | "percent" | "boolean" | "date" | "enum";

export type ColumnDef = {
  key: string;
  label: string;
  type: ColumnType;
  required?: boolean;
  recommended?: boolean;
  enumValues?: string[];
  unit?: string;
  // Columns that materially drive scoring/impact for the domain.
  scoringWeight?: number;
};

export type DomainCategory =
  | "freight"
  | "supplier_procurement"
  | "crm_demand"
  | "financial_anchor"
  | "inventory_service"
  | "competitive"
  | "outcome_history";

export type DomainDef = {
  key: DomainKey;
  label: string;
  shortLabel: string;
  category: DomainCategory;
  tableName: string;
  templateFile: string;
  blurb: string;
  columns: ColumnDef[];
  sampleRows: Record<string, unknown>[];
  // Human-readable list of the critical inputs this domain should eventually hold.
  criticalInputs: string[];
  // Dashboard outputs this domain affects.
  affects: string[];
  nextBestAction: string;
  // Issue keywords this domain calibrates (used for dependency map).
  improvesIssues: string[];
  // Column keys that form the natural/unique key for deduplication on re-import.
  naturalKeyFields: string[];
};

export type DomainRow = Record<string, unknown> & { __rowId?: string };

export type DataSourceRecord = {
  id: string;
  sourceName: string;
  sourceType: SourceType;
  category: DomainCategory;
  status: "active" | "draft" | "failed" | "archived";
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  completenessScore: number;
  qualityScore: number;
  lastImportedAt: string;
};

export type CalibrationRunRecord = {
  id: string;
  runType: "manual_entry" | "csv_upload" | "recalculation" | "approval" | "reset";
  category: DomainCategory | "overall";
  domainLabel: string;
  beforeScore: number;
  afterScore: number;
  inputsAdded: number;
  notes: string;
  createdAt: string;
};

// Per-domain stored state.
export type DomainState = {
  rows: DomainRow[];
  sources: DataSourceRecord[];
};

// A manually entered or approved override for a single model assumption.
// Priority sits below imported/derived row data but above the inferred base.
export type AssumptionOverride = {
  value: number;
  status: "Manual" | "Approved";
  updatedAt: string;
};

// Full workbench state, persisted per company.
export type CalibrationState = {
  companyId: string;
  domains: Record<DomainKey, DomainState>;
  runs: CalibrationRunRecord[];
  persistence: "supabase" | "local";
  updatedAt: string;
  // Per-assumption manual/approved overrides keyed by calibration field.
  assumptionOverrides?: Record<string, AssumptionOverride>;
};

// Validation result for a CSV / manual batch.
export type RowValidation = {
  rowIndex: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: DomainRow;
};

export type ValidationReport = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  warningRows: number;
  missingRequiredColumns: string[];
  rowResults: RowValidation[];
  fileLevelError: string | null;
};

// A single resolved model value with full provenance (Part 5 priority rule).
export type ResolvedValue = {
  key: string;
  label: string;
  value: number | string | null;
  unit: string;
  sourceType: SourceType;
  sourceLabel: string;
  confidence: "high" | "medium" | "low";
  lastUpdated: string | null;
  isCalibrated: boolean;
  replacedValue: number | string | null;
  usedBy: string[];
};

// Domain reliability scoring.
export type DomainScore = {
  domain: DomainKey;
  label: string;
  score: number;
  previousScore: number;
  reliabilityLabel: string;
  rowCount: number;
  sourceCount: number;
  inputsCalibrated: number;
  inputsRequired: number;
  missingInputs: string[];
  basis: string;
  affects: string[];
  nextBestAction: string;
  lastUpdated: string | null;
};

// Before/after impact for a domain.
export type ImpactPreview = {
  domain: DomainKey;
  label: string;
  hasChange: boolean;
  beforeLines: ImpactLine[];
  afterLines: ImpactLine[];
  rangeBefore: string | null;
  rangeAfter: string | null;
  rangeDeltaPct: number | null;
  confidenceBefore: string;
  confidenceAfter: string;
  affectedIssues: string[];
  remainingMissing: string[];
  summary: string;
};

export type ImpactLine = {
  label: string;
  value: string;
  source: string;
};

// Assumption inventory row.
export type AssumptionRow = {
  key: string;
  label: string;
  domain: DomainKey;
  domainLabel: string;
  value: string;
  rawValue: number | string | null;
  unit: string;
  sourceType: SourceType;
  sourceLabel: string;
  confidence: "high" | "medium" | "low";
  usedBy: string[];
  lastUpdated: string | null;
  status: "Calibrated" | "Imported" | "Manual" | "Approved" | "Demo" | "Inferred" | "Evidence-backed";
  // The inferred/base value this row's value replaced (for "Replaced: $90M inferred").
  replacedValue?: string | null;
  // True when the value comes from a manual/approved override (eligible for Reset).
  isOverride?: boolean;
};
