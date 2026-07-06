/**
 * Plate registry (THINK-153 U6+U7) — the Plates tab body.
 *
 * List + preview for all users; create / edit / palette affordances for
 * operators only (AE5). The live query lands in the Live* wrapper; a static
 * `items`/`isOperator` seam keeps the presentational body testable without
 * urql or TenantContext (mirrors ArtifactsListBody).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "urql";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import type { DocumentPlate } from "@/gql/graphql";
import { DocumentPlatesListQuery } from "@/lib/graphql-queries";
import { PlateEditDialog, type PlateEditMode } from "./PlateEditDialog";
import { PlatePreviewPanel } from "./PlatePreviewPanel";
import { PlatesTable } from "./PlatesTable";
import { parsePlate, type PlateItem } from "./plate-support";
import { TenantPaletteDialog } from "./TenantPaletteDialog";

interface PlatesData {
  documentPlates?: DocumentPlate[] | null;
}

// Preview width persists globally, mirroring the thread artifact panel.
const PREVIEW_WIDTH_STORAGE_KEY = "thinkwork:plate-preview-width-px";
export const MIN_PLATE_PREVIEW_WIDTH_PX = 360;
const DEFAULT_PLATE_PREVIEW_WIDTH_PX = 480;
let previewWidthFallbackPx = DEFAULT_PLATE_PREVIEW_WIDTH_PX;

function getStoredPlatePreviewWidthPx(): number {
  try {
    const raw = window.localStorage.getItem(PREVIEW_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(MIN_PLATE_PREVIEW_WIDTH_PX, Math.round(parsed));
    }
  } catch {
    // fall through to the module fallback
  }
  return previewWidthFallbackPx;
}

function storePlatePreviewWidthPx(widthPx: number) {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return;
  const rounded = Math.max(MIN_PLATE_PREVIEW_WIDTH_PX, Math.round(widthPx));
  previewWidthFallbackPx = rounded;
  try {
    window.localStorage.setItem(PREVIEW_WIDTH_STORAGE_KEY, String(rounded));
  } catch {
    // module fallback already updated
  }
}

/**
 * Imperative surface for the page-header actions (Settings shell): the header
 * owns the muted icon buttons; the body owns the dialogs. Mirrors the Memory
 * page's refresh-controller pattern.
 */
export interface PlatesActionsController {
  openCreate: () => void;
  openPalette: () => void;
}

export interface PlatesListBodyProps {
  /** Test seam: when provided, skips the live urql query. */
  items?: PlateItem[];
  fetching?: boolean;
  errorMessage?: string;
  /** Test seam: force the operator affordances on/off without TenantContext. */
  isOperator?: boolean;
  roleResolved?: boolean;
  /** Header integration: create/palette dialogs open via this controller. */
  onActionsControllerChange?: (
    controller: PlatesActionsController | null,
  ) => void;
}

export function PlatesListBody(props: PlatesListBodyProps = {}) {
  if (props.items) {
    return (
      <PlatesListBodyView
        items={props.items}
        fetching={props.fetching ?? false}
        errorMessage={props.errorMessage}
        tenantId={null}
        isOperator={(props.roleResolved ?? true) && !!props.isOperator}
        onActionsControllerChange={props.onActionsControllerChange}
      />
    );
  }
  return (
    <LivePlatesListBody
      onActionsControllerChange={props.onActionsControllerChange}
    />
  );
}

function LivePlatesListBody({
  onActionsControllerChange,
}: Pick<PlatesListBodyProps, "onActionsControllerChange">) {
  const { tenantId, isOperator, roleResolved } = useTenant();
  const [result, refetch] = useQuery<PlatesData>({
    query: DocumentPlatesListQuery,
    variables: { tenantId },
    requestPolicy: "cache-and-network",
    pause: !tenantId,
  });

  const items = useMemo(
    () => (result.data?.documentPlates ?? []).map(parsePlate),
    [result.data?.documentPlates],
  );

  return (
    <PlatesListBodyView
      items={items}
      fetching={result.fetching}
      errorMessage={result.error?.message}
      tenantId={tenantId}
      isOperator={roleResolved && isOperator}
      onRefetch={() => refetch({ requestPolicy: "network-only" })}
      onActionsControllerChange={onActionsControllerChange}
    />
  );
}

