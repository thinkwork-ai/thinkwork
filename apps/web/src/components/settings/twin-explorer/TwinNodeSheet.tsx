import { useMemo } from "react";
import { Badge, Button, Sheet, SheetContent } from "@thinkwork/ui";
import type { TwinGraphLink, TwinGraphNode } from "@thinkwork/graph";

/** What the graph surfaces open in the property sheet. */
export type TwinSheetSelection =
  | { kind: "node"; node: TwinGraphNode }
  | { kind: "edge"; link: TwinGraphLink };

/** Post-simulation link endpoints are node objects carrying labels. */
function endpointText(value: TwinGraphLink["source"]): string {
  if (typeof value === "string") return value;
  const label = (value as { label?: string }).label;
  return label ?? value.id;
}

interface PropertyRow {
  group: string | null;
  key: string;
  value: string;
}

/**
 * Flatten a twin property map for display: facet stamps
 * (`f_<facet>__<attr>`) group under their facet, plain properties under
 * Identity; `~`-prefixed internals and the tenant fence stay hidden.
 */
export function twinPropertyRows(
  properties: Record<string, unknown>,
): PropertyRow[] {
  const rows: PropertyRow[] = [];
  for (const [key, raw] of Object.entries(properties)) {
    if (key.startsWith("~") || key === "tenantId" || key === "canonicalId")
      continue;
    // Facet sync bookkeeping reads like child data — keep the sheet to the
    // entity's actual attributes (state stays: synced/stale is meaningful).
    if (/^f_.+__(batch|seq|synced_at)$/.test(key)) continue;
    const value =
      raw == null
        ? "—"
        : typeof raw === "object"
          ? JSON.stringify(raw)
          : String(raw);
    const facetMatch = /^f_([^_]+(?:_[^_]+)*?)__(.+)$/.exec(key);
    if (facetMatch) {
      rows.push({ group: facetMatch[1]!, key: facetMatch[2]!, value });
    } else {
      rows.push({ group: null, key, value });
    }
  }
  return rows.sort(
    (a, b) =>
      (a.group ?? "").localeCompare(b.group ?? "") ||
      a.key.localeCompare(b.key),
  );
}

/**
 * Property side sheet for graph nodes/edges (THINK-327 review feedback):
 * clicking a node or edge on any twin graph opens its full property map;
 * entity nodes offer the jump into the entity detail.
 */
export function TwinNodeSheet({
  selection,
  onOpenChange,
  onOpenEntity,
}: {
  selection: TwinSheetSelection | null;
  onOpenChange: (open: boolean) => void;
  onOpenEntity?: (target: { entityType: string; canonicalId: string }) => void;
}) {
  const rows = useMemo(() => {
    if (!selection) return [];
    return twinPropertyRows(
      selection.kind === "node"
        ? selection.node.properties
        : selection.link.properties,
    );
  }, [selection]);

  const groups = useMemo(() => {
    const byGroup = new Map<string | null, PropertyRow[]>();
    for (const row of rows) {
      const list = byGroup.get(row.group) ?? [];
      list.push(row);
      byGroup.set(row.group, list);
    }
    return [...byGroup.entries()];
  }, [rows]);

  return (
    <Sheet open={selection !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-4"
        data-testid="twin-node-sheet"
      >
        {selection?.kind === "node" ? (
          <div className="space-y-4">
            <header className="space-y-1 pr-8">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">
                  {selection.node.label}
                </h2>
                {selection.node.typeLabel ? (
                  <Badge variant="outline" className="text-xs font-normal">
                    {selection.node.typeLabel}
                  </Badge>
                ) : null}
              </div>
              {selection.node.canonicalId ? (
                <p className="font-mono text-xs text-muted-foreground">
                  {selection.node.canonicalId}
                </p>
              ) : null}
            </header>
            {selection.node.canonicalId &&
            selection.node.typeLabel &&
            !selection.node.isSystem &&
            onOpenEntity ? (
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                data-testid="twin-sheet-open-entity"
                onClick={() =>
                  onOpenEntity({
                    entityType: selection.node.typeLabel!,
                    canonicalId: selection.node.canonicalId!,
                  })
                }
              >
                Open entity
              </Button>
            ) : null}
            <PropertyGroups groups={groups} />
          </div>
        ) : selection?.kind === "edge" ? (
          <div className="space-y-4">
            <header className="space-y-1 pr-8">
              <h2 className="text-lg font-semibold text-foreground">
                {selection.link.label}
              </h2>
              <p className="text-xs text-muted-foreground">
                {endpointText(selection.link.source)} →{" "}
                {endpointText(selection.link.target)}
              </p>
            </header>
            <PropertyGroups groups={groups} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function PropertyGroups({
  groups,
}: {
  groups: Array<[string | null, PropertyRow[]]>;
}) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No properties.</p>;
  }
  return (
    <div className="space-y-4">
      {groups.map(([group, rows]) => (
        <section key={group ?? "__identity"} className="space-y-1.5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {group ?? "Identity"}
          </h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {rows.map((row) => (
              <div key={`${row.group}:${row.key}`} className="contents">
                <dt className="text-xs text-muted-foreground">{row.key}</dt>
                <dd className="break-all text-sm text-foreground">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
