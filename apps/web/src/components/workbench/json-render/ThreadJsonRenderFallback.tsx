import { AlertTriangle } from "lucide-react";

import type {
  ThreadJsonRenderDiagnostic,
  ThreadJsonRenderMobileFallback,
} from "./validation";

export interface ThreadJsonRenderFallbackProps {
  component?: string;
  fallback?: ThreadJsonRenderMobileFallback;
  diagnostics?: ThreadJsonRenderDiagnostic[];
  rejectedUpdate?: boolean;
  legacy?: boolean;
}

export function ThreadJsonRenderFallback({
  component,
  fallback,
  diagnostics = [],
  rejectedUpdate = false,
  legacy = false,
}: ThreadJsonRenderFallbackProps) {
  const primaryDiagnostic = diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  const title = legacy
    ? "Legacy generated UI unsupported"
    : rejectedUpdate
      ? "Update rejected"
      : (fallback?.title ?? "Generated UI unavailable");
  const summary =
    fallback?.summary ??
    primaryDiagnostic?.message ??
    (legacy
      ? "This data-genui payload uses the retired generated UI contract."
      : "This generated UI cannot be rendered inline.");

  return (
    <section
      aria-label={title}
      className="grid gap-2 rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground"
      data-testid={
        rejectedUpdate
          ? "json-render-rejected-update"
          : legacy
            ? "json-render-legacy-fallback"
            : "json-render-fallback"
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-amber-500" />
        <h3 className="min-w-0 truncate text-sm font-medium text-foreground">
          {title}
        </h3>
        {component ? (
          <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
            {component}
          </span>
        ) : null}
      </div>
      <p className="text-sm leading-5">{summary}</p>
      {fallback?.lines?.length ? (
        <ul className="grid gap-1 text-xs">
          {fallback.lines.slice(0, 4).map((line, index) => (
            <li key={`${line}-${index}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {primaryDiagnostic && primaryDiagnostic.message !== summary ? (
        <p className="text-xs text-muted-foreground">
          {primaryDiagnostic.message}
        </p>
      ) : null}
    </section>
  );
}