function PlatesListBodyView({
  items,
  fetching,
  errorMessage,
  tenantId,
  isOperator,
  onRefetch,
  onActionsControllerChange,
}: {
  items: PlateItem[];
  fetching: boolean;
  errorMessage?: string;
  tenantId: string | null;
  isOperator: boolean;
  onRefetch?: () => void;
  onActionsControllerChange?: (
    controller: PlatesActionsController | null,
  ) => void;
}) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<PlateEditMode | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Create/palette live in the page header (muted icons); operator-gated by
  // publishing the controller only when the caller may act (AE5).
  useEffect(() => {
    if (!onActionsControllerChange) return;
    if (!isOperator) {
      onActionsControllerChange(null);
      return;
    }
    onActionsControllerChange({
      openCreate: () => setEditMode({ kind: "create" }),
      openPalette: () => setPaletteOpen(true),
    });
    return () => onActionsControllerChange(null);
  }, [isOperator, onActionsControllerChange]);

  const selected = items.find((item) => item.slug === selectedSlug) ?? null;

  const showLoadingShell = fetching && items.length === 0 && !errorMessage;

  // Preview split: same interaction contract as the thread artifact panel —
  // a persisted-width ResizablePanel behind a drag handle, closable from the
  // panel header, re-opened by selecting a row.
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewDefaultWidthPx] = useState(() =>
    getStoredPlatePreviewWidthPx(),
  );
  const handlePreviewResize = useCallback((size: { inPixels: number }) => {
    storePlatePreviewWidthPx(size.inPixels);
  }, []);

  const selectRow = (slug: string) => {
    setSelectedSlug(slug);
    setPreviewOpen(true);
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 min-w-0 flex-1"
        resizeTargetMinimumSize={{ coarse: 24, fine: 10 }}
      >
        <ResizablePanel className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-full min-h-0 min-w-0 flex-col pb-4 pl-6 pr-4">
            {showLoadingShell ? (
              <div
                className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-muted-foreground"
                data-testid="plates-loading"
              >
                Loading plates…
              </div>
            ) : errorMessage && items.length === 0 ? (
              <div
                className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-muted-foreground"
                data-testid="plates-error"
              >
                Couldn&apos;t load plates: {errorMessage}
              </div>
            ) : (
              <PlatesTable
                items={items}
                selectedSlug={selectedSlug}
                onRowClick={(item) => selectRow(item.slug)}
                isOperator={isOperator}
                emptyMessage={
                  items.length === 0
                    ? "No plates yet."
                    : "No plates match your filters."
                }
              />
            )}
          </div>
        </ResizablePanel>

        {selectedSlug && previewOpen ? (
          <>
            {/* Visible resize line in the gutter, inset to match the
                table/container verticals (top rhythm + pb-4). */}
            <ResizableHandle
              withHandle
              className="mb-4 mt-11 hidden rounded-full md:flex"
            />
            <ResizablePanel
              defaultSize={`${previewDefaultWidthPx}px`}
              minSize={`${MIN_PLATE_PREVIEW_WIDTH_PX}px`}
              maxSize="70vw"
              onResize={handlePreviewResize}
              className="hidden min-h-0 min-w-0 md:flex"
            >
              {/* Own container, top-aligned with the table (toolbar row
                  above the table: h-8 controls + gap-3) and pb-4 to the
                  screen edge. */}
              <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col pb-4 pl-4 pr-6 pt-11">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
                  <PlatePreviewPanel
                    tenantId={tenantId}
                    slug={selectedSlug}
                    displayName={selected?.displayName}
                    onClose={() => setPreviewOpen(false)}
                    onEdit={
                      isOperator && selected
                        ? () => setEditMode({ kind: "edit", plate: selected })
                        : undefined
                    }
                    onClone={
                      isOperator && selected
                        ? () => setEditMode({ kind: "clone", source: selected })
                        : undefined
                    }
                  />
                </div>
              </div>
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>

      {editMode ? (
        <PlateEditDialog
          open={editMode !== null}
          onOpenChange={(open) => {
            if (!open) setEditMode(null);
          }}
          mode={editMode}
          tenantId={tenantId}
          onSaved={() => onRefetch?.()}
        />
      ) : null}

      {paletteOpen ? (
        <TenantPaletteDialog
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          tenantId={tenantId}
          onSaved={() => onRefetch?.()}
        />
      ) : null}
    </div>
  );
}
