import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import {
  ensureWorkspace,
  getCompany,
  isDemoMode,
  setActiveCompany,
  type Company,
} from "../services/companyService";

type CompanyContextValue = {
  company: Company | null;
  loading: boolean;
  demo: boolean;
  // Set when workspace setup failed for an authenticated user; the UI can offer
  // a "Retry workspace setup" that re-runs ensureWorkspace (never auth.signUp).
  setupError: boolean;
  // Writes are allowed only for an authenticated member (never in public demo).
  canWrite: boolean;
  // True once we know whether the user has a completed-onboarding company.
  onboardingComplete: boolean;
  refresh: () => Promise<void>;
};

const CompanyContext = createContext<CompanyContextValue | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState(false);
  const demo = isDemoMode() && !user;
  // Tracks which user we've already loaded a workspace for. Supabase fires
  // onAuthStateChange (TOKEN_REFRESHED) on every tab focus with a NEW user
  // object — without this guard that re-ran the whole workspace load and made
  // the dashboard appear to reload and lose in-flight run progress.
  const loadedUserIdRef = useRef<string | null>(null);

  const load = useCallback(async (opts?: { forceReload?: boolean }) => {
    if (authLoading) return;
    if (user && !opts?.forceReload && loadedUserIdRef.current === user.id && company) {
      return; // same user already loaded — token refresh / tab focus, skip reload
    }
    setLoading(true);
    setSetupError(false);
    try {
      if (user) {
        // Authenticated → guarantee a workspace and make it the active company
        // for every existing page (which reads localStorage). Idempotent; a
        // failure here is recoverable via refresh() and never re-runs signUp.
        const { company: c } = await ensureWorkspace(user);
        setActiveCompany(c.id);
        setCompany(c);
        loadedUserIdRef.current = user.id;
      } else if (isDemoMode()) {
        // Public demo path — load the labeled Fastenal workspace, no auth.
        loadedUserIdRef.current = null;
        const id = localStorage.getItem("groundsense_company_id");
        setCompany(id ? await getCompany(id) : null);
      } else {
        loadedUserIdRef.current = null;
        setCompany(null);
      }
    } catch {
      setCompany(null);
      if (user) setSetupError(true);
    } finally {
      setLoading(false);
    }
  }, [user, authLoading, company]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => load({ forceReload: true }), [load]);

  const value = useMemo<CompanyContextValue>(
    () => ({
      company,
      loading: loading || authLoading,
      demo,
      setupError,
      canWrite: !!user && !demo,
      onboardingComplete: company?.onboarding_status === "completed",
      refresh,
    }),
    [company, loading, authLoading, demo, setupError, user, refresh]
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within a CompanyProvider");
  return ctx;
}
