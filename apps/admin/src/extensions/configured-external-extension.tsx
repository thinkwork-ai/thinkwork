import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpDown,
  ExternalLink,
  Filter,
  Layers,
  Network,
  Pause,
  Play,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getIdToken } from "@/lib/auth";
import { cn, formatUsd, relativeTime } from "@/lib/utils";
import type { AdminExtensionComponentProps } from "./types";
import { registerAdminExtension } from "./registry";

const enabled = readBoolean(
  import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_ENABLED,
);
const id = sanitizeExtensionId(import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_ID);
const label = readTrimmed(import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_LABEL);
const standaloneUrl = normalizeUrl(
  import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_URL,
);
const graphQLUrl = normalizeUrl(
  import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_GRAPHQL_URL,
);
const navGroup = readNavGroup(
  import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_NAV_GROUP,
);

const SYMPHONY_DASHBOARD_QUERY = /* GraphQL */ `
  query AdminSymphonyDashboard($period: SpendPeriod!) {
    currentQueue {
      runs {
        id
        issueId
        identifier
        issueTitle
        attempt
        rotationCounter
        currentState
        outcome
        errorClass
        sessionStartedAt
        lastUsageEventAt
      }
      totals {
        total
        byState {
          state
          count
        }
      }
    }
    dispatchState {
      dispatchPaused
      updatedAt
    }
    workflowVersions {
      active {
        id
        versionLabel
        sourceSha
        publishedAt
      }
      history {
        id
        versionLabel
        sourceSha
        publishedAt
      }
    }
    currentSpend(period: $period) {
      period
      reservationsOpenUsd
      actualsTotalUsd
      reconciledTotalUsd
      reconciledRuns
      perRunCapUsd
      globalCapUsdPerWeek
    }
  }
`;

const PAUSE_DISPATCH_MUTATION = /* GraphQL */ `
  mutation AdminPauseDispatch {
    pauseDispatch {
      dispatchPaused
      updatedAt
    }
  }
`;

const RESUME_DISPATCH_MUTATION = /* GraphQL */ `
  mutation AdminResumeDispatch {
    resumeDispatch {
      dispatchPaused
      updatedAt
    }
  }
`;

type SymphonyDashboard = {
  currentQueue: {
    runs: QueueRun[];
    totals: QueueTotals;
  };
  dispatchState: DispatchState;
  workflowVersions: {
    active: WorkflowVersion | null;
    history: WorkflowVersion[];
  };
  currentSpend: CurrentSpend;
};

type QueueRun = {
  id: string;
  issueId: string;
  identifier: string | null;
  issueTitle: string | null;
  attempt: number;
  rotationCounter: number;
  currentState: string;
  outcome: string | null;
  errorClass: string | null;
  sessionStartedAt: string | null;
  lastUsageEventAt: string | null;
};

type QueueTotals = {
  total: number;
  byState: Array<{ state: string; count: number }>;
};

type DispatchState = {
  dispatchPaused: boolean;
  updatedAt: string;
};

type WorkflowVersion = {
  id: string;
  versionLabel: string | null;
  sourceSha: string | null;
  publishedAt: string | null;
};

type CurrentSpend = {
  period: string;
  reservationsOpenUsd: number;
  actualsTotalUsd: number;
  reconciledTotalUsd: number;
  reconciledRuns: number;
  perRunCapUsd: number | null;
  globalCapUsdPerWeek: number | null;
};

type ExtensionTab = "runs" | "workflows" | "spend" | "health";

type LoadState =
  | { status: "idle" | "loading"; data: SymphonyDashboard | null; error: null }
  | { status: "ready"; data: SymphonyDashboard; error: null }
  | { status: "error"; data: SymphonyDashboard | null; error: Error };

