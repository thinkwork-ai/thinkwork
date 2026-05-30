import type { ReactNode } from "react";
import { cn } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";

/**
 * Publishes a settings section's title (and optional action) to the settings
 * header bar as a single breadcrumb. Renders nothing in the content body — the
 * title lives in the header now. `description` is accepted for call-site
 * compatibility but no longer rendered. Detail pages that need nested
 * breadcrumbs call `usePageHeaderActions` directly instead of using this.
 */
export function SettingsHeader({
  title,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  usePageHeaderActions({
    title,
    breadcrumbs: [{ label: title }],
    action: actions ?? undefined,
    actionKey: actions ? `settings-header:${title}` : undefined,
  });
  return null;
}

/** Outer padding wrapper for a settings content pane. */
export function SettingsPane({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-3xl px-6 pb-10 pt-6", className)}>
      {children}
    </div>
  );
}

/**
 * Full-height layout for table sections: header + optional toolbar pinned at
 * top, the table area filling the rest (so a `scrollable` DataTable scrolls its
 * body and pins pagination to the bottom — matching the Memory section).
 */
/**
 * Shared style for a muted link-style action (e.g. "+ New Space", "+ Invite
 * member", "Workspace", "Rename") — low-emphasis text that brightens on hover.
 */
export const settingsLinkActionClassName =
  "text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:underline";

export function SettingsTablePane({
  title,
  actions,
  toolbar,
  loading,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  /** When true, render a centered loading shimmer in the table area (the
   *  toolbar stays visible) — mirroring the Memory page's load behavior. */
  loading?: boolean;
  children: ReactNode;
}) {
  // Title relocates to the settings header bar as a breadcrumb. The search
  // toolbar (left) and primary action (right, a muted link) share a row above
  // the table in the content body.
  usePageHeaderActions({ title, breadcrumbs: [{ label: title }] });
  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      {toolbar || actions ? (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">{toolbar}</div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** A labeled group of settings (e.g. "Permissions", "Organization"). */
export function SettingsSection({
  label,
  action,
  children,
}: {
  label?: string;
  /** Optional right-justified header action (e.g. a muted "Rename" link). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      {label || action ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-medium text-foreground">{label}</h2>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

/** A single label/value/control row inside a SettingsSection card. */
export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          {children}
        </div>
      ) : null}
    </div>
  );
}
