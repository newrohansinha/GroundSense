// Calibration Center — runtime state store.
// localStorage-first (demo mode) with best-effort Supabase write-through.
// Never throws to the UI; falls back to local on any DB failure.

import { supabase } from "../../lib/supabase";
import { isDemoMode } from "../companyService";
import type {
  CalibrationState,
  DataSourceRecord,
  DomainKey,
  DomainRow,
  DomainState,
  CalibrationRunRecord,
  SourceType,
} from "./types";
import { CALIBRATION_DOMAINS, getDomain } from "./calibrationDomains";
import { scoreDomain } from "./calibrationDataQualityService";

const ALL_KEYS: DomainKey[] = CALIBRATION_DOMAINS.map((d) => d.key);

function storeKey(companyId: string): string {
  return `gs-calibration-workbench:${companyId}`;
}

function emptyDomains(): Record<DomainKey, DomainState> {
  const out = {} as Record<DomainKey, DomainState>;
  for (const k of ALL_KEYS) out[k] = { rows: [], sources: [] };
  return out;
}

export function emptyState(companyId: string): CalibrationState {
  return {
    companyId,
    domains: emptyDomains(),
    runs: [],
    persistence: "local",
    updatedAt: new Date().toISOString(),
  };
}

export function loadState(companyId: string): CalibrationState {
  if (!companyId) return emptyState("unknown");
  try {
    const raw = localStorage.getItem(storeKey(companyId));
    if (!raw) return emptyState(companyId);
    const parsed = JSON.parse(raw) as CalibrationState;
    // Repair shape for any newly-added domains.
    const domains = emptyDomains();
    for (const k of ALL_KEYS) {
      if (parsed.domains && parsed.domains[k]) domains[k] = parsed.domains[k];
    }
    return { ...parsed, companyId, domains, runs: parsed.runs ?? [], assumptionOverrides: parsed.assumptionOverrides ?? {} };
  } catch {
    return emptyState(companyId);
  }
}

