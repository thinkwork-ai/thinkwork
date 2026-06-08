import type { ReactNode } from "react";
import { cn } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";

/**
 * Null-rendering publisher for the page header. Kept as a child component (not
 * a top-level hook call) so a parent that owns the header can suppress it by
 * not rendering it — without a conditional `null` hook call that would clobber
 * the parent's breadcrumb when an embedded child mounts/unmounts.
 */
function TablePaneHeader({ title }: { title: string }) {
  usePageHeaderActions({ title, breadcrumbs: [{ label: title }] });
  return null;
}

/**
 * Publishes a settings section's title (and optional action) to the settings
 * header bar as a single breadcrumb, and renders the prominent in-body page
 * heading (via {@link SettingsPageTitle}). The breadcrumb gives nav context;
 * the in-body heading titles the page. Detail pages that need nested
 * breadcrumbs call `usePageHeaderActions` directly instead of using this.
 */
export function SettingsHeader({
  title,
  description,
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
  return <SettingsPageTitle title={title} description={description} />;
}

/**
 * Prominent in-body page title for a settings section. Complements the header
 * bar breadcrumb — the breadcrumb gives nav context, this gives the page its
 * heading. Rendered by `SettingsHeader`/`SettingsTablePane` for the standard
 * pages; pages that drive `usePageHeaderActions` directly render it themselves.
 */
export function SettingsPageTitle({
  title,
  description,
  badge,
  actions,
}: {
  title: string;
  description?: string;
  /** Optional element rendered inline beside the title (e.g. a status badge). */
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex shrink-0 items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {badge ? <div className="shrink-0">{badge}</div> : null}
        </div>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

/**
 * Outer padding wrapper for a settings content pane. Form/detail pages keep a
 * readable 750px column (left-justified, not centered); DataTable/list pages
 * pass `className="max-w-none"` to fill the full width.
 */
export function SettingsPane({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full max-w-[750px] px-6 pb-10 pt-6", className)}>
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
  description,
  actions,
  toolbar,
  loading,
  children,
  embedded,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  /** When true, render a centered loading shimmer in the table area (the
   *  toolbar stays visible) — mirroring the Memory page's load behavior. */
  loading?: boolean;
  children: ReactNode;
  /** When true, this pane is hosted inside a parent that owns the page header
   *  (e.g. the tabbed Memory page). Suppresses the header-bar breadcrumb so it
   *  doesn't clobber the parent's; the in-body title still renders. */
  embedded?: boolean;
}) {
  // Title shows both as a header-bar breadcrumb and as the in-body page
  // heading. The search toolbar (left) and primary action (right, a muted
  // link) share a row above the table in the content body.
  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      {embedded ? null : <TablePaneHeader title={title} />}
      <SettingsPageTitle title={title} description={description} />
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
  label: ReactNode;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
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
