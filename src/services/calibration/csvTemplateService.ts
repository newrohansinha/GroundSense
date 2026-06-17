// Calibration Center — CSV template generation + download.
// Pure helpers plus one browser download function.

import type { DomainKey } from "./types";
import { getDomain } from "./calibrationDomains";

export function getTemplateColumns(domain: DomainKey): string[] {
  return getDomain(domain).columns.map((c) => c.key);
}

export function getSampleRows(domain: DomainKey): Record<string, unknown>[] {
  return getDomain(domain).sampleRows;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateTemplateCsv(domain: DomainKey, includeSample = true): string {
  const def = getDomain(domain);
  const cols = def.columns.map((c) => c.key);
  const header = cols.join(",");
  if (!includeSample) return header + "\n";
  const rows = def.sampleRows.map((row) =>
    cols.map((c) => csvCell(row[c])).join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

export function downloadTemplate(domain: DomainKey, includeSample = false): void {
  const def = getDomain(domain);
  const csv = generateTemplateCsv(domain, includeSample);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = def.templateFile;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
