import { useMemo } from "react";
import { useQuery } from "urql";
import { X } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import {
  PropertyGroups,
  twinPropertyRows,
  type TwinSheetSelection,
} from "./TwinNodeSheet";
import { parseTwinSystemEdges } from "./TwinEntityDetail";
import {
  parseTwinEntityPage,
  TwinSectionBody,
  TwinSectionStateChip,
} from "@/components/memory/twin-page";
import {
  TwinEntityPageQuery,
  TwinSystemEdgesQuery,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import {
  NodeBadge,
  RelationshipConnector,
} from "@/components/memory/relationship-badges";
import { TwinNeighborSummaryQuery, twinTypeColor } from "@thinkwork/graph";
import type { TwinGraphData, TwinGraphLink } from "@thinkwork/graph";
import type { TraversalSummaryRow } from "./TwinTraversal";

/** `twinNeighborSummary` envelope → ring rows (null when not ok). */
function parseSummaryRows(payload: unknown): TraversalSummaryRow[] {
  let envelope: Record<string, unknown> | null = null;
  try {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    envelope =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
  } catch {
    envelope = null;
  }
  if (!envelope || envelope.ok !== true) return [];
  const results = Array.isArray(envelope.results) ? envelope.results : [];
  return results.flatMap((row) => {
    const { relationship, direction, targetType, count } = (row ??
      {}) as Record<string, unknown>;
    if (
      typeof relationship !== "string" ||
      (direction !== "in" && direction !== "out") ||
      typeof targetType !== "string" ||
      typeof count !== "number"
    ) {
      return [];
    }
    return [{ relationship, direction, targetType, count }];
  });
}

export interface TwinDetailPanelLabels {
  relationshipLabel?: (slug: string) => string;
  typeLabel?: (slug: string) => string;
}

/** Post-simulation link endpoints are node objects carrying labels. */
function endpointText(value: TwinGraphLink["source"]): string {
  if (typeof value === "string") return value;
  const label = (value as { label?: string }).label;
  return label ?? value.id;
}

/**
 * Docked detail panel for the Company Brain canvases (customer feedback
 * 2026-07-23): a node/edge click opens this inline panel beside the canvas
 * instead of the overlay side sheet, so the graph stays visible and
 * interactive while inspecting properties.
 */
export function TwinDetailPanel({
  selection,
  onClose,
  labels,
}: {
  selection: TwinSheetSelection;
  onClose: () => void;
  labels?: TwinDetailPanelLabels;
}) {
  const rows = useMemo(
    () =>
      twinPropertyRows(
        selection.kind === "node"
          ? selection.node.properties
          : selection.link.properties,
      ),
    [selection],
  );

  const groups = useMemo(() => {
    const byGroup = new Map<string | null, typeof rows>();
    for (const row of rows) {
      const list = byGroup.get(row.group) ?? [];
      list.push(row);
      byGroup.set(row.group, list);
    }
    return [...byGroup.entries()];
  }, [rows]);

  const node = selection.kind === "node" ? selection.node : null;
  const link = selection.kind === "edge" ? selection.link : null;

  // The graph node itself is a thin projection (displayName + state) —
  // the real richness lives in the projected entity page, so the panel
  // loads the SAME sections the full "Open entity" page renders
  // (customer feedback 2026-07-23).
  const { tenantId } = useTenant();
  const pageReady = Boolean(tenantId && node?.canonicalId && node?.typeLabel);
  const [{ data: pageData }] = useQuery<{ twinEntityPage?: unknown }>({
    query: TwinEntityPageQuery,
    variables: {
      tenantId,
      entityType: node?.typeLabel ?? "",
      canonicalId: node?.canonicalId ?? "",
    },
    pause: !pageReady,
  });
  const [{ data: edgesData }] = useQuery<{ twinSystemEdges?: unknown }>({
    query: TwinSystemEdgesQuery,
    variables: { tenantId, canonicalId: node?.canonicalId ?? "" },
    pause: !pageReady,
  });
  const twinPage = useMemo(
    () => (pageReady ? parseTwinEntityPage(pageData?.twinEntityPage) : null),
    [pageReady, pageData],
  );
  const sections =
    twinPage?.projected && (twinPage.sections?.length ?? 0) > 0
      ? twinPage.sections!
      : null;
  const systemEdges = useMemo(
    () => (pageReady ? parseTwinSystemEdges(edgesData?.twinSystemEdges) : []),
    [pageReady, edgesData],
  );
  // Relationship ring, displayed the way the Memory detail sheet renders
  // relationships (badge — CONNECTOR → badge; Eric 2026-07-23).
  const [{ data: ringData }] = useQuery<{ twinNeighborSummary?: unknown }>({
    query: TwinNeighborSummaryQuery,
    variables: { tenantId, canonicalId: node?.canonicalId ?? "" },
    pause: !pageReady,
  });
  const ring = useMemo(
    () => (pageReady ? parseSummaryRows(ringData?.twinNeighborSummary) : []),
    [pageReady, ringData],
  );
  const relLabel = (slug: string) => labels?.relationshipLabel?.(slug) ?? slug;
  const typeName = (slug: string) => labels?.typeLabel?.(slug) ?? slug;

  return (
    <aside
      className="flex w-[min(22rem,40vw)] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
      data-testid="twin-detail-panel"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        {node ? (
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {node.label}
              </h2>
              {node.typeLabel ? (
                <Badge variant="outline" className="text-xs font-normal">
                  {node.typeLabel}
                </Badge>
              ) : null}
            </div>
            {node.canonicalId ? (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {node.canonicalId}
              </p>
            ) : null}
          </div>
        ) : link ? (
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-foreground">
              {link.label}
            </h2>
            <p className="text-xs text-muted-foreground">
              {endpointText(link.source)} → {endpointText(link.target)}
            </p>
          </div>
        ) : null}
        <button
          type="button"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close details"
          data-testid="twin-detail-panel-close"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {node && ring.length > 0 ? (
          <section className="space-y-1.5" data-testid="twin-panel-relations">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Relationships
            </h3>
            <div className="space-y-1.5">
              {ring.map((row) => {
                const selfBadge = (
                  <NodeBadge
                    label={node.label}
                    color={twinTypeColor(node.typeLabel)}
                  />
                );
                const otherBadge = (
                  <NodeBadge
                    label={`${typeName(row.targetType)} (${row.count})`}
                    color={twinTypeColor(row.targetType)}
                  />
                );
                const connector = (
                  <RelationshipConnector label={relLabel(row.relationship)} />
                );
                return (
                  <div
                    key={`${row.relationship}:${row.direction}:${row.targetType}`}
                    className="flex items-center gap-1.5 overflow-hidden"
                  >
                    {row.direction === "out" ? (
                      <>
                        {selfBadge}
                        {connector}
                        {otherBadge}
                      </>
                    ) : (
                      <>
                        {otherBadge}
                        {connector}
                        {selfBadge}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        <PropertyGroups groups={groups} />
        {sections ? (
          <div className="space-y-4" data-testid="twin-panel-sections">
            {sections.map((section) => (
              <section key={section.slug} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {section.heading}
                  </h3>
                  <TwinSectionStateChip section={section} />
                </div>
                <TwinSectionBody section={section} />
              </section>
            ))}
          </div>
        ) : null}
        {systemEdges.length > 0 ? (
          <section className="space-y-1.5" data-testid="twin-panel-systems">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Systems
            </h3>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              {systemEdges.map((edge) => (
                <div
                  key={`${edge.systemSlug}:${edge.externalId}`}
                  className="contents"
                >
                  <dt className="text-xs text-muted-foreground">
                    {edge.systemSlug}
                    {edge.namespace ? ` · ${edge.namespace}` : ""}
                  </dt>
                  <dd className="break-all font-mono text-sm text-foreground">
                    {edge.externalId}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

/**
 * The panel's resting state (Eric 2026-07-23): the side panel is ALWAYS
 * visible — with nothing selected it shows statistics about what's on
 * the canvas plus the interaction legend.
 */
export function TwinStatsPanel({
  data,
  typeLabel,
}: {
  data: TwinGraphData;
  typeLabel?: (slug: string) => string;
}) {
  const entities = data.nodes.filter((node) => !node.kind);
  const hubs = data.nodes.filter((node) => node.kind === "summary");
  const connections = data.links.filter((link) => !link.id.startsWith("link:"));
  const byType = new Map<string, number>();
  for (const entity of entities) {
    const slug = entity.typeLabel ?? "unknown";
    byType.set(slug, (byType.get(slug) ?? 0) + 1);
  }
  const types = [...byType.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <aside
      className="flex w-[min(22rem,40vw)] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
      data-testid="twin-stats-panel"
    >
      <div className="border-b border-border p-4">
        <h2 className="text-base font-semibold text-foreground">Canvas</h2>
        <p className="text-xs text-muted-foreground">
          Select a node or edge to inspect it here.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {entities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing on the canvas yet — pick a starting entity with the search
            above.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt className="text-xs text-muted-foreground">Entities</dt>
              <dd className="text-sm tabular-nums text-foreground">
                {entities.length}
              </dd>
              <dt className="text-xs text-muted-foreground">Connections</dt>
              <dd className="text-sm tabular-nums text-foreground">
                {connections.length}
              </dd>
              <dt className="text-xs text-muted-foreground">
                Unexpanded groups
              </dt>
              <dd className="text-sm tabular-nums text-foreground">
                {hubs.length}
              </dd>
            </dl>
            {types.length > 0 ? (
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Entity types
                </h3>
                <ul className="space-y-1">
                  {types.map(([slug, count]) => (
                    <li
                      key={slug}
                      className="flex items-center gap-2 text-sm text-foreground"
                    >
                      <span
                        aria-hidden
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: twinTypeColor(slug) }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {typeLabel?.(slug) ?? slug}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
        <section className="space-y-1">
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
            Tips
          </h3>
          <ul className="space-y-0.5 text-xs text-muted-foreground/60">
            <li>Click a node to see its details.</li>
            <li>Double-click a node to expand its relationships.</li>
            <li>Click a group pill to unfold its members.</li>
          </ul>
        </section>
      </div>
    </aside>
  );
}