function persistLocal(state: CalibrationState): void {
  try {
    localStorage.setItem(storeKey(state.companyId), JSON.stringify(state));
  } catch {
    // storage full / unavailable — ignore
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Best-effort Supabase write-through ────────────────────────────────────────

async function tryPersistSupabase(
  companyId: string,
  domain: DomainKey,
  rows: DomainRow[],
  source: DataSourceRecord
): Promise<boolean> {
  // Public demo is read-only — never write rows to the demo company.
  if (isDemoMode()) return false;
  const def = getDomain(domain);
  try {
    const { data: sourceRow, error: sourceErr } = await supabase
      .from("company_data_sources")
      .insert({
        company_id: companyId,
        source_name: source.sourceName,
        source_type: source.sourceType,
        category: source.category,
        status: "active",
        completeness_score: source.completenessScore,
        quality_score: source.qualityScore,
        row_count: source.rowCount,
        valid_row_count: source.validRowCount,
        invalid_row_count: source.invalidRowCount,
        last_imported_at: source.lastImportedAt,
      })
      .select("id")
      .single();
    if (sourceErr || !sourceRow) return false;

    const payload = rows.map((r) => ({
      company_id: companyId,
      data_source_id: sourceRow.id,
      ...stripRowMeta(r),
    }));
    const { error: rowsErr } = await supabase.from(def.tableName).insert(payload);
    if (rowsErr) return false;
    return true;
  } catch {
    return false;
  }
}

function stripRowMeta(row: DomainRow): Record<string, unknown> {
  const { __rowId, ...rest } = row;
  void __rowId;
  return rest;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function rowNaturalKey(domain: DomainKey, row: DomainRow): string {
  const keyFields = getDomain(domain).naturalKeyFields ?? [];
  if (!keyFields.length) return "";
  return keyFields.map((f) => String(row[f] ?? "").toLowerCase().trim()).join("\x00");
}

function dedupeApply(
  domain: DomainKey,
  existing: DomainRow[],
  incoming: DomainRow[]
): { combined: DomainRow[]; added: number; replaced: number } {
  const keyFields = getDomain(domain).naturalKeyFields;
  if (!keyFields?.length) {
    return { combined: [...existing, ...incoming], added: incoming.length, replaced: 0 };
  }

  // Index existing rows by natural key → position
  const keyToIdx = new Map<string, number>();
  for (let i = 0; i < existing.length; i++) {
    const k = rowNaturalKey(domain, existing[i]);
    if (k) keyToIdx.set(k, i);
  }

  let added = 0;
  let replaced = 0;
  const result = [...existing];

  for (const row of incoming) {
    const k = rowNaturalKey(domain, row);
    if (k && keyToIdx.has(k)) {
      // Upsert: replace existing row, preserve its internal __rowId
      const idx = keyToIdx.get(k)!;
      result[idx] = { ...row, __rowId: result[idx].__rowId };
      replaced++;
    } else {
      result.push(row);
      if (k) keyToIdx.set(k, result.length - 1);
      added++;
    }
  }

  return { combined: result, added, replaced };
}

// Classify an incoming batch against existing rows by natural key (Part 12 preview).
// Pure — does not mutate state. Used to show new/update counts before applying.
export function previewDedupe(
  domain: DomainKey,
  existing: DomainRow[],
  incoming: DomainRow[]
): { newCount: number; updateCount: number } {
  const keyFields = getDomain(domain).naturalKeyFields;
  if (!keyFields?.length) return { newCount: incoming.length, updateCount: 0 };

  const existingKeys = new Set(existing.map((r) => rowNaturalKey(domain, r)).filter(Boolean));
  // Track keys seen within the incoming batch so intra-batch dupes count as updates too.
  const seen = new Set<string>();
  let newCount = 0;
  let updateCount = 0;
  for (const row of incoming) {
    const k = rowNaturalKey(domain, row);
    if (k && (existingKeys.has(k) || seen.has(k))) updateCount++;
    else newCount++;
    if (k) seen.add(k);
  }
  return { newCount, updateCount };
}

// ── Public mutations ──────────────────────────────────────────────────────────

export type ApplyResult = {
  state: CalibrationState;
  beforeScore: number;
  afterScore: number;
  persisted: "supabase" | "local";
  added: number;
  replaced: number;
};

export async function applyRows(
  companyId: string,
  domain: DomainKey,
  newRows: DomainRow[],
  sourceType: SourceType,
  sourceName: string
): Promise<ApplyResult> {
  const state = loadState(companyId);
  const def = getDomain(domain);
  const beforeScore = scoreDomain(domain, state.domains[domain].rows);

  const stamped = newRows.map((r) => ({ ...r, __rowId: uid() }));
  const { combined, added, replaced } = dedupeApply(domain, state.domains[domain].rows, stamped);
  const afterScore = scoreDomain(domain, combined);

  const source: DataSourceRecord = {
    id: uid(),
    sourceName,
    sourceType,
    category: def.category,
    status: "active",
    rowCount: added + replaced,
    validRowCount: added + replaced,
    invalidRowCount: 0,
    completenessScore: afterScore,
    qualityScore: afterScore,
    lastImportedAt: new Date().toISOString(),
  };

  // Only write genuinely new rows to Supabase; replaced rows were already persisted.
  const toWrite = replaced > 0
    ? stamped.filter((r) => {
        const k = rowNaturalKey(domain, r);
        const existingKeys = new Set(state.domains[domain].rows.map((e) => rowNaturalKey(domain, e)));
        return !k || !existingKeys.has(k);
      })
    : stamped;
  const persisted = toWrite.length > 0
    ? await tryPersistSupabase(companyId, domain, toWrite, source)
    : true;

  const dedupeNote = replaced > 0
    ? ` (${added} new, ${replaced} updated)`
    : ``;
  const run: CalibrationRunRecord = {
    id: uid(),
    runType: sourceType === "imported_csv" ? "csv_upload" : "manual_entry",
    category: def.category,
    domainLabel: def.label,
    beforeScore,
    afterScore,
    inputsAdded: added,
    notes: `${added + replaced} ${def.shortLabel.toLowerCase()} row${added + replaced === 1 ? "" : "s"} applied via ${sourceType === "manual" ? "manual entry" : "CSV import"}${dedupeNote}.`,
    createdAt: new Date().toISOString(),
  };

  const next: CalibrationState = {
    ...state,
    domains: {
      ...state.domains,
      [domain]: {
        rows: combined,
        sources: [...state.domains[domain].sources, source],
      },
    },
    runs: [run, ...state.runs].slice(0, 100),
    persistence: persisted ? "supabase" : "local",
    updatedAt: new Date().toISOString(),
  };
  persistLocal(next);
  return { state: next, beforeScore, afterScore, persisted: persisted ? "supabase" : "local", added, replaced };
}

export function clearDomain(companyId: string, domain: DomainKey): CalibrationState {
  const state = loadState(companyId);
  const def = getDomain(domain);
  const run: CalibrationRunRecord = {
    id: uid(),
    runType: "reset",
    category: def.category,
    domainLabel: def.label,
    beforeScore: scoreDomain(domain, state.domains[domain].rows),
    afterScore: 0,
    inputsAdded: 0,
    notes: `${def.label} calibration cleared.`,
    createdAt: new Date().toISOString(),
  };
  const next: CalibrationState = {
    ...state,
    domains: { ...state.domains, [domain]: { rows: [], sources: [] } },
    runs: [run, ...state.runs].slice(0, 100),
    updatedAt: new Date().toISOString(),
  };
  persistLocal(next);
  return next;
}

// ── Assumption overrides (Part 11) ────────────────────────────────────────────

export function setAssumptionOverride(
  companyId: string,
  key: string,
  value: number,
  status: "Manual" | "Approved"
): CalibrationState {
  const state = loadState(companyId);
  const overrides = { ...(state.assumptionOverrides ?? {}) };
  overrides[key] = { value, status, updatedAt: new Date().toISOString() };
  const run: CalibrationRunRecord = {
    id: uid(),
    runType: status === "Approved" ? "approval" : "manual_entry",
    category: "overall",
    domainLabel: "Assumption inventory",
    beforeScore: 0,
    afterScore: 0,
    inputsAdded: 1,
    notes: `${status === "Approved" ? "Approved" : "Set"} assumption ${key} = ${value}.`,
    createdAt: new Date().toISOString(),
  };
  const next: CalibrationState = {
    ...state,
    assumptionOverrides: overrides,
    runs: [run, ...state.runs].slice(0, 100),
    updatedAt: new Date().toISOString(),
  };
  persistLocal(next);
  return next;
}

export function clearAssumptionOverride(companyId: string, key: string): CalibrationState {
  const state = loadState(companyId);
  const overrides = { ...(state.assumptionOverrides ?? {}) };
  delete overrides[key];
  const next: CalibrationState = {
    ...state,
    assumptionOverrides: overrides,
    updatedAt: new Date().toISOString(),
  };
  persistLocal(next);
  return next;
}

export function getRowsByKey(state: CalibrationState): Record<DomainKey, DomainRow[]> {
  const out = {} as Record<DomainKey, DomainRow[]>;
  for (const k of ALL_KEYS) out[k] = state.domains[k]?.rows ?? [];
  return out;
}
