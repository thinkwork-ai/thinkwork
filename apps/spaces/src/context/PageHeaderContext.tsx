import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface PageHeaderActions {
  title: string;
  /**
   * Optional override for `document.title` (the browser tab). When set,
   * the tab uses this value instead of `title`, allowing the visible
   * AppTopBar header to stay short (e.g. just the thread title) while
   * the tab carries section context (e.g. "Thread · <title>") so users
   * can disambiguate between multiple Computer tabs.
   */
  documentTitle?: string;
  /** When set, AppTopBar shows a back arrow. Used as href or history fallback. */
  backHref?: string;
  /** Use browser history for the back arrow, falling back to backHref on direct entry. */
  backBehavior?: "href" | "history";
  /** Optional secondary text displayed next to the title (e.g., "216 threads") */
  subtitle?: string;
  /**
   * Optional inline content rendered immediately to the right of the
   * title (before the subtitle). Use for compact title-anchored
   * affordances like a pin/unpin toggle. The right-side `action` slot is
   * still available for menus and overflow controls.
   */
  titleTrailing?: ReactNode;
  /** When true, hide the AppTopBar entirely on this page (still updates document.title) */
  hideTopBar?: boolean;
  /**
   * Optional tab strip rendered centered in the AppTopBar — used by the
   * Memory layout (and any future multi-tab layout) to fold the tab
   * strip into the page header instead of stacking a sub-header below it.
   * The active tab is highlighted by AppTopBar based on the current pathname.
   */
  tabs?: { to: string; label: string }[];
  /** Optional compact action controls rendered at the right side of AppTopBar. */
  action?: ReactNode;
  /** Stable key used to refresh the header when action controls appear/disappear. */
  actionKey?: string;
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
    const docTitle = actions?.documentTitle ?? actions?.title;
    document.title = docTitle ? `${docTitle} · ThinkWork` : "ThinkWork";
  }, [actions]);

  return (
    <PageHeaderContext.Provider value={{ actions, setActions }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

export function usePageHeader() {
  const ctx = useContext(PageHeaderContext);
  if (!ctx)
    throw new Error("usePageHeader must be used within PageHeaderProvider");
  return ctx;
}

export function usePageHeaderActions(actions: PageHeaderActions | null) {
  const ctx = usePageHeader();
  const tabsKey =
    actions?.tabs?.map((t) => `${t.to}:${t.label}`).join(",") ?? "";
  const key = actions
    ? `${actions.title}|${actions.documentTitle ?? ""}|${actions.backHref ?? ""}|${actions.backBehavior ?? ""}|${actions.subtitle ?? ""}|${actions.hideTopBar ? "hidden" : "shown"}|${tabsKey}|${actions.actionKey ?? ""}|${actions.titleTrailing ? "tt1" : "tt0"}`
    : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    ctx.setActions(actions);
    return () => ctx.setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
