/**
 * Plate registry (THINK-153 U6) — read-only plate preview.
 *
 * Compiles the selected plate's exemplar via `documentPlatePreview` and renders
 * the returned HTML in the same zero-grant document iframe used by
 * DocumentFrame (`sandbox=""`, CSP + theme envelope). Unlike DocumentFrame the
 * theme is a LOCAL toggle: switching light/dark re-stamps `srcDoc` client-side
 * (no re-request) so operators can eyeball both palettes instantly.
 */

import { useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useQuery } from "urql";
import { Button, useTheme } from "@thinkwork/ui";
import type { DocumentPlateDiagnostic } from "@/gql/graphql";
import { DocumentPlatePreviewQuery } from "@/lib/graphql-queries";
import {
  documentThemeToken,
  withDocumentFrameEnvelope,
} from "@/components/workbench/DocumentFrame";

interface PreviewData {
  documentPlatePreview?: {
    html: string | null;
    diagnostics: DocumentPlateDiagnostic[];
  } | null;
}

export interface PlatePreviewPanelProps {
  tenantId: string | null;
  /** Slug to preview; null renders the empty placeholder. */
  slug: string | null;
  displayName?: string;
  /**
   * Test seam: when provided, skips the live query and renders this HTML
   * directly. `null` here means "validation failed" (shows diagnostics).
   */
  html?: string | null;
  diagnostics?: DocumentPlateDiagnostic[];
  fetching?: boolean;
  errorMessage?: string;
}

export function PlatePreviewPanel({
  tenantId,
  slug,
  displayName,
  html: htmlProp,
  diagnostics: diagnosticsProp,
  fetching: fetchingProp,
  errorMessage: errorProp,
}: PlatePreviewPanelProps) {
  const seamed =
    htmlProp !== undefined || fetchingProp === true || errorProp !== undefined;
  const [result] = useQuery<PreviewData>({
    query: DocumentPlatePreviewQuery,
    variables: { tenantId, slug: slug ?? "" },
    requestPolicy: "cache-and-network",
    pause: seamed || !slug,
  });

  const html = seamed
    ? (htmlProp ?? null)
    : (result.data?.documentPlatePreview?.html ?? null);
  const diagnostics = seamed
    ? (diagnosticsProp ?? [])
    : (result.data?.documentPlatePreview?.diagnostics ?? []);
  const fetching = seamed ? (fetchingProp ?? false) : result.fetching;
  const errorMessage = seamed ? errorProp : result.error?.message;

  return (
    <PlatePreviewFrame
      title={displayName ?? slug ?? "Plate preview"}
      slug={slug}
      html={html}
      diagnostics={diagnostics}
      fetching={fetching}
      errorMessage={errorMessage}
    />
  );
}

/**
 * Presentational preview surface: the iframe + local theme toggle + loading /
 * error / diagnostics states. Shared by the panel and the edit dialog.
 */
export function PlatePreviewFrame({
  title,
  slug,
  html,
  diagnostics,
  fetching,
  errorMessage,
  pending,
  className,
}: {
  title: string;
  slug: string | null;
  html: string | null;
  diagnostics: DocumentPlateDiagnostic[];
  fetching?: boolean;
  errorMessage?: string;
  /** U7: a debounced preview request is in flight (shows "Compiling…"). */
  pending?: boolean;
  className?: string;
}) {
  const { theme } = useTheme();
  const [localTheme, setLocalTheme] = useState<"light" | "dark">(() =>
    documentThemeToken(theme),
  );

  const srcDoc = useMemo(
    () => (html ? withDocumentFrameEnvelope(html, localTheme) : ""),
    [html, localTheme],
  );

  return (
    <div
      className={`flex min-h-0 flex-col rounded-lg border border-border bg-background ${className ?? ""}`}
      data-testid="plate-preview"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" title={title}>
            {title}
          </div>
          {pending ? (
            <div
              className="text-xs text-muted-foreground"
              data-testid="plate-preview-pending"
            >
              Compiling…
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant={localTheme === "light" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Preview in light theme"
            aria-pressed={localTheme === "light"}
            onClick={() => setLocalTheme("light")}
            data-testid="plate-preview-theme-light"
          >
            <Sun className="size-4" />
          </Button>
          <Button
            type="button"
            variant={localTheme === "dark" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Preview in dark theme"
            aria-pressed={localTheme === "dark"}
            onClick={() => setLocalTheme("dark")}
            data-testid="plate-preview-theme-dark"
          >
            <Moon className="size-4" />
          </Button>
        </div>
      </div>

      {diagnostics.length > 0 ? (
        <div
          className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          data-testid="plate-preview-diagnostics"
        >
          <div className="font-medium">This plate has validation issues:</div>
          <ul className="mt-1 list-disc pl-4">
            {diagnostics.map((d, i) => (
              <li key={`${d.code}-${i}`}>{d.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {!slug ? (
          <div
            className="flex h-full items-center justify-center px-6 py-12 text-sm text-muted-foreground"
            data-testid="plate-preview-empty"
          >
            Select a plate to preview it here.
          </div>
        ) : errorMessage ? (
          <div
            className="flex h-full items-center justify-center px-6 py-12 text-sm text-muted-foreground"
            data-testid="plate-preview-error"
          >
            Couldn&apos;t compile this plate: {errorMessage}
          </div>
        ) : html ? (
          <iframe
            title={title}
            srcDoc={srcDoc}
            sandbox=""
            data-testid="plate-preview-frame"
            className="block h-full min-h-[420px] w-full border-0 bg-background"
          />
        ) : fetching ? (
          <div
            className="flex h-full items-center justify-center px-6 py-12 text-sm text-muted-foreground"
            data-testid="plate-preview-loading"
          >
            Compiling preview…
          </div>
        ) : diagnostics.length > 0 ? (
          <div className="flex h-full items-center justify-center px-6 py-12 text-sm text-muted-foreground">
            Fix the issues above to see a preview.
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 py-12 text-sm text-muted-foreground">
            No preview available.
          </div>
        )}
      </div>
    </div>
  );
}
