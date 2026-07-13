// Catalog view (THINK-280 U2): read-only listing of the governed capability
// runtime catalog — admitted/candidate Connection definitions grouped by
// namespace, with the admitted version's per-operation contract table.
// Writes (admission, bindings) live on their own sheets; this view carries
// no write affordances.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "urql";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleSlash,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@thinkwork/ui";
import { CapabilityRuntimeCatalogQuery } from "@/lib/capability-runtime-queries";
import {
  FingerprintChip,
  StatusBadge,
} from "@/components/settings/capability-runtime-shared";

type CatalogDefinition = NonNullable<
  ReturnType<typeof useCatalog>["definitions"]
>[number];

function useCatalog(tenantId: string) {
  const [result, refetch] = useQuery({
    query: CapabilityRuntimeCatalogQuery,
    variables: { tenantId },
    pause: !tenantId,
  });
  return {
    definitions: result.data?.capabilityRuntimeCatalog ?? null,
    fetching: result.fetching,
    error: result.error?.message ?? null,
    refetch,
  };
}

/**
 * A newer candidate version than the admitted one (or any candidate when
 * nothing is admitted yet) — the AE3 upgrade/remediation visibility hook.
 */
function newerCandidate(definition: CatalogDefinition) {
  const admitted = definition.admittedVersion?.version ?? 0;
  return (
    definition.versions.find(
      (version) =>
        version.lifecycle === "candidate" && version.version > admitted,
    ) ?? null
  );
}

export function CapabilityCatalogView({ tenantId }: { tenantId: string }) {
  const { definitions, fetching, error, refetch } = useCatalog(tenantId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const byNamespace = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const map = new Map<string, CatalogDefinition[]>();
    for (const definition of definitions ?? []) {
      if (
        needle &&
        ![
          definition.displayName,
          definition.slug,
          definition.namespace,
          definition.class,
        ].some((field) => field.toLowerCase().includes(needle))
      ) {
        continue;
      }
      const list = map.get(definition.namespace) ?? [];
      list.push(definition);
      map.set(definition.namespace, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [definitions, filter]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (fetching && !definitions) {
    return (
      <div className="space-y-2 py-2" data-testid="capability-catalog-loading">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-2 py-6" data-testid="capability-catalog-error">
        <p className="text-sm text-destructive" role="alert">
          Couldn&apos;t load the capability catalog: {error}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch({ requestPolicy: "network-only" })}
          data-testid="capability-catalog-retry"
        >
          Retry
        </Button>
      </div>
    );
  }
  if ((definitions ?? []).length === 0) {
    return (
      <p
        className="py-6 text-sm text-muted-foreground"
        data-testid="capability-catalog-empty"
      >
        No capability definitions yet. Research a Connection to create the first
        proposal, then admit it here.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="capability-catalog-view">
      <Input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter by name, slug, namespace, or class…"
        aria-label="Filter catalog"
        data-testid="capability-catalog-filter"
      />
      {byNamespace.length === 0 ? (
        <p
          className="py-6 text-sm text-muted-foreground"
          data-testid="capability-catalog-filtered-empty"
        >
          No definitions match &ldquo;{filter.trim()}&rdquo;.
        </p>
      ) : null}
      {byNamespace.map(([namespace, list]) => (
        <section key={namespace}>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {namespace}
          </h3>
          <div className="divide-y divide-border">
            {list.map((definition) => {
              const isOpen = expanded.has(definition.id);
              const candidate = newerCandidate(definition);
              const admitted = definition.admittedVersion;
              return (
                <div key={definition.id} className="py-2.5">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 text-left"
                    onClick={() => toggle(definition.id)}
                    aria-expanded={isOpen}
                    data-testid={`catalog-row-${definition.slug}`}
                  >
                    {isOpen ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {definition.displayName}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {definition.slug}
                    </span>
                    <Badge variant="outline" className="text-muted-foreground">
                      {definition.class}
                    </Badge>
                    <StatusBadge status={definition.status} />
                    {definition.tenantId == null ? (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                        title="Platform-scoped reference definition — visible for admission, never auto-granted."
                      >
                        platform
                      </Badge>
                    ) : null}
                    {candidate ? (
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        data-testid={`catalog-candidate-${definition.slug}`}
                        title="A newer candidate version is awaiting admission review."
                      >
                        candidate v{candidate.version}
                      </Badge>
                    ) : null}
                  </button>
                  <div className="mt-1 ml-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {admitted ? (
                      <>
                        <span>admitted v{admitted.version}</span>
                        <FingerprintChip
                          fingerprint={admitted.descriptorFingerprint}
                        />
                      </>
                    ) : (
                      <span>no admitted version</span>
                    )}
                  </div>
                  {isOpen ? (
                    <div className="mt-2 ml-6 overflow-x-auto">
                      {admitted && admitted.operations.length > 0 ? (
                        <Table data-testid={`catalog-ops-${definition.slug}`}>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Operation</TableHead>
                              <TableHead>Effect</TableHead>
                              <TableHead>Principals</TableHead>
                              <TableHead>Approval</TableHead>
                              <TableHead>Cost / latency / output</TableHead>
                              <TableHead>Executable</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {admitted.operations.map((operation) => (
                              <Fragment key={operation.operationId}>
                                <TableRow
                                  className={cn(
                                    !operation.executable &&
                                      "border-b-0 [&>td]:pb-0",
                                  )}
                                >
                                  <TableCell
                                    className="font-mono text-xs"
                                    title={operation.twcap}
                                  >
                                    {operation.operationId}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {operation.effect}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {operation.principalModes.join(", ")}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {operation.approvalPolicy}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {operation.costClass} /{" "}
                                    {operation.latencyClass} /{" "}
                                    {operation.outputClass}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {operation.executable ? (
                                      <span className="inline-flex items-center gap-1">
                                        <CircleCheck
                                          className="size-3.5 text-emerald-600 dark:text-emerald-400"
                                          aria-hidden
                                        />
                                        executable
                                      </span>
                                    ) : (
                                      <span
                                        className="inline-flex items-center gap-1"
                                        title={operation.withheldReasons.join(
                                          "; ",
                                        )}
                                      >
                                        <CircleSlash
                                          className="size-3.5 text-amber-600 dark:text-amber-400"
                                          aria-hidden
                                        />
                                        withheld
                                      </span>
                                    )}
                                  </TableCell>
                                </TableRow>
                                {!operation.executable ? (
                                  <TableRow>
                                    <TableCell
                                      colSpan={6}
                                      className="pt-1 text-xs text-muted-foreground"
                                      data-testid={`catalog-withheld-${definition.slug}-${operation.operationId}`}
                                    >
                                      {/* Withhold reasons render verbatim from
                                          the shared contract validator. */}
                                      {operation.withheldReasons.join("; ")}
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </Fragment>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <p className="py-2 text-xs text-muted-foreground">
                          {admitted
                            ? "The admitted version declares no operations."
                            : "Operations appear once a version is admitted."}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
