// Calibration Center — public service API (Part 4 facade).
// Thin, named entry points delegating to the store + workbench modules.

import type { CompanyCalibrationInput } from "../calibrationService";
import type { CalibrationState, DomainKey, DomainRow } from "./types";
import { loadState, applyRows, clearDomain } from "./calibrationStore";
import { buildCalibrationWorkbench, type CalibrationWorkbench } from "./workbenchService";

export * from "./types";
export { CALIBRATION_DOMAINS, getDomain } from "./calibrationDomains";
export { buildCalibrationWorkbench } from "./workbenchService";
export { useCalibrationWorkbench } from "./useCalibrationWorkbench";
export { downloadTemplate, generateTemplateCsv, getSampleRows } from "./csvTemplateService";
export { parseCsv, validateCsvRows, previewCsvImport, normalizeCsvRows } from "./csvImportService";
export { getCalibrationActivityLog, summarizeRecentChanges } from "./calibrationActivityService";

// ── Read APIs ─────────────────────────────────────────────────────────────────

export function getCalibrationWorkbench(
  companyId: string,
  base: CompanyCalibrationInput | null,
  blockedCandidateCount = 0
): CalibrationWorkbench {
  return buildCalibrationWorkbench(loadState(companyId), base, blockedCandidateCount);
}

export function getCalibrationSummary(
  companyId: string,
  base: CompanyCalibrationInput | null
): CalibrationWorkbench["summary"] {
  return getCalibrationWorkbench(companyId, base).summary;
}

export function getCalibrationState(companyId: string): CalibrationState {
  return loadState(companyId);
}

// ── Write APIs (one per domain, plus manual + reset) ──────────────────────────

const saveDomain = (domain: DomainKey) => (companyId: string, rows: DomainRow[], sourceName = "CSV import") =>
  applyRows(companyId, domain, rows, "imported_csv", sourceName);

export const saveFreightLaneRows = saveDomain("freight");
export const saveSupplierRows = saveDomain("supplier");
export const saveCrmRows = saveDomain("crm");
export const saveFinancialRows = saveDomain("financial");
export const saveInventoryRows = saveDomain("inventory");
export const saveCompetitiveRows = saveDomain("competitive");
export const saveForecastOutcome = (companyId: string, rows: DomainRow[]) =>
  applyRows(companyId, "outcomes", rows, "manual", "Forecast outcome");

export function saveManualCalibrationEntry(companyId: string, domain: DomainKey, row: DomainRow) {
  return applyRows(companyId, domain, [row], "manual", "Manual entry");
}

export function resetCalibrationDomain(companyId: string, domain: DomainKey) {
  return clearDomain(companyId, domain);
}
