import type { ReactNode } from "react";
import { cn } from "@thinkwork/ui";

/** Page title at the top of a settings section's content pane. */
export function SettingsHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
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
    <div className={cn("mx-auto w-full max-w-3xl px-8 py-10", className)}>
      {children}
    </div>
  );
}

/** A labeled group of settings (e.g. "Permissions", "Organization"). */
export function SettingsSection({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      {label ? (
        <h2 className="mb-3 text-base font-medium text-foreground">{label}</h2>
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