export function ConfiguredExternalExtension(
  _props: AdminExtensionComponentProps,
) {
  const [tab, setTab] = useState<ExtensionTab>("runs");
  const [search, setSearch] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({
    status: "idle",
    data: null,
    error: null,
  });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isMutatingDispatch, setIsMutatingDispatch] = useState(false);

  const loadDashboard = useCallback(async () => {
    if (!graphQLUrl) {
      setLoadState({
        status: "error",
        data: null,
        error: new Error("Symphony GraphQL URL is not configured."),
      });
      return;
    }

    setLoadState((current) => ({
      status: "loading",
      data: current.data,
      error: null,
    }));

    try {
      const data = await requestSymphonyGraphQL<SymphonyDashboard>({
        endpoint: graphQLUrl,
        query: SYMPHONY_DASHBOARD_QUERY,
        variables: { period: "LAST_24H" },
      });
      setLoadState({ status: "ready", data, error: null });
      setSelectedRunId((current) => {
        if (
          current &&
          data.currentQueue.runs.some((run) => run.id === current)
        ) {
          return current;
        }
        return data.currentQueue.runs[0]?.id ?? null;
      });
    } catch (error) {
      setLoadState((current) => ({
        status: "error",
        data: current.data,
        error: normalizeError(error),
      }));
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    const interval = window.setInterval(() => void loadDashboard(), 10_000);
    return () => window.clearInterval(interval);
  }, [loadDashboard]);

  const data = loadState.data;
  const runs = data?.currentQueue.runs ?? [];
  const filteredRuns = useMemo(() => filterRuns(runs, search), [runs, search]);
  const selectedRun = useMemo(
    () =>
      runs.find((run) => run.id === selectedRunId) ?? filteredRuns[0] ?? null,
    [filteredRuns, runs, selectedRunId],
  );

  async function setDispatchPaused(paused: boolean) {
    if (!graphQLUrl) return;
    setIsMutatingDispatch(true);
    setMutationError(null);
    try {
      await requestSymphonyGraphQL({
        endpoint: graphQLUrl,
        query: paused ? PAUSE_DISPATCH_MUTATION : RESUME_DISPATCH_MUTATION,
      });
      await loadDashboard();
    } catch (error) {
      setMutationError(normalizeError(error).message);
    } finally {
      setIsMutatingDispatch(false);
    }
  }

  if (!label) return null;

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <div className="grid gap-3 pb-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold leading-tight tracking-tight">
            {label}
          </h1>
        </div>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ExtensionTab)}
        >
          <TabsList>
            <TabsTrigger value="runs">
              Runs
              <span className="ml-1 text-xs text-muted-foreground">
                {data?.currentQueue.totals.total ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger value="workflows">
              Workflows
              <span className="ml-1 text-xs text-muted-foreground">
                {data?.workflowVersions.history.length ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger value="spend">Spend</TabsTrigger>
            <TabsTrigger value="health">Health</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center justify-start gap-2 md:justify-end">
          {data ? (
            <DispatchControl
              dispatchState={data.dispatchState}
              isMutating={isMutatingDispatch}
              onPause={() => void setDispatchPaused(true)}
              onResume={() => void setDispatchPaused(false)}
            />
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadDashboard()}
            disabled={loadState.status === "loading"}
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                loadState.status === "loading" && "animate-spin",
              )}
            />
            Refresh
          </Button>
          {standaloneUrl ? (
            <Button asChild variant="outline">
              <a href={standaloneUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {mutationError ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {mutationError}
        </div>
      ) : null}

      {loadState.error ? (
        <SymphonyError
          error={loadState.error}
          stale={Boolean(loadState.data)}
          onRetry={() => void loadDashboard()}
        />
      ) : null}

      {tab === "runs" ? (
        <RunsPanel
          runs={filteredRuns}
          selectedRun={selectedRun}
          search={search}
          totals={data?.currentQueue.totals ?? { total: 0, byState: [] }}
          loading={
            (loadState.status === "idle" || loadState.status === "loading") &&
            !data
          }
          onSearchChange={setSearch}
          onSelectRun={setSelectedRunId}
        />
      ) : null}
      {tab === "workflows" ? (
        <WorkflowsPanel workflowVersions={data?.workflowVersions ?? null} />
      ) : null}
      {tab === "spend" ? (
        <SpendPanel spend={data?.currentSpend ?? null} />
      ) : null}
      {tab === "health" ? (
        <HealthPanel
          endpoint={graphQLUrl}
          dispatchState={data?.dispatchState ?? null}
          error={loadState.error}
        />
      ) : null}
    </div>
  );
}

function DispatchControl({
  dispatchState,
  isMutating,
  onPause,
  onResume,
}: {
  dispatchState: DispatchState;
  isMutating: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  if (dispatchState.dispatchPaused) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={onResume}
        disabled={isMutating}
        title={`Paused since ${new Date(dispatchState.updatedAt).toLocaleString()}`}
      >
        <Play className="h-4 w-4" />
        Resume
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onPause}
      disabled={isMutating}
      title={`Dispatch active as of ${new Date(dispatchState.updatedAt).toLocaleString()}`}
    >
      <Pause className="h-4 w-4" />
      Pause
    </Button>
  );
}

