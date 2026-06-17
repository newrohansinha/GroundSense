// Adapter registry — maps source_id → adapter implementation.

import type { SourceAdapter } from "../types";
import { blsAdapter } from "./blsAdapter";
import { secEdgarAdapter } from "./secEdgarAdapter";
import { gdeltAdapter } from "./gdeltAdapter";
import { worldBankAdapter } from "./worldBankAdapter";
import { fredAdapter } from "./fredAdapter";
import { censusTradeAdapter } from "./censusTradeAdapter";
import { usitcAdapter } from "./usitcAdapter";
import { unComtradeAdapter } from "./unComtradeAdapter";
import { manualStructuredMetricAdapter } from "./manualStructuredMetricAdapter";

export const ADAPTERS: SourceAdapter[] = [
  blsAdapter,
  secEdgarAdapter,
  gdeltAdapter,
  worldBankAdapter,
  fredAdapter,
  censusTradeAdapter,
  usitcAdapter,
  unComtradeAdapter,
  manualStructuredMetricAdapter,
];

export const ADAPTER_BY_ID: Record<string, SourceAdapter> = ADAPTERS.reduce((acc, a) => {
  acc[a.sourceId] = a;
  return acc;
}, {} as Record<string, SourceAdapter>);

export function getAdapter(sourceId: string): SourceAdapter | undefined {
  return ADAPTER_BY_ID[sourceId];
}
