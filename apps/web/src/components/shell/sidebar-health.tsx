import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

/**
 * Health of the sidebar's data queries (recent threads, pinned threads,
 * Spaces). The queries live deep in {@link ChatSidebar}, but we surface their
 * error state up to the Settings item in the footer — a subtle warning badge
 * plus a Retry action — instead of printing a dramatic red GraphQL error in
 * the middle of the thread list. Errors here are usually transient (e.g.
 * "Requester user identity required" before the Cognito identity has settled)
 * and clear on a refetch.
 */
export type SidebarHealth = {
  hasError: boolean;
  /** Friendly, human-facing summary — never the raw GraphQL message. */
  message: string | null;
  /** Re-run the sidebar queries (network-only) to try to clear the error. */
  refresh: () => void;
};

const NOOP_HEALTH: SidebarHealth = {
  hasError: false,
  message: null,
  refresh: () => {},
};

type SidebarHealthContextValue = {
  health: SidebarHealth;
  reportHealth: (health: SidebarHealth) => void;
};

const SidebarHealthContext = createContext<SidebarHealthContextValue | null>(
  null,
);

export function SidebarHealthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [health, setHealth] = useState<SidebarHealth>(NOOP_HEALTH);
  const value = useMemo(() => ({ health, reportHealth: setHealth }), [health]);
  return (
    <SidebarHealthContext.Provider value={value}>
      {children}
    </SidebarHealthContext.Provider>
  );
}

/** Consumed by the footer (Settings item) to render the warning + Retry. */
export function useSidebarHealth(): SidebarHealth {
  return useContext(SidebarHealthContext)?.health ?? NOOP_HEALTH;
}

/**
 * Stable reporter used by the query owner ({@link ChatSidebar}) to publish its
 * current error state upward. Returns a no-op when no provider is mounted so
 * the component still renders in isolation (tests, storybook).
 */
export function useReportSidebarHealth(): (health: SidebarHealth) => void {
  const ctx = useContext(SidebarHealthContext);
  // Always call the hook (rules-of-hooks) so the fallback identity is stable.
  const noop = useCallback(() => {}, []);
  return ctx?.reportHealth ?? noop;
}
