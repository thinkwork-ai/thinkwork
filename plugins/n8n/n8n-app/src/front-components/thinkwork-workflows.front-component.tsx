import {
  useMemo,
  useState,
  type ChangeEventHandler,
  type ReactNode,
} from "react";

import {
  bridgeThreadPath,
  connectionLabel,
  executionStatuses,
  filterN8nExecutions,
  filterN8nWorkflows,
  formatDateTime,
  formatDuration,
  readinessLabel,
  type N8nAppData,
  type N8nAppExecutionRow,
  type N8nAppViewMode,
  type N8nAppWorkflowRow,
  type N8nReadinessState,
} from "../lib/n8n-app-data";

export type ThinkWorkN8nWorkflowsAppProps = {
  appDisplayName?: string;
  pluginDisplayName?: string;
  data?: N8nAppData | null;
  fetching?: boolean;
  error?: { message?: string } | null;
  onRefresh?: () => void;
};

export type { N8nAppData } from "../lib/n8n-app-data";

const READINESS_FILTERS: Array<"all" | N8nReadinessState> = [
  "all",
  "ready",
  "blocked_not_ready",
  "disabled",
  "unknown",
];

export function ThinkWorkN8nWorkflowsApp({
  appDisplayName = "n8n Workflows",
  pluginDisplayName = "n8n",
  data,
  fetching = false,
  error = null,
  onRefresh,
}: ThinkWorkN8nWorkflowsAppProps) {
  const [viewMode, setViewMode] = useState<N8nAppViewMode>("workflows");
  const [searchQuery, setSearchQuery] = useState("");
  const [readinessFilter, setReadinessFilter] = useState<
    "all" | N8nReadinessState
  >("all");
  const [executionStatusFilter, setExecutionStatusFilter] = useState("all");

  const workflows = data?.workflows ?? [];
  const executions = data?.executions ?? [];
  const filteredWorkflows = useMemo(
    () => filterN8nWorkflows(workflows, searchQuery, readinessFilter),
    [readinessFilter, searchQuery, workflows],
  );
  const executionStatusOptions = useMemo(
    () => executionStatuses(executions),
    [executions],
  );
  const filteredExecutions = useMemo(
    () => filterN8nExecutions(executions, searchQuery, executionStatusFilter),
    [executionStatusFilter, executions, searchQuery],
  );
  if (fetching && !data) {
    return (
      <AppFrame title={appDisplayName} pluginName={pluginDisplayName}>
        <CenteredState
          title="Loading n8n data"
          description="Checking workflows and recent executions."
        />
      </AppFrame>
    );
  }

  if (error) {
    return (
      <AppFrame title={appDisplayName} pluginName={pluginDisplayName}>
        <CenteredState
          tone="error"
          title="n8n data unavailable"
          description={error.message ?? "The app could not load n8n data."}
          action={
            onRefresh ? (
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
                onClick={onRefresh}
              >
                Refresh
              </button>
            ) : null
          }
        />
      </AppFrame>
    );
  }

  if (!data) {
    return (
      <AppFrame title={appDisplayName} pluginName={pluginDisplayName}>
        <CenteredState
          title="n8n is not installed"
          description="Open plugin settings to finish setup."
        />
      </AppFrame>
    );
  }

  return (
    <AppFrame title={appDisplayName} pluginName={pluginDisplayName}>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-6 py-3">
          <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
            <ViewButton
              active={viewMode === "workflows"}
              onClick={() => setViewMode("workflows")}
            >
              Workflows
            </ViewButton>
            <ViewButton
              active={viewMode === "executions"}
              onClick={() => setViewMode("executions")}
            >
              Executions
            </ViewButton>
          </div>
          <ToolbarSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={
              viewMode === "workflows"
                ? "Search workflows..."
                : "Search executions..."
            }
          />
          {viewMode === "workflows" ? (
            <FilterSelect
              value={readinessFilter}
              onChange={(event) =>
                setReadinessFilter(
                  event.target.value as "all" | N8nReadinessState,
                )
              }
            >
              {READINESS_FILTERS.map((state) => (
                <option key={state} value={state}>
                  {state === "all" ? "All readiness" : readinessLabel(state)}
                </option>
              ))}
            </FilterSelect>
          ) : (
            <FilterSelect
              value={executionStatusFilter}
              onChange={(event) => setExecutionStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              {executionStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </FilterSelect>
          )}
        </div>

        <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {viewMode === "workflows" ? (
            <WorkflowTable rows={filteredWorkflows} total={workflows.length} />
          ) : (
            <ExecutionTable
              rows={filteredExecutions}
              total={executions.length}
            />
          )}
        </main>
      </section>
    </AppFrame>
  );
}

export default ThinkWorkN8nWorkflowsApp;

function AppFrame({
  title,
  pluginName,
  children,
}: {
  title: string;
  pluginName: string;
  children: ReactNode;
}) {
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label={`${pluginName} ${title}`}
    >
      {children}
    </section>
  );
}

function WorkflowTable({
  rows,
  total,
}: {
  rows: N8nAppWorkflowRow[];
  total: number;
}) {
  if (total === 0) {
    return (
      <CenteredState
        title="No workflows found"
        description="No n8n workflows are available yet."
      />
    );
  }
  if (rows.length === 0) {
    return (
      <CenteredState
        title="No matching workflows"
        description="Adjust the current filter."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <HeaderCell className="w-[44%]">Workflow</HeaderCell>
            <HeaderCell className="w-[20%]">Triggers</HeaderCell>
            <HeaderCell className="w-[18%]">Link</HeaderCell>
            <HeaderCell className="w-[18%]">Readiness</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((workflow) => (
            <tr
              key={workflow.externalWorkflowId}
              className="border-t border-border hover:bg-muted/20"
            >
              <BodyCell>
                <div className="flex min-w-0 flex-col gap-1">
                  {workflow.nativeWorkflowUrl ? (
                    <a
                      href={workflow.nativeWorkflowUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {workflow.name}
                    </a>
                  ) : (
                    <span className="truncate font-medium text-foreground">
                      {workflow.name}
                    </span>
                  )}
                  <WarningList warnings={workflow.warnings} />
                </div>
              </BodyCell>
              <BodyCell>
                <ChipList
                  values={
                    workflow.triggerTypes.length > 0
                      ? workflow.triggerTypes
                      : ["none"]
                  }
                />
              </BodyCell>
              <BodyCell>
                <Badge tone={connectionTone(workflow)}>
                  {connectionLabel(workflow)}
                </Badge>
              </BodyCell>
              <BodyCell>
                <Badge tone={workflow.readinessState}>
                  {readinessLabel(workflow.readinessState)}
                </Badge>
              </BodyCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExecutionTable({
  rows,
  total,
}: {
  rows: N8nAppExecutionRow[];
  total: number;
}) {
  if (total === 0) {
    return (
      <CenteredState
        title="No executions found"
        description="Recent n8n executions are not available yet."
      />
    );
  }
  if (rows.length === 0) {
    return (
      <CenteredState
        title="No matching executions"
        description="Adjust the current filter."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full min-w-[1120px] table-fixed border-collapse text-left text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <HeaderCell className="w-[24%]">Execution</HeaderCell>
            <HeaderCell className="w-[22%]">Workflow</HeaderCell>
            <HeaderCell className="w-[10%]">Status</HeaderCell>
            <HeaderCell className="w-[10%]">Mode</HeaderCell>
            <HeaderCell className="w-[12%]">Started</HeaderCell>
            <HeaderCell className="w-[10%]">Duration</HeaderCell>
            <HeaderCell className="w-[12%]">ThinkWork</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((execution) => (
            <tr
              key={execution.externalExecutionId}
              className="border-t border-border hover:bg-muted/20"
            >
              <BodyCell>
                <div className="flex min-w-0 flex-col gap-1">
                  <a
                    href={execution.nativeExecutionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {execution.externalExecutionId}
                  </a>
                  <WarningList
                    warnings={[
                      ...execution.warnings,
                      ...(execution.failureMessage
                        ? [execution.failureMessage]
                        : []),
                    ]}
                  />
                </div>
              </BodyCell>
              <BodyCell>
                <a
                  href={execution.nativeWorkflowUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-foreground underline-offset-4 hover:underline"
                >
                  {execution.workflowName ?? execution.externalWorkflowId}
                </a>
                <MonoText>{execution.externalWorkflowId}</MonoText>
              </BodyCell>
              <BodyCell>
                <Badge tone={statusTone(execution.status)}>
                  {execution.status}
                </Badge>
              </BodyCell>
              <BodyCell>
                <span className="text-muted-foreground">
                  {execution.mode ?? "-"}
                </span>
              </BodyCell>
              <BodyCell>
                <span className="text-muted-foreground">
                  {formatDateTime(execution.startedAt)}
                </span>
              </BodyCell>
              <BodyCell>
                <span className="text-muted-foreground">
                  {formatDuration(execution.durationMs)}
                </span>
              </BodyCell>
              <BodyCell>
                <BridgeLinks runs={execution.bridgeRuns} />
              </BodyCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BridgeLinks({ runs }: { runs: N8nAppExecutionRow["bridgeRuns"] }) {
  if (runs.length === 0) {
    return <span className="text-muted-foreground">No bridge run</span>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {runs.slice(0, 2).map((run) => {
        const path = bridgeThreadPath(run);
        return path ? (
          <a
            key={run.id}
            href={path}
            className="truncate text-foreground underline-offset-4 hover:underline"
          >
            {run.summary ?? run.status}
          </a>
        ) : (
          <span key={run.id} className="truncate text-muted-foreground">
            {run.summary ?? run.status}
          </span>
        );
      })}
      {runs.length > 2 ? (
        <span className="text-xs text-muted-foreground">
          +{runs.length - 2} more
        </span>
      ) : null}
    </div>
  );
}

function HeaderCell({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <th className={`px-4 py-3 font-semibold ${className}`}>{children}</th>;
}

function BodyCell({ children }: { children: ReactNode }) {
  return <td className="min-w-0 px-4 py-3 align-top">{children}</td>;
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rounded-[5px] px-3 py-1.5 text-sm font-medium ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToolbarSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || value.length > 0;

  if (!isOpen) {
    return (
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted/30 hover:text-foreground"
        aria-label={placeholder}
        onClick={() => setExpanded(true)}
      >
        <SearchIcon className="size-4" />
      </button>
    );
  }

  return (
    <div className="relative flex h-8 w-[min(16rem,calc(100vw-2rem))] items-center">
      <SearchIcon className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value.trimStart())}
        onBlur={() => {
          if (!value) setExpanded(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onChange("");
            setExpanded(false);
          }
        }}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border-transparent bg-transparent pl-8 pr-8 text-sm text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
      />
      <button
        type="button"
        className="absolute right-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Clear search"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onChange("");
          setExpanded(false);
        }}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
}) {
  return (
    <label className="relative inline-flex h-8 items-center rounded-md border border-border text-sm text-foreground hover:bg-muted/30">
      <FilterIcon className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
      <select
        value={value}
        onChange={onChange}
        className="h-full min-w-[9.5rem] appearance-none rounded-md bg-transparent pl-8 pr-8 text-sm outline-none"
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground" />
    </label>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: N8nReadinessState;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs font-medium ${badgeTone(
        tone,
      )}`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function ChipList({ values }: { values: string[] }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {values.slice(0, 3).map((value) => (
        <span
          key={value}
          className="max-w-full truncate rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
        >
          {value}
        </span>
      ))}
      {values.length > 3 ? (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          +{values.length - 3}
        </span>
      ) : null}
    </div>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  const filtered = warnings.filter(Boolean);
  if (filtered.length === 0) return null;
  return (
    <span className="block truncate text-xs text-amber-500">
      {filtered[0]}
      {filtered.length > 1 ? ` +${filtered.length - 1}` : ""}
    </span>
  );
}

function MonoText({ children }: { children: ReactNode }) {
  return (
    <span className="block truncate font-mono text-xs text-muted-foreground">
      {children}
    </span>
  );
}

function CenteredState({
  tone = "neutral",
  title,
  description,
  action,
}: {
  tone?: "neutral" | "error";
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[280px] items-center justify-center p-8">
      <div
        className={`max-w-md rounded-md border p-5 text-center ${
          tone === "error"
            ? "border-destructive/30 bg-destructive/10"
            : "border-border bg-muted/20"
        }`}
      >
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

function connectionTone(workflow: N8nAppWorkflowRow): N8nReadinessState {
  const label = connectionLabel(workflow);
  if (label === "linked") return "ready";
  if (label === "partial") return "blocked_not_ready";
  return "unknown";
}

function statusTone(status: string): N8nReadinessState {
  const normalized = status.toLowerCase();
  if (["success", "succeeded", "completed"].includes(normalized)) {
    return "ready";
  }
  if (["error", "failed", "crashed"].includes(normalized)) {
    return "blocked_not_ready";
  }
  if (["running", "waiting", "new"].includes(normalized)) {
    return "unknown";
  }
  return "disabled";
}

function badgeTone(tone: N8nReadinessState): string {
  if (tone === "ready") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
  }
  if (tone === "blocked_not_ready") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-500";
  }
  if (tone === "disabled") {
    return "border-border bg-muted/20 text-muted-foreground";
  }
  return "border-sky-500/40 bg-sky-500/10 text-sky-500";
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M3 5h18" />
      <path d="M6 12h12" />
      <path d="M10 19h4" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
