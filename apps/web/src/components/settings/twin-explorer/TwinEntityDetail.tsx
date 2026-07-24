import { useMemo, useState } from "react";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { useQuery } from "urql";
import { useNavigate } from "@tanstack/react-router";
import { Badge, cn } from "@thinkwork/ui";
import {
  TwinGraph,
  type TwinGraphLink,
  type TwinGraphNode,
} from "@thinkwork/graph";
import { TwinNodeSheet, type TwinSheetSelection } from "./TwinNodeSheet";
import {
  TwinEntityPageQuery,
  TwinEntityQuery,
  TwinSystemEdgesQuery,
} from "@/lib/graphql-queries";
import {
  parseTwinEntityPage,
  TwinSectionBody,
  TwinSectionStateChip,
} from "@/components/memory/twin-page";
import { useTenant } from "@/context/TenantContext";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

interface TwinQueryEnvelope {
  ok?: boolean;
  results?: Array<Record<string, unknown>>;
  reason?: string;
}

function parseEnvelope(value: unknown): TwinQueryEnvelope | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as TwinQueryEnvelope;
  } catch {
    return null;
  }
}

/** Neptune openCypher node shape: `~properties` carries the flat map. */
function nodeProperties(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  const properties = (node as { "~properties"?: unknown })["~properties"];
  return properties && typeof properties === "object"
    ? (properties as Record<string, unknown>)
    : null;
}

/** The node's displayName from a `twinEntity` payload, if resolvable. */
export function parseTwinEntityDisplayName(value: unknown): string | null {
  const envelope = parseEnvelope(value);
  if (!envelope?.ok) return null;
  const properties = nodeProperties(envelope.results?.[0]?.node);
  const displayName = properties?.displayName;
  return typeof displayName === "string" && displayName ? displayName : null;
}

export interface TwinSystemEdgeRow {
  systemSlug: string;
  externalId: string;
  namespace: string | null;
}

/** System-edge rows from a `twinSystemEdges` payload. */
export function parseTwinSystemEdges(value: unknown): TwinSystemEdgeRow[] {
  const envelope = parseEnvelope(value);
  if (!envelope?.ok) return [];
  const systems = envelope.results?.[0]?.systems;
  if (!Array.isArray(systems)) return [];
  return systems.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const { systemSlug, externalId, namespace } = row as Record<
      string,
      unknown
    >;
    if (typeof systemSlug !== "string" || typeof externalId !== "string") {
      return [];
    }
    return [
      {
        systemSlug,
        externalId,
        namespace: typeof namespace === "string" ? namespace : null,
      },
    ];
  });
}

/**
 * Wiki-free living entity page (THINK-327 U2): projected sections with
 * per-section state chips, plus the external-system edge panel — keyed
 * directly on entityType + canonicalId, no wiki page required (R6, R7).
 * The neighborhood graph slots in below the sections (U3).
 */
