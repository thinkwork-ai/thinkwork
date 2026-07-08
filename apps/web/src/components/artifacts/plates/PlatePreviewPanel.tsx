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
import { Copy, Moon, Pencil, Sun, X } from "lucide-react";
import { useQuery } from "urql";
import { Button, TooltipIconButton, useTheme } from "@thinkwork/ui";
import type { DocumentPlateDiagnostic } from "@/gql/graphql";
import { DocumentPlatePreviewQuery } from "@/lib/graphql-queries";
import {
  documentThemeToken,
  withDocumentFrameEnvelope,
} from "@/components/workbench/DocumentFrame";
import { PlateConformancePanel } from "./PlateConformancePanel";

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
  /** Renders a close (X) header action — the list body owns the split. */
  onClose?: () => void;
  /** Operator actions surfaced in the panel header. */
  onEdit?: () => void;
  onClone?: () => void;
}

export function PlatePreviewPanel({
  tenantId,
  slug,
  displayName,
  html: htmlProp,
  diagnostics: diagnosticsProp,
  fetching: fetchingProp,
  errorMessage: errorProp,
  onClose,
  onEdit,
  onClone,
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

  // THINK-189 U7: the detail surface is a tab strip — Preview (default)
  // beside Conformance (aggregate rates over the report corpus). No modal,
  // no route change; the tab resets when the selected plate changes.
  const [tab, setTab] = useState<"preview" | "conformance">("preview");
  const [tabSlug, setTabSlug] = useState(slug);
  if (tabSlug !== slug) {
    setTabSlug(slug);
    setTab("preview");
  }

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col bg-background">
      {slug ? (
        <div
          className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5"
          role="tablist"
          aria-label="Plate detail views"
        >
          <Button
            type="button"
            role="tab"
            aria-selected={tab === "preview"}
            variant={tab === "preview" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setTab("preview")}
            data-testid="plate-detail-tab-preview"
          >
            Preview
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={tab === "conformance"}
            variant={tab === "conformance" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setTab("conformance")}
            data-testid="plate-detail-tab-conformance"
          >
            Conformance
          </Button>
          {tab === "conformance" && onClose ? (
            <TooltipIconButton
              type="button"
              className="ml-auto text-muted-foreground hover:text-foreground"
              label="Close preview"
              onClick={onClose}
              data-testid="plate-conformance-close"
            >
              <X className="size-4" />
            </TooltipIconButton>
          ) : null}
        </div>
      ) : null}
      {tab === "conformance" && slug ? (
        <PlateConformancePanel tenantId={tenantId} slug={slug} />
      ) : (
        <PlatePreviewFrame
          title={displayName ?? slug ?? "Plate preview"}
          slug={slug}
          html={html}
          diagnostics={diagnostics}
          fetching={fetching}
          errorMessage={errorMessage}
          onClose={onClose}
          onEdit={onEdit}
          onClone={onClone}
        />
      )}
    </div>
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
  onClose,
  onEdit,
  onClone,
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
  onClose?: () => void;
  onEdit?: () => void;
  onClone?: () => void;
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
      className={`flex h-full w-full min-h-0 min-w-0 flex-col bg-background ${className ?? ""}`}
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
          {onClone ? (
            <TooltipIconButton
              type="button"
              className="text-muted-foreground hover:text-foreground"
              label="Clone plate"
              onClick={onClone}
              data-testid="plate-clone-action"
            >
              <Copy className="size-4" />
            </TooltipIconButton>
          ) : null}
          {onEdit ? (
            <TooltipIconButton
              type="button"
              className="text-muted-foreground hover:text-foreground"
              label="Edit plate"
              onClick={onEdit}
              data-testid="plate-edit-action"
            >
              <Pencil className="size-4" />
            </TooltipIconButton>
          ) : null}
          <TooltipIconButton
            type="button"
            variant={localTheme === "light" ? "secondary" : "ghost"}
            label="Preview in light theme"
            aria-pressed={localTheme === "light"}
            onClick={() => setLocalTheme("light")}
            data-testid="plate-preview-theme-light"
          >
            <Sun className="size-4" />
          </TooltipIconButton>
          <TooltipIconButton
            type="button"
            variant={localTheme === "dark" ? "secondary" : "ghost"}
            label="Preview in dark theme"
            aria-pressed={localTheme === "dark"}
            onClick={() => setLocalTheme("dark")}
            data-testid="plate-preview-theme-dark"
          >
            <Moon className="size-4" />
          </TooltipIconButton>
          {onClose ? (
            <TooltipIconButton
              type="button"
              className="text-muted-foreground hover:text-foreground"
              label="Close preview"
              onClick={onClose}
              data-testid="plate-preview-close"
            >
              <X className="size-4" />
            </TooltipIconButton>
          ) : null}
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
