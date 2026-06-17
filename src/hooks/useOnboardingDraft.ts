// Durable onboarding draft. The DB (onboarding_answers) is the source of truth;
// this hook hydrates once, holds a local draft, and debounce-saves changes so
// values survive stage changes, refresh, route changes, and sign-out/sign-in.
//
// Key correctness rules:
//  * Hydrate exactly once per company — never re-hydrate on context object
//    identity changes (that was the bug that wiped unsaved edits).
//  * A ref mirrors the draft so flush() always sees the latest values even if a
//    debounced React state update hasn't committed yet.

import { useCallback, useEffect, useRef, useState } from "react";
import { getAllOnboardingAnswers, saveAnswers } from "../services/onboardingService";

type Steps = Record<string, Record<string, unknown>>;

export type OnboardingDraft = {
  loading: boolean;
  saving: boolean;
  getStep: (stepKey: string) => Record<string, unknown>;
  setField: (stepKey: string, key: string, value: unknown) => void;
  setStep: (stepKey: string, patch: Record<string, unknown>) => void;
  flush: () => Promise<void>;
};

const DEBOUNCE_MS = 600;

export function useOnboardingDraft(companyId: string | null): OnboardingDraft {
  const [draft, setDraft] = useState<Steps>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const draftRef = useRef<Steps>({});
  const dirtyRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedFor = useRef<string | null>(null);

  // Hydrate once per company. NOTE: we intentionally do not gate the state
  // updates on an `active` cleanup flag — under React StrictMode the effect
  // mounts → unmounts → mounts, and gating would leave `loading` stuck true
  // (the second mount short-circuits on hydratedFor, and the first fetch's
  // setLoading would be skipped). The hydratedFor guard already dedupes fetches.
  useEffect(() => {
    if (!companyId) return;
    if (hydratedFor.current === companyId) return;
    hydratedFor.current = companyId;
    setLoading(true);
    getAllOnboardingAnswers(companyId)
      .then((all) => {
        draftRef.current = all;
        setDraft(all);
      })
      .catch(() => { /* keep empty draft */ })
      .finally(() => setLoading(false));
  }, [companyId]);

  const persist = useCallback(async () => {
    if (!companyId) return;
    const steps = Array.from(dirtyRef.current);
    dirtyRef.current.clear();
    if (steps.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(
        steps.map((step) => saveAnswers(companyId, step, draftRef.current[step] ?? {}))
      );
    } finally {
      setSaving(false);
    }
  }, [companyId]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void persist(); }, DEBOUNCE_MS);
  }, [persist]);

  const setStep = useCallback((stepKey: string, patch: Record<string, unknown>) => {
    const nextStep = { ...(draftRef.current[stepKey] ?? {}), ...patch };
    draftRef.current = { ...draftRef.current, [stepKey]: nextStep };
    dirtyRef.current.add(stepKey);
    setDraft(draftRef.current);
    scheduleSave();
  }, [scheduleSave]);

  const setField = useCallback((stepKey: string, key: string, value: unknown) => {
    setStep(stepKey, { [key]: value });
  }, [setStep]);

  const getStep = useCallback((stepKey: string) => draft[stepKey] ?? {}, [draft]);

  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    await persist();
  }, [persist]);

  // Flush any pending save on unmount.
  useEffect(() => () => { void persist(); }, [persist]);

  return { loading, saving, getStep, setField, setStep, flush };
}
