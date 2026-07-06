/**
 * Plate registry (THINK-153 U6+U7) — the Plates tab body.
 *
 * List + preview for all users; create / edit / palette affordances for
 * operators only (AE5). The live query lands in the Live* wrapper; a static
 * `items`/`isOperator` seam keeps the presentational body testable without
 * urql or TenantContext (mirrors ArtifactsListBody).
 */

import { useMemo, useState } from "react";
import { Palette, Plus } from "lucide-react";
import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
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

export interface PlatesListBodyProps {
  /** Test seam: when provided, skips the live urql query. */
  items?: PlateItem[];
  fetching?: boolean;
  errorMessage?: string;
  /** Test seam: force the operator affordances on/off without TenantContext. */
  isOperator?: boolean;
  roleResolved?: boolean;
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
      />
    );
  }
  return <LivePlatesListBody />;
}

function LivePlatesListBody() {
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
}: {
  items: PlateItem[];
  fetching: boolean;
  errorMessage?: string;
  tenantId: string | null;
  isOperator: boolean;
  onRefetch?: () => void;
}) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<PlateEditMode | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const selected = items.find((item) => item.slug === selectedSlug) ?? null;

  const showLoadingShell = fetching && items.length === 0 && !errorMessage;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pt-3"
        data-testid="plates-toolbar"
      >
        {isOperator ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              data-testid="plates-tenant-palette"
            >
              <Palette className="size-4" />
              Tenant palette
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setEditMode({ kind: "create" })}
              data-testid="plates-new"
            >
              <Plus className="size-4" />
              New plate
            </Button>
          </>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-4 pt-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
              onRowClick={(item) => setSelectedSlug(item.slug)}
              isOperator={isOperator}
              onEdit={(item) => setEditMode({ kind: "edit", plate: item })}
              onClone={(item) => setEditMode({ kind: "clone", source: item })}
              emptyMessage={
                items.length === 0
                  ? "No plates yet."
                  : "No plates match your filters."
              }
            />
          )}
        </div>

        {selectedSlug ? (
          <div className="hidden min-h-0 w-[440px] max-w-[45%] shrink-0 lg:flex lg:flex-col">
            <PlatePreviewPanel
              tenantId={tenantId}
              slug={selectedSlug}
              displayName={selected?.displayName}
            />
          </div>
        ) : null}
      </div>

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
