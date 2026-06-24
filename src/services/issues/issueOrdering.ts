// Canonical, deterministic ordering for buyer surfaces — one source of truth so the
// Risk Register, Dashboard Exposure Graph, Issue Register, Executive Actions, and Driver
// Priority Map never disagree. Without a tiebreaker, two issues with the same
// priority_score (e.g. Copper and Aluminum both 75) sort arbitrarily and "Copper randomly
// appears after Aluminum". These comparators are total orders (always end on title), so
// the result is stable across rerenders and reruns.

// deno-lint-ignore-file no-explicit-any

function absEstimate(x: any): number {
  const fi = x?.formula_inputs;
  const v = Number(
    x?.estimate ??
    x?.execValue ??
    (fi && typeof fi === "object" ? fi.result : undefined) ??
    x?.impact_high ??
    x?.dollar ??
    0,
  );
  return Number.isFinite(v) ? Math.abs(v) : 0;
}

function titleOf(x: any): string {
  return String(x?.title ?? x?.risk_title ?? x?.issue_key ?? "");
}

// Issue order: priority desc → |business estimate| desc → title asc.
export function compareIssues(a: any, b: any): number {
  const pa = Number(a?.priority_score ?? 0);
  const pb = Number(b?.priority_score ?? 0);
  if (pb !== pa) return pb - pa;
  const ia = absEstimate(a);
  const ib = absEstimate(b);
  if (ib !== ia) return ib - ia;
  return titleOf(a).localeCompare(titleOf(b));
}

export function orderIssues<T>(issues: T[]): T[] {
  return [...issues].sort(compareIssues);
}

// Action order: logistics-driver actions first (Freight, then Diesel/fuel), then the rest
// by priority / |estimate| / title. Logistics actions are time-sensitive (surcharge resets,
// lane repricing) and lead the executive action list; procurement metal actions follow.
// For the canonical Fastenal set this yields: Freight, Diesel, Steel, Copper, Aluminum.
const DRIVER_RANK: Array<[string, number]> = [
  ["freight", 0], ["logistics", 0],
  ["fuel", 1], ["diesel", 1],
];
function driverRank(x: any): number {
  const d = String(x?.driver ?? x?.driver_category ?? x?.issue_key ?? x?.title ?? "").toLowerCase();
  for (const [key, rank] of DRIVER_RANK) if (d.includes(key)) return rank;
  return 2;
}

export function compareActions(a: any, b: any): number {
  const da = driverRank(a);
  const db = driverRank(b);
  if (da !== db) return da - db;
  return compareIssues(a, b);
}

export function orderActions<T>(items: T[]): T[] {
  return [...items].sort(compareActions);
}
