import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  ToggleGroup,
  ToggleGroupItem,
} from "@thinkwork/ui";
import { Link2 } from "lucide-react";
import {
  SettingsConnectN8nWorkflowMutation,
  SettingsDiscoverN8nWorkflowsQuery,
} from "@/lib/settings-queries";

const N8N_API_KEY_SESSION_STORAGE_KEY = "thinkwork:n8n-api-key";

type N8nWorkflowRow = {
  __typename?: "N8nDiscoveredWorkflow";
  externalWorkflowId: string;
  name: string;
  description?: string | null;
  active?: boolean | null;
  triggerTypes: string[];
  createdAt?: string | null;
  lastModifiedAt?: string | null;
  lastExecutionAt?: string | null;
  tags?: string[];
  nodeCount?: number | null;
  warnings: string[];
  connectedWorkflowId?: string | null;
  connectedBindingId?: string | null;
  readinessState: string;
  readinessReasons: unknown;
};

export function N8nPluginWorkflows({
  installId,
  launchUrl,
  refreshNonce,
  onDiscoveryStateChange,
}: {
  installId: string | null;
  launchUrl: string | null;
  refreshNonce: number;
  onDiscoveryStateChange: (state: string | null, fetching: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<"unlinked" | "all">("unlinked");
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<N8nWorkflowRow | null>(null);
  const [browserDiscoveredWorkflows, setBrowserDiscoveredWorkflows] = useState<
    N8nWorkflowRow[]
  >([]);
  const [browserDiscoveryFetching, setBrowserDiscoveryFetching] =
    useState(false);
  const [browserDiscoveryError, setBrowserDiscoveryError] = useState<
    string | null
  >(null);
  const [result, refresh] = useQuery({
    query: SettingsDiscoverN8nWorkflowsQuery,
    variables: { installId: installId ?? "" },
    pause: !installId,
    requestPolicy: "cache-and-network",
  });
  const [connectState, connectWorkflow] = useMutation(
    SettingsConnectN8nWorkflowMutation,
  );
  const discovery = result.data?.discoverN8nWorkflows ?? null;
  const serverWorkflows = discovery?.workflows ?? [];
  const workflows = useMemo<N8nWorkflowRow[]>(() => {
    if (!serverWorkflows.length) return browserDiscoveredWorkflows;
    const browserById = new Map(
      browserDiscoveredWorkflows.map((workflow) => [
        workflow.externalWorkflowId,
        workflow,
      ]),
    );
    return serverWorkflows.map((workflow) =>
      mergeWorkflowDiscovery(workflow, browserById.get(workflow.externalWorkflowId)),
    );
  }, [browserDiscoveredWorkflows, serverWorkflows]);
  const visibleWorkflows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return workflows.filter((workflow) => {
      if (visibility === "unlinked" && workflow.connectedWorkflowId) {
        return false;
      }
      if (!query) return true;
      return [
        workflow.name,
        workflow.description ?? "",
        workflow.externalWorkflowId,
        workflow.active === false ? "inactive" : "active",
        workflow.readinessState,
        ...(workflow.tags ?? []),
        ...workflow.triggerTypes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [search, visibility, workflows]);

  useEffect(() => {
    onDiscoveryStateChange(
      browserDiscoveredWorkflows.length && !serverWorkflows.length
        ? "ready"
        : discovery?.readinessState ?? null,
      result.fetching || browserDiscoveryFetching,
    );
  }, [
    browserDiscoveredWorkflows.length,
    browserDiscoveryFetching,
    discovery?.readinessState,
    onDiscoveryStateChange,
    result.fetching,
    serverWorkflows.length,
  ]);

  useEffect(() => {
    if (!installId || refreshNonce === 0) return;
    refresh({ requestPolicy: "network-only" });
  }, [installId, refresh, refreshNonce]);

  useEffect(() => {
    if (
      !import.meta.env.DEV ||
      !installId ||
      !launchUrl ||
      result.fetching
    ) {
      return;
    }
    const apiKey = window.sessionStorage.getItem(
      N8N_API_KEY_SESSION_STORAGE_KEY,
    );
    if (!apiKey) return;
    let cancelled = false;
    setBrowserDiscoveryFetching(true);
    setBrowserDiscoveryError(null);
    void fetchN8nWorkflowsFromBrowser({ launchUrl, apiKey })
      .then((nextWorkflows) => {
        if (!cancelled) setBrowserDiscoveredWorkflows(nextWorkflows);
      })
      .catch((error) => {
        if (cancelled) return;
        setBrowserDiscoveryError(
          error instanceof Error
            ? error.message
            : "Could not discover workflows directly from n8n.",
        );
      })
      .finally(() => {
        if (!cancelled) setBrowserDiscoveryFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    installId,
    launchUrl,
    refreshNonce,
    result.fetching,
    serverWorkflows.length,
  ]);

  const connect = useCallback(async (workflow: (typeof workflows)[number]) => {
    if (!installId) return;
    const response = await connectWorkflow({
      input: {
        installId,
        externalWorkflowId: workflow.externalWorkflowId,
        externalWorkflowName: workflow.name,
        active: workflow.active,
        triggerTypes: workflow.triggerTypes,
        lastModifiedAt: workflow.lastModifiedAt,
        idempotencyKey: [
          "n8n",
          "connect",
          workflow.externalWorkflowId,
          Date.now().toString(36),
        ].join("-"),
      },
    });
    if (response.error) {
      toast.error(`Could not connect workflow: ${response.error.message}`);
      return;
    }
    toast.success(
      response.data?.connectN8nWorkflow.created
        ? "Workflow connected."
        : "Workflow connection refreshed.",
    );
    refresh({ requestPolicy: "network-only" });
  }, [connectWorkflow, installId, refresh]);

  const columns = useMemo<ColumnDef<(typeof workflows)[number]>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Workflow",
        meta: {
          headClassName: "w-full min-w-[200px]",
          cellClassName: "w-full min-w-[200px] max-w-0",
        },
        cell: ({ row }) => (
          <button
            type="button"
            className="block min-w-0 max-w-full truncate text-left text-sm font-medium text-foreground transition-colors hover:text-primary"
            title={row.original.name}
            onClick={() => setSelectedWorkflow(row.original)}
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: "externalWorkflowId",
        header: "Workflow ID",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => {
          const workflowUrl = n8nWorkflowUiUrl(
            launchUrl,
            row.original.externalWorkflowId,
          );
          const content = (
            <code
              className="block truncate font-mono text-xs"
              title={row.original.externalWorkflowId}
            >
              {row.original.externalWorkflowId}
            </code>
          );
          return workflowUrl ? (
            <a
              href={workflowUrl}
              target="_blank"
              rel="noreferrer"
              className="block max-w-full text-muted-foreground transition-colors hover:text-foreground"
            >
              {content}
            </a>
          ) : (
            <span className="block max-w-full text-muted-foreground">
              {content}
            </span>
          );
        },
      },
      {
        accessorKey: "triggerTypes",
        header: "Triggers",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-wrap justify-center gap-1">
            {row.original.triggerTypes.length ? (
              row.original.triggerTypes.map((trigger) => (
                <Badge key={trigger} variant="outline">
                  {trigger}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "readinessState",
        header: "Readiness",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => (
          <ReadinessBadge state={row.original.readinessState} />
        ),
      },
      {
        id: "connect",
        header: "",
        meta: {
          headClassName: "w-px",
          cellClassName: "w-px whitespace-nowrap text-right",
        },
        cell: ({ row }) => {
          const connected = Boolean(row.original.connectedWorkflowId);
          return (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={connected ? "Refresh workflow connection" : "Connect workflow"}
              title={connected ? "Refresh workflow connection" : "Connect workflow"}
              className="text-muted-foreground hover:text-foreground"
              disabled={connectState.fetching}
              onClick={() => void connect(row.original)}
            >
              <Link2 className="size-4" />
            </Button>
          );
        },
      },
    ],
    [connect, connectState.fetching, launchUrl],
  );

  if (!installId) {
    return (
      <div className="rounded-md border border-border px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Install the n8n plugin before discovering workflows.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search n8n workflows..."
          className="h-9 w-72 max-w-full"
        />
        <ToggleGroup
          type="single"
          value={visibility}
          onValueChange={(value) => {
            if (value === "all" || value === "unlinked") setVisibility(value);
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="unlinked" aria-label="Show unlinked workflows">
            Unlinked
          </ToggleGroupItem>
          <ToggleGroupItem value="all" aria-label="Show all workflows">
            All
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <DataTable
        columns={columns}
        data={visibleWorkflows}
        pageSize={10}
        tableClassName="w-full table-auto"
        emptyState={
          result.fetching || browserDiscoveryFetching
            ? "Loading n8n workflows..."
            : workflows.length === 0
              ? "No n8n workflows have been discovered yet."
              : visibility === "unlinked"
                ? "No unlinked n8n workflows match the current filters."
                : "No n8n workflows match the current search."
        }
      />
      <WorkflowDetailSheet
        workflow={selectedWorkflow}
        launchUrl={launchUrl}
        onOpenChange={(open) => {
          if (!open) setSelectedWorkflow(null);
        }}
      />
      {browserDiscoveryError ? (
        <p className="text-sm text-muted-foreground">{browserDiscoveryError}</p>
      ) : null}
      {browserDiscoveredWorkflows.length && !serverWorkflows.length ? (
        <p className="text-sm text-muted-foreground">
          Showing workflows discovered directly from n8n for this local session.
        </p>
      ) : (
        <ReadinessReasons reasons={discovery?.readinessReasons} />
      )}
    </div>
  );
}

function WorkflowDetailSheet({
  workflow,
  launchUrl,
  onOpenChange,
}: {
  workflow: N8nWorkflowRow | null;
  launchUrl: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const workflowUrl = workflow
    ? n8nWorkflowUiUrl(launchUrl, workflow.externalWorkflowId)
    : null;
  return (
    <Sheet open={Boolean(workflow)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(560px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
        {workflow ? (
          <>
            <SheetHeader className="border-b border-border px-6 py-5">
              <div className="flex min-w-0 items-center gap-2 pr-8">
                <SheetTitle className="truncate">{workflow.name}</SheetTitle>
                <ReadinessBadge state={workflow.readinessState} />
              </div>
              <SheetDescription>
                {workflow.description || "No description provided by n8n."}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-6 p-6">
              <DetailSection title="Workflow">
                <DetailRow label="Workflow ID" value={workflow.externalWorkflowId} />
                <DetailRow
                  label="State"
                  value={workflow.active === false ? "Inactive" : "Active"}
                />
                <DetailRow
                  label="Connection"
                  value={workflow.connectedWorkflowId ? "Linked" : "Unlinked"}
                />
                <DetailRow
                  label="Triggers"
                  value={
                    workflow.triggerTypes.length
                      ? workflow.triggerTypes.join(", ")
                      : "None detected"
                  }
                />
                <DetailRow
                  label="Nodes"
                  value={
                    typeof workflow.nodeCount === "number"
                      ? String(workflow.nodeCount)
                      : "—"
                  }
                />
              </DetailSection>
              <DetailSection title="Timeline">
                <DetailRow label="Created" value={formatDate(workflow.createdAt)} />
                <DetailRow
                  label="Modified"
                  value={formatDate(workflow.lastModifiedAt)}
                />
                <DetailRow
                  label="Last run"
                  value={formatDate(workflow.lastExecutionAt)}
                />
              </DetailSection>
              {workflow.tags?.length ? (
                <DetailSection title="Tags">
                  <div className="flex flex-wrap gap-1.5">
                    {workflow.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </DetailSection>
              ) : null}
              {Array.isArray(workflow.readinessReasons) &&
              workflow.readinessReasons.length ? (
                <DetailSection title="Readiness">
                  <ReadinessReasons reasons={workflow.readinessReasons} />
                </DetailSection>
              ) : null}
              {workflow.warnings.length ? (
                <DetailSection title="Warnings">
                  <div className="space-y-1">
                    {workflow.warnings.map((warning, index) => (
                      <p key={index} className="text-sm text-muted-foreground">
                        {warning}
                      </p>
                    ))}
                  </div>
                </DetailSection>
              ) : null}
              {workflowUrl ? (
                <a
                  href={workflowUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-sm text-primary hover:underline"
                >
                  Open in n8n
                </a>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{value}</span>
    </div>
  );
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function mergeWorkflowDiscovery(
  server: N8nWorkflowRow,
  browser?: N8nWorkflowRow,
): N8nWorkflowRow {
  if (!browser) return server;
  return {
    ...server,
    description: server.description ?? browser.description,
    active: server.active ?? browser.active,
    triggerTypes: server.triggerTypes.length
      ? server.triggerTypes
      : browser.triggerTypes,
    createdAt: server.createdAt ?? browser.createdAt,
    lastModifiedAt: server.lastModifiedAt ?? browser.lastModifiedAt,
    lastExecutionAt: server.lastExecutionAt ?? browser.lastExecutionAt,
    tags: server.tags?.length ? server.tags : browser.tags,
    nodeCount: server.nodeCount ?? browser.nodeCount,
    warnings: server.warnings.length ? server.warnings : browser.warnings,
  };
}

export function ReadinessBadge({ state }: { state: string }) {
  const className =
    state === "ready"
      ? "border-emerald-500/40 text-emerald-400"
      : state === "blocked_not_ready"
        ? "border-amber-500/40 text-amber-500"
        : state === "disabled"
          ? "border-destructive/40 text-destructive"
          : undefined;
  return (
    <Badge variant="outline" className={className}>
      {state === "blocked_not_ready" ? "blocked" : state.replace(/_/g, " ")}
    </Badge>
  );
}

function ReadinessReasons({ reasons }: { reasons?: unknown }) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  return (
    <div className="space-y-1">
      {reasons.map((reason, index) => (
        <p key={index} className="text-sm text-muted-foreground">
          {reasonMessage(reason)}
        </p>
      ))}
    </div>
  );
}

function reasonMessage(reason: unknown): string {
  if (!reason || typeof reason !== "object" || Array.isArray(reason)) {
    return String(reason);
  }
  const record = reason as Record<string, unknown>;
  return typeof record.message === "string"
    ? record.message
    : JSON.stringify(record);
}

async function fetchN8nWorkflowsFromBrowser(input: {
  launchUrl: string;
  apiKey: string;
}): Promise<N8nWorkflowRow[]> {
  const workflows: N8nWorkflowRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const endpoint = n8nWorkflowListUrl(input.launchUrl, cursor);
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-N8N-API-KEY": input.apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`n8n API returned ${response.status}`);
    }
    const payload = recordFromUnknown(await response.json());
    const entries = Array.isArray(payload.data) ? payload.data : [];
    workflows.push(...entries.flatMap(n8nWorkflowFromApiRecord));
    cursor = stringFromUnknown(payload.nextCursor);
    if (!cursor) break;
  }
  return workflows;
}

function n8nWorkflowListUrl(launchUrl: string, cursor: string | null): string {
  const endpoint = new URL(
    "/__thinkwork-dev/n8n/workflows",
    window.location.origin,
  );
  endpoint.searchParams.set("baseUrl", launchUrl);
  if (cursor) endpoint.searchParams.set("cursor", cursor);
  return endpoint.toString();
}

function n8nWorkflowUiUrl(
  launchUrl: string | null,
  externalWorkflowId: string,
): string | null {
  if (!launchUrl) return null;
  const root = new URL(launchUrl);
  return new URL(
    `/workflow/${encodeURIComponent(externalWorkflowId)}`,
    root.origin,
  ).toString();
}

function n8nWorkflowFromApiRecord(entry: unknown): N8nWorkflowRow[] {
  const record = recordFromUnknown(entry);
  const id = stringFromUnknown(record.id);
  const name = stringFromUnknown(record.name) ?? id;
  if (!id || !name) return [];
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const triggerTypes = stringArrayFromUnknown(record.triggerTypes);
  return [
    {
      __typename: "N8nDiscoveredWorkflow",
      externalWorkflowId: id,
      name,
      description:
        stringFromUnknown(record.description) ??
        nestedString(record.meta, "description") ??
        nestedString(record.settings, "description"),
      active: typeof record.active === "boolean" ? record.active : null,
      triggerTypes: triggerTypes.length ? triggerTypes : inferTriggerTypes(nodes),
      createdAt: stringFromUnknown(record.createdAt),
      lastModifiedAt:
        stringFromUnknown(record.updatedAt) ??
        stringFromUnknown(record.lastModifiedAt),
      lastExecutionAt: stringFromUnknown(record.lastExecutionAt),
      tags: tagNames(record.tags),
      nodeCount: nodes.length || null,
      warnings: [],
      connectedWorkflowId: null,
      connectedBindingId: null,
      readinessState: record.active === false ? "blocked_not_ready" : "ready",
      readinessReasons:
        record.active === false
          ? [
              {
                code: "n8n_workflow_inactive",
                message: "n8n workflow is inactive.",
              },
            ]
          : [],
    },
  ];
}

function inferTriggerTypes(nodes: unknown[]): string[] {
  const values = new Set<string>();
  for (const node of nodes) {
    const type = stringFromUnknown(recordFromUnknown(node).type)?.toLowerCase();
    if (!type) continue;
    if (type.includes("webhook")) values.add("webhook");
    else if (type.includes("schedule") || type.includes("cron")) {
      values.add("schedule");
    } else if (type.includes("manualtrigger")) values.add("manual");
    else if (type.includes("formtrigger")) values.add("form");
    else if (type.includes("trigger")) values.add("trigger");
  }
  return [...values];
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function tagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      return stringFromUnknown(recordFromUnknown(entry).name);
    })
    .filter((entry): entry is string => Boolean(entry));
}

function nestedString(value: unknown, ...path: string[]): string | null {
  let next: unknown = value;
  for (const key of path) {
    next = recordFromUnknown(next)[key];
  }
  return stringFromUnknown(next);
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
