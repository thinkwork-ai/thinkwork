import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageLayoutProps {
  /** Fixed header area — PageHeader, toolbars, filters */
  header: ReactNode;
  /** Scrollable content area */
  children: ReactNode;
  contentClassName?: string;
}

export function PageLayout({
  header,
  children,
  contentClassName,
}: PageLayoutProps) {
  return (
    <div className="flex flex-col -m-6 h-[calc(100%+48px)] min-w-0">
      <div className="shrink-0 px-4 pt-3 pb-3 min-w-0">{header}</div>
      <div
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 min-h-0 min-w-0",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