function RunsPanel({
  runs,
  selectedRun,
  search,
  totals,
  loading,
  onSearchChange,
  onSelectRun,
}: {
  runs: QueueRun[];
  selectedRun: QueueRun | null;
  search: string;
  totals: QueueTotals;
  loading: boolean;
  onSearchChange: (value: string) => void;
  onSelectRun: (runId: string) => void;
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search Symphony..."
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <Filter className="h-4 w-4" />
            Filter
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowUpDown className="h-4 w-4" />
            Sort
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <Layers className="h-4 w-4" />
            Group
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Total {totals.total}</span>
        {totals.byState.map((state) => (
          <Badge key={state.state} variant="outline">
            {state.state} {state.count}
          </Badge>
        ))}
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Run</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Last usage</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={5}>
                    Loading Symphony runs...
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={5}>
                    No active Symphony runs.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr
                    key={run.id}
                    className={cn(
                      "cursor-pointer text-foreground transition-colors hover:bg-muted/40",
                      selectedRun?.id === run.id && "bg-muted/50",
                    )}
                    onClick={() => onSelectRun(run.id)}
                  >
                    <td className="max-w-[520px] px-4 py-3">
                      <button
                        type="button"
                        className="truncate text-left font-medium hover:text-foreground"
                      >
                        {run.identifier ?? run.issueId}
                      </button>
                      <div className="truncate text-muted-foreground">
                        {run.issueTitle ?? run.id}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={run.currentState} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatNullableRelative(run.sessionStartedAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatNullableRelative(run.lastUsageEventAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {run.outcome ?? run.errorClass ?? "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <aside className="rounded-lg border border-border bg-card p-4 text-sm">
          {selectedRun ? (
            <>
              <div className="mb-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Selected Run
                </div>
                <div className="mt-1 break-all font-mono text-foreground">
                  {selectedRun.id}
                </div>
              </div>
              <dl className="space-y-3">
                <RunFact
                  label="Issue"
                  value={selectedRun.identifier ?? selectedRun.issueId}
                />
                <RunFact label="State" value={selectedRun.currentState} />
                <RunFact label="Attempt" value={String(selectedRun.attempt)} />
                <RunFact
                  label="Rotation"
                  value={String(selectedRun.rotationCounter)}
                />
                <RunFact
                  label="Started"
                  value={formatNullableRelative(selectedRun.sessionStartedAt)}
                />
                <RunFact
                  label="Last usage"
                  value={formatNullableRelative(selectedRun.lastUsageEventAt)}
                />
              </dl>
            </>
          ) : (
            <div className="text-muted-foreground">
              Select a run to inspect.
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function WorkflowsPanel({
  workflowVersions,
}: {
  workflowVersions: SymphonyDashboard["workflowVersions"] | null;
}) {
  const active = workflowVersions?.active ?? null;
  const history = workflowVersions?.history ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Active Workflow
        </div>
        {active ? (
          <div className="mt-3 space-y-2 text-sm">
            <div className="font-medium">
              {active.versionLabel ?? active.id}
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              {active.sourceSha ?? "-"}
            </div>
            <div className="text-muted-foreground">
              Published {formatNullableRelative(active.publishedAt)}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-muted-foreground">
            No active workflow version reported.
          </div>
        )}
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Version</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Published</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {history.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={3}>
                  No workflow versions.
                </td>
              </tr>
            ) : (
              history.map((version) => (
                <tr key={version.id}>
                  <td className="px-4 py-3 font-medium">
                    {version.versionLabel ?? version.id}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {version.sourceSha ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatNullableRelative(version.publishedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SpendPanel({ spend }: { spend: CurrentSpend | null }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <MetricCard
        label="Open reservations"
        value={spend ? formatUsd(spend.reservationsOpenUsd) : "-"}
      />
      <MetricCard
        label="Actuals"
        value={spend ? formatUsd(spend.actualsTotalUsd) : "-"}
      />
      <MetricCard
        label="Reconciled"
        value={spend ? formatUsd(spend.reconciledTotalUsd) : "-"}
        detail={spend ? `${spend.reconciledRuns} runs` : undefined}
      />
    </div>
  );
}

function HealthPanel({
  endpoint,
  dispatchState,
  error,
}: {
  endpoint: string;
  dispatchState: DispatchState | null;
  error: Error | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="grid gap-4 md:grid-cols-2">
        <RunFact
          label="GraphQL endpoint"
          value={endpoint || "Not configured"}
        />
        <RunFact
          label="Dispatch"
          value={
            dispatchState
              ? dispatchState.dispatchPaused
                ? "paused"
                : "active"
              : "unknown"
          }
        />
        <RunFact
          label="Last dispatch update"
          value={formatNullableRelative(dispatchState?.updatedAt ?? null)}
        />
        <RunFact label="Last error" value={error?.message ?? "-"} />
      </div>
    </div>
  );
}

function SymphonyError({
  error,
  stale,
  onRetry,
}: {
  error: Error;
  stale: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-3 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {stale ? "Showing last loaded Symphony data. " : null}
        {error.message}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  return (
    <Badge variant="outline" className={stateBadgeClass(state)}>
      {state}
    </Badge>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {detail ? (
        <div className="mt-1 text-sm text-muted-foreground">{detail}</div>
      ) : null}
    </section>
  );
}

function RunFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="break-words text-foreground">{value}</div>
    </div>
  );
}

export async function requestSymphonyGraphQL<T = unknown>({
  endpoint,
  query,
  variables,
}: {
  endpoint: string;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<T> {
  const token = await getIdToken();
  if (!token) {
    throw new Error("Sign in again to access Symphony.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  let payload: GraphQLPayload<T>;
  try {
    payload = (await response.json()) as GraphQLPayload<T>;
  } catch {
    throw new Error(`Symphony returned HTTP ${response.status}.`);
  }

  if (!response.ok || payload.errors?.length) {
    throw graphQLError(response.status, payload.errors);
  }
  if (!payload.data) {
    throw new Error("Symphony returned no data.");
  }
  return payload.data;
}

type GraphQLPayload<T> = {
  data?: T | null;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
};

export function graphQLError(
  status: number,
  errors: GraphQLPayload<unknown>["errors"],
) {
  const first = errors?.[0];
  const code = first?.extensions?.code;
  if (code === "UNAUTHENTICATED" || status === 401) {
    return new Error("Sign in again to access Symphony.");
  }
  if (code === "FORBIDDEN" || status === 403) {
    return new Error("Your account is not in the Symphony operators group.");
  }
  return new Error(first?.message ?? `Symphony returned HTTP ${status}.`);
}

export function filterRuns(runs: QueueRun[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return runs;
  return runs.filter((run) =>
    [
      run.id,
      run.issueId,
      run.identifier,
      run.issueTitle,
      run.currentState,
      run.outcome,
      run.errorClass,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
}

export function stateBadgeClass(state: string) {
  if (state === "invoking_agent" || state === "continuation") {
    return "border-amber-900/80 bg-amber-950/40 text-amber-300";
  }
  if (state === "recording_result" || state === "terminal") {
    return "border-emerald-900/80 bg-emerald-950/40 text-emerald-300";
  }
  if (state === "failed" || state === "stalled" || state === "cancelling") {
    return "border-destructive/50 bg-destructive/10 text-destructive";
  }
  return "border-border text-muted-foreground";
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function formatNullableRelative(iso: string | null) {
  return iso ? relativeTime(iso) : "-";
}

function readBoolean(value: unknown) {
  return String(value ?? "").toLowerCase() === "true";
}

function readTrimmed(value: unknown) {
  return String(value ?? "").trim();
}

function sanitizeExtensionId(value: unknown) {
  const id = readTrimmed(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return "";
  return id;
}

function normalizeUrl(value: unknown) {
  const candidate = readTrimmed(value);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function readNavGroup(value: unknown) {
  const candidate = readTrimmed(value);
  if (
    candidate === "main" ||
    candidate === "agentic-os" ||
    candidate === "managed-harness" ||
    candidate === "integrations" ||
    candidate === "manage"
  ) {
    return candidate;
  }
  return "integrations";
}

if (enabled && id && label) {
  registerAdminExtension({
    id,
    label,
    navGroup,
    breadcrumbs: [{ label }],
    icon: Network,
    ownsPageLayout: true,
    load: async () => ({ default: ConfiguredExternalExtension }),
  });
}
