import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface PageHeaderActions {
  title: string;
  /** When set, AppTopBar shows a back arrow that links to this href */
  backHref?: string;
  /** Optional secondary text displayed next to the title (e.g., "216 threads") */
  subtitle?: string;
  /** When true, hide the AppTopBar entirely on this page (still updates document.title) */
  hideTopBar?: boolean;
}

interface PageHeaderContextValue {
  actions: PageHeaderActions | null;
  setActions: (actions: PageHeaderActions | null) => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [actions, setActionsState] = useState<PageHeaderActions | null>(null);

  const setActions = useCallback((next: PageHeaderActions | null) => {
    setActionsState(next);
  }, []);

  useEffect(() => {
    document.title = actions ? `${actions.title} · ThinkWork` : "ThinkWork";
  }, [actions]);

  return (
    <PageHeaderContext.Provider value={{ actions, setActions }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

export function usePageHeader() {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeader must be used within PageHeaderProvider");
  return ctx;
}

export function usePageHeaderActions(actions: PageHeaderActions | null) {
  const ctx = usePageHeader();
  const key = actions
    ? `${actions.title}|${actions.backHref ?? ""}|${actions.subtitle ?? ""}|${actions.hideTopBar ? "hidden" : "shown"}`
    : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    ctx.setActions(actions);
    return () => ctx.setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
