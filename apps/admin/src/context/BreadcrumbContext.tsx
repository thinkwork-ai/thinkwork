import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface BreadcrumbPopoverItem {
  label: string;
  href: string;
}

export interface Breadcrumb {
  label: string;
  href?: string;
  /** When set, the crumb renders as a popover trigger with a list of links */
  popoverItems?: BreadcrumbPopoverItem[];
}

interface BreadcrumbContextValue {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (crumbs: Breadcrumb[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [breadcrumbs, setBreadcrumbsState] = useState<Breadcrumb[]>([]);

  const setBreadcrumbs = useCallback((crumbs: Breadcrumb[]) => {
    setBreadcrumbsState(crumbs);
  }, []);

  useEffect(() => {
    if (breadcrumbs.length > 0) {
      const title = [...breadcrumbs]
        .reverse()
        .map((b) => b.label)
        .join(" · ");
      document.title = `${title} · Thinkwork`;
    } else {
      document.title = "Thinkwork Admin";
    }
  }, [breadcrumbs]);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, setBreadcrumbs }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs(crumbs?: Breadcrumb[]) {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) throw new Error("useBreadcrumbs must be used within BreadcrumbProvider");

  // Convenience: set breadcrumbs on mount when passed directly
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (crumbs) ctx.setBreadcrumbs(crumbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(crumbs)]);

  return ctx;
}
