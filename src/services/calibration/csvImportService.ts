// Calibration Center — CSV parsing, validation, normalization, preview.
// Pure functions (parsing/validation) + DB-or-local persistence handled by calibrationStore.

import type {
  ColumnDef,
  DomainKey,
  DomainRow,
  RowValidation,
  ValidationReport,
} from "./types";
import { getDomain } from "./calibrationDomains";

// ── CSV parsing (handles quoted cells, commas, escaped quotes) ────────────────

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clean) return { headers: [], rows: [] };

  const lines = splitCsvLines(clean);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "\n" && !inQuotes) {
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

// ── Value coercion ────────────────────────────────────────────────────────────

const TRUE_VALUES = new Set(["true", "yes", "y", "1", "t"]);
const FALSE_VALUES = new Set(["false", "no", "n", "0", "f", ""]);

function parseBoolean(raw: string): { value: boolean | null; unknown: boolean } {
  const v = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return { value: true, unknown: false };
  if (FALSE_VALUES.has(v)) return { value: false, unknown: false };
  return { value: null, unknown: true };
}

function parseNumber(raw: string): number | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[$,%\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ── Validation + normalization ────────────────────────────────────────────────

const HUGE_MONEY_THRESHOLD = 50_000_000_000; // $50B — flag as suspicious for a single row

function validateRow(
  domain: DomainKey,
  raw: Record<string, unknown>,
  rowIndex: number,
  seenKeys: Set<string>
): RowValidation {
  const def = getDomain(domain);
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized: DomainRow = {};

  for (const col of def.columns) {
    const rawVal = raw[col.key];
    const strVal = rawVal === null || rawVal === undefined ? "" : String(rawVal).trim();

    if (col.required && strVal === "") {
      errors.push(`${col.label} is required`);
      normalized[col.key] = null;
      continue;
    }

    if (strVal === "") {
      if (col.recommended) warnings.push(`${col.label} missing (recommended)`);
      normalized[col.key] = col.type === "boolean" ? false : null;
      continue;
    }

    normalized[col.key] = coerceAndCheck(col, strVal, errors, warnings);
  }

  // Domain-specific cross-field checks.
  applyDomainRules(domain, normalized, warnings, errors);

  // Duplicate detection on the row's identity column.
  const idKey = dedupeKey(domain, normalized);
  if (idKey && seenKeys.has(idKey)) {
    warnings.push(`Possible duplicate of an earlier row (${idKey})`);
  }
  if (idKey) seenKeys.add(idKey);

  return {
    rowIndex,
    valid: errors.length === 0,
    errors,
    warnings,
    normalized,
  };
}

function coerceAndCheck(
  col: ColumnDef,
  strVal: string,
  errors: string[],
  warnings: string[]
): unknown {
  switch (col.type) {
    case "number":
    case "money": {
      const n = parseNumber(strVal);
      if (n === null) {
        errors.push(`${col.label} must be numeric (got "${strVal}")`);
        return null;
      }
      if (col.type === "money" && Math.abs(n) > HUGE_MONEY_THRESHOLD) {
        warnings.push(`${col.label} is unusually large (${strVal}) — verify units`);
      }
      return n;
    }
    case "percent": {
      const n = parseNumber(strVal);
      if (n === null) {
        errors.push(`${col.label} must be numeric (got "${strVal}")`);
        return null;
      }
      if (n < 0 || n > 100) {
        warnings.push(`${col.label} should be between 0 and 100 (got ${n})`);
      }
      return n;
    }
    case "boolean": {
      const { value, unknown } = parseBoolean(strVal);
      if (unknown) {
        warnings.push(`${col.label} has unknown boolean value "${strVal}" — treated as false`);
        return false;
      }
      return value;
    }
    case "enum": {
      const lower = strVal.toLowerCase();
      if (col.enumValues && !col.enumValues.includes(lower)) {
        warnings.push(`${col.label} "${strVal}" not in [${col.enumValues.join(", ")}]`);
      }
      return lower;
    }
    case "date":
      return strVal;
    default:
      return strVal;
  }
}

function applyDomainRules(
  domain: DomainKey,
  row: DomainRow,
  warnings: string[],
  _errors: string[]
): void {
  if (domain === "supplier") {
    if (row.tariff_exposed === true && (!row.country_of_origin || row.country_of_origin === "")) {
      warnings.push("Tariff-exposed supplier missing country of origin");
    }
    const spend = Number(row.annual_spend ?? 0);
    const openPo = Number(row.open_po_exposure ?? 0);
    if (spend > 0 && openPo > spend) {
      warnings.push("Open PO exposure exceeds annual spend");
    }
  }
  if (domain === "crm") {
    const hasSignal =
      row.pipeline_value != null ||
      row.quote_volume != null ||
      row.quote_volume_change_pct != null ||
      row.order_growth_pct != null ||
      row.revenue_current_period != null;
    if (!hasSignal) {
      warnings.push("Row has no demand signal (pipeline/quote/order/revenue)");
    }
  }
  if (domain === "financial") {
    if (row.revenue == null) warnings.push("Revenue missing — anchor is weaker without it");
    if (row.freight_spend == null && row.commodity_spend == null) {
      warnings.push("Both freight_spend and commodity_spend missing");
    }
  }
}

function dedupeKey(domain: DomainKey, row: DomainRow): string | null {
  switch (domain) {
    case "freight": return row.lane_name ? String(row.lane_name).toLowerCase() : null;
    case "supplier": return row.supplier_name ? String(row.supplier_name).toLowerCase() : null;
    case "crm": return row.account_name ? `${row.segment}|${row.account_name}`.toLowerCase() : null;
    case "financial": return row.period ? String(row.period).toLowerCase() : null;
    case "inventory": return row.product_category ? `${row.product_category}|${row.location}`.toLowerCase() : null;
    case "competitive": return row.account_name ? `${row.competitor_name}|${row.account_name}`.toLowerCase() : null;
    case "outcomes": return row.issue_title ? String(row.issue_title).toLowerCase() : null;
    default: return null;
  }
}

export function validateCsvRows(domain: DomainKey, rows: Record<string, unknown>[]): ValidationReport {
  const def = getDomain(domain);
  const presentColumns = rows.length > 0 ? new Set(Object.keys(rows[0])) : new Set<string>();
  const missingRequiredColumns = def.columns
    .filter((c) => c.required && !presentColumns.has(c.key))
    .map((c) => c.key);

  if (rows.length === 0) {
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      warningRows: 0,
      missingRequiredColumns,
      rowResults: [],
      fileLevelError: "No data rows found in file.",
    };
  }

  if (missingRequiredColumns.length > 0) {
    return {
      totalRows: rows.length,
      validRows: 0,
      invalidRows: rows.length,
      warningRows: 0,
      missingRequiredColumns,
      rowResults: [],
      fileLevelError: `Missing required column${missingRequiredColumns.length > 1 ? "s" : ""}: ${missingRequiredColumns.join(", ")}`,
    };
  }

  const seenKeys = new Set<string>();
  const rowResults = rows.map((r, i) => validateRow(domain, r, i, seenKeys));
  const validRows = rowResults.filter((r) => r.valid).length;
  const invalidRows = rowResults.length - validRows;
  const warningRows = rowResults.filter((r) => r.warnings.length > 0).length;

  return {
    totalRows: rows.length,
    validRows,
    invalidRows,
    warningRows,
    missingRequiredColumns: [],
    rowResults,
    fileLevelError: null,
  };
}

export function normalizeCsvRows(domain: DomainKey, rows: Record<string, unknown>[]): DomainRow[] {
  const report = validateCsvRows(domain, rows);
  return report.rowResults.filter((r) => r.valid).map((r) => r.normalized);
}

export function previewCsvImport(domain: DomainKey, rows: Record<string, unknown>[]): ValidationReport {
  return validateCsvRows(domain, rows);
}