export function TwinEntityDetail({
  entityType,
  canonicalId,
}: {
  entityType: string;
  canonicalId: string;
}) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [graphDepth, setGraphDepth] = useState(1);
  const [sheetSelection, setSheetSelection] =
    useState<TwinSheetSelection | null>(null);

  const [{ data: pageData, fetching, error }] = useQuery<{
    twinEntityPage?: unknown;
  }>({
    query: TwinEntityPageQuery,
    variables: { tenantId, entityType, canonicalId },
    pause: !tenantId,
  });
  const [{ data: entityData }] = useQuery<{ twinEntity?: unknown }>({
    query: TwinEntityQuery,
    variables: { tenantId, canonicalId },
    pause: !tenantId,
  });
  const [{ data: edgesData }] = useQuery<{ twinSystemEdges?: unknown }>({
    query: TwinSystemEdgesQuery,
    variables: { tenantId, canonicalId },
    pause: !tenantId,
  });

  const twinPage = useMemo(
    () => parseTwinEntityPage(pageData?.twinEntityPage),
    [pageData],
  );
  const displayName = useMemo(
    () => parseTwinEntityDisplayName(entityData?.twinEntity),
    [entityData],
  );
  const systemEdges = useMemo(
    () => parseTwinSystemEdges(edgesData?.twinSystemEdges),
    [edgesData],
  );

  const headerTitle = displayName ?? canonicalId;
  usePageHeaderActions({
    title: headerTitle,
    breadcrumbs: [
      { label: "Knowledge", href: "/settings/memory" },
      { label: "Company Brain", href: "/settings/memory/explorer" },
      { label: headerTitle },
    ],
    backHref: "/settings/memory/explorer",
    backBehavior: "history",
  });

  const loading = fetching && !pageData;
  const sections =
    twinPage?.projected && (twinPage.sections?.length ?? 0) > 0
      ? twinPage.sections!
      : null;

  return (
    <main className="flex h-full min-h-0 w-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {loading ? (
          <div className="flex min-h-40 items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : (
          <article className="space-y-6">
            <header className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {headerTitle}
                </h1>
                <Badge className="bg-muted text-xs font-normal text-muted-foreground">
                  {entityType}
                </Badge>
              </div>
              {displayName ? (
                <p className="text-xs text-muted-foreground">{canonicalId}</p>
              ) : null}
            </header>

            {error ? (
              <p className="text-sm text-muted-foreground" role="alert">
                This entity couldn&apos;t be loaded: {error.message}
              </p>
            ) : null}

            {!error && twinPage && !twinPage.projected ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="twin-detail-not-projected"
              >
                Live sections aren&apos;t available for this entity
                {twinPage.reason ? ` (${twinPage.reason})` : ""}.
              </p>
            ) : null}

            {!error && !twinPage && !loading ? (
              <p className="text-sm text-muted-foreground" role="alert">
                This entity couldn&apos;t be loaded. It may not exist in the
                twin.
              </p>
            ) : null}

            {sections ? (
              <div className="space-y-6" data-testid="twin-projected-sections">
                {sections.map((section) => (
                  <section key={section.slug} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">
                        {section.heading}
                      </h2>
                      <TwinSectionStateChip section={section} />
                    </div>
                    <TwinSectionBody section={section} />
                  </section>
                ))}
              </div>
            ) : null}

            {systemEdges.length > 0 ? (
              <section className="space-y-2" data-testid="twin-system-edges">
                <h2 className="text-sm font-semibold text-foreground">
                  Systems
                </h2>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                  {systemEdges.map((edge) => (
                    <div
                      key={`${edge.systemSlug}:${edge.externalId}`}
                      className="contents"
                    >
                      <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                        {edge.systemSlug}
                        {edge.namespace ? ` · ${edge.namespace}` : ""}
                      </dt>
                      <dd className="font-mono text-sm text-foreground">
                        {edge.externalId}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            {tenantId ? (
              <section className="space-y-2" data-testid="twin-neighborhood">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    Neighborhood
                  </h2>
                  <div className="flex items-center gap-1">
                    {[1, 2].map((depth) => (
                      <button
                        key={depth}
                        type="button"
                        className={cn(
                          "rounded-md border border-border px-2 py-0.5 text-xs",
                          graphDepth === depth
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                        aria-pressed={graphDepth === depth}
                        onClick={() => setGraphDepth(depth)}
                      >
                        {depth === 1 ? "1 hop" : "2 hops"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative h-80 overflow-hidden rounded-lg border border-border">
                  <TwinGraph
                    tenantId={tenantId}
                    canonicalId={canonicalId}
                    depth={graphDepth}
                    loadingFallback={
                      <div className="flex h-full min-h-48 items-center justify-center">
                        <LoadingShimmer />
                      </div>
                    }
                    onNodeClick={(node: TwinGraphNode) =>
                      setSheetSelection({ kind: "node", node })
                    }
                    onLinkClick={(link: TwinGraphLink) =>
                      setSheetSelection({ kind: "edge", link })
                    }
                  />
                </div>
                <TwinNodeSheet
                  selection={sheetSelection}
                  onOpenChange={(open) => {
                    if (!open) setSheetSelection(null);
                  }}
                  onOpenEntity={(target) => {
                    setSheetSelection(null);
                    void navigate({
                      to: "/settings/memory/explorer/$entityType/$canonicalId",
                      params: target,
                    });
                  }}
                />
              </section>
            ) : null}
          </article>
        )}
      </div>
    </main>
  );
}
