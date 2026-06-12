import { useState } from "react";
import { ChevronRight, FolderTree } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import { cn, formatDateTime } from "@/lib/utils";
import { spacesWorkspaceFilesClient } from "@/lib/workspace-files-api";
import type { ProjectedWorkspace } from "./workspace-projection";

/**
 * Read-only "Projected workspace" disclosure for a thread turn (plan
 * 2026-06-12-002 U9). Renders the per-turn projection snapshot — sources,
 * injected prompt files, fetch ledger, reconcile rejections — exactly as
 * captured at dispatch/finalize time for THAT turn.
 *
 * The AGENTS.md body is the one best-effort exception: the snapshot stores an
 * S3 key, and the web can only read the CURRENT rendered AGENTS.md (via the
 * workspace-files thread target). For the latest render they match; for older
 * turns the panel labels the body as possibly differing
 * (`agentsMdMayDiffer`), and a failed read shows an expired state. The
 * structured fields above are always from this turn's snapshot.
 */
export interface ProjectedWorkspacePanelProps {
  projection: ProjectedWorkspace;
  /** Needed for the AGENTS.md content read; omit to disable the body view. */
  threadId?: string | null;
  /** True when a later turn re-rendered the workspace (see module docs). */
  agentsMdMayDiffer?: boolean;
  /** Injectable AGENTS.md reader for tests; defaults to the REST client. */
  loadAgentsMd?: (threadId: string) => Promise<string | null>;
}

async function defaultLoadAgentsMd(threadId: string): Promise<string | null> {
  const { content } = await spacesWorkspaceFilesClient.getFile(
    { threadId },
    "AGENTS.md",
  );
  return content;
}

type AgentsMdState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; content: string }
  | { status: "unavailable" };

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? formatDateTime(value) : value;
}

function outcomeChipClasses(outcome: string | null): string {
  switch (outcome) {
    case "success":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "partial":
      return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    case "denied":
    case "error":
      return "border-red-500/40 text-red-600 dark:text-red-400";
    default:
      return "border-border text-muted-foreground";
  }
}

function SectionHeading({ children }: { children: string }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </p>
  );
}

export function ProjectedWorkspacePanel({
  projection,
  threadId,
  agentsMdMayDiffer = false,
  loadAgentsMd = defaultLoadAgentsMd,
}: ProjectedWorkspacePanelProps) {
  const [agentsMdOpen, setAgentsMdOpen] = useState(false);
  const [agentsMd, setAgentsMd] = useState<AgentsMdState>({ status: "idle" });

  const generatedAtLabel = formatTimestamp(projection.generatedAt);
  const rejectedCount = projection.reconcile?.rejectedCount ?? 0;
  const hiddenRejections =
    rejectedCount - (projection.reconcile?.rejections.length ?? 0);

  function handleToggleAgentsMd() {
    const nextOpen = !agentsMdOpen;
    setAgentsMdOpen(nextOpen);
    if (!nextOpen || agentsMd.status !== "idle") return;
    if (!threadId) {
      setAgentsMd({ status: "unavailable" });
      return;
    }
    setAgentsMd({ status: "loading" });
    void loadAgentsMd(threadId).then(
      (content) => {
        if (content == null || content.length === 0) {
          setAgentsMd({ status: "unavailable" });
        } else {
          setAgentsMd({ status: "loaded", content });
        }
      },
      () => setAgentsMd({ status: "unavailable" }),
    );
  }

  return (
    <details
      className="group/projection w-full min-w-0 max-w-full text-muted-foreground"
      data-testid="projected-workspace-panel"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 text-sm transition-colors hover:text-foreground">
        <FolderTree className="size-4 shrink-0" />
        <span>Projected workspace</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground/70">
          {[
            generatedAtLabel,
            `${projection.sources.length} source${projection.sources.length === 1 ? "" : "s"}`,
            `${projection.fetches.length} fetch${projection.fetches.length === 1 ? "" : "es"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {rejectedCount > 0 ? (
          <Badge
            variant="outline"
            className="shrink-0 border-red-500/40 text-[10px] text-red-600 dark:text-red-400"
            data-testid="projection-rejections-badge"
          >
            {rejectedCount} rejected
          </Badge>
        ) : null}
        <ChevronRight className="size-4 shrink-0 transition-transform group-open/projection:rotate-90" />
      </summary>

      <div className="ml-7 mt-2 grid min-w-0 max-w-[calc(100%-1.75rem)] gap-3 text-xs">
        {projection.renderedPrefix ? (
          <p className="break-all font-mono text-muted-foreground/80">
            {projection.renderedPrefix}
          </p>
        ) : null}

        {projection.sources.length > 0 ? (
          <section className="grid gap-1" data-testid="projection-sources">
            <SectionHeading>Sources</SectionHeading>
            {projection.sources.map((source, index) => (
              <div
                key={`${source.owner ?? "?"}-${index}`}
                className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"
              >
                <span className="font-medium text-foreground/80">
                  {source.owner ?? "unknown"}
                </span>
                {source.prefix ? (
                  <span className="break-all font-mono text-muted-foreground/80">
                    {source.prefix}
                  </span>
                ) : null}
                {source.etagSummary ? (
                  <span className="font-mono text-muted-foreground/60">
                    {source.etagSummary}
                  </span>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {projection.injectedFiles.length > 0 ? (
          <section className="grid gap-1" data-testid="projection-injected">
            <SectionHeading>Injected files</SectionHeading>
            <div className="flex flex-wrap gap-1.5">
              {projection.injectedFiles.map((file) => (
                <span
                  key={file}
                  className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono"
                >
                  {file}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {projection.agentsMdKey ? (
          <section className="grid gap-1" data-testid="projection-agents-md">
            <SectionHeading>Rendered AGENTS.md</SectionHeading>
            <button
              type="button"
              className="flex w-fit items-center gap-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
              aria-expanded={agentsMdOpen}
              onClick={handleToggleAgentsMd}
              data-testid="projection-agents-md-toggle"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform",
                  agentsMdOpen && "rotate-90",
                )}
              />
              {agentsMdOpen ? "Hide content" : "View content"}
            </button>
            <p className="break-all font-mono text-muted-foreground/60">
              {projection.agentsMdKey}
            </p>
            {agentsMdOpen ? (
              <div className="grid gap-1.5">
                {agentsMd.status === "loading" ? (
                  <p className="text-muted-foreground/70">Loading…</p>
                ) : null}
                {agentsMd.status === "unavailable" ? (
                  <p
                    className="text-muted-foreground/70"
                    data-testid="projection-agents-md-unavailable"
                  >
                    {threadId
                      ? "Rendered AGENTS.md is no longer retrievable — the rendered workspace may have been replaced or expired."
                      : "Content not retrievable from this view."}
                  </p>
                ) : null}
                {agentsMd.status === "loaded" ? (
                  <>
                    {agentsMdMayDiffer ? (
                      <p
                        className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-600 dark:text-amber-400"
                        data-testid="projection-agents-md-caveat"
                      >
                        Showing the current rendered AGENTS.md — a later turn
                        re-rendered this workspace, so this turn's content may
                        have differed.
                      </p>
                    ) : null}
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 font-mono leading-5">
                      {agentsMd.content}
                    </pre>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {projection.fetches.length > 0 ? (
          <section className="grid gap-1" data-testid="projection-fetches">
            <SectionHeading>Fetches</SectionHeading>
            {projection.fetches.map((fetchEvent, index) => (
              <div
                key={`${fetchEvent.slug ?? "?"}-${fetchEvent.at ?? index}`}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
                data-testid="projection-fetch-row"
              >
                <span className="font-mono text-foreground/80">
                  {[fetchEvent.kind, fetchEvent.slug]
                    .filter(Boolean)
                    .join(":") || "unknown"}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "px-1.5 py-0 text-[10px]",
                    outcomeChipClasses(fetchEvent.outcome),
                  )}
                >
                  {fetchEvent.outcome ?? "unknown"}
                </Badge>
                {fetchEvent.deniedReason ? (
                  <span className="text-red-600 dark:text-red-400">
                    {fetchEvent.deniedReason}
                  </span>
                ) : null}
                {fetchEvent.fileCount != null ? (
                  <span>
                    {fetchEvent.fileCount} file
                    {fetchEvent.fileCount === 1 ? "" : "s"}
                  </span>
                ) : null}
                {fetchEvent.totalBytes != null ? (
                  <span>{formatBytes(fetchEvent.totalBytes)}</span>
                ) : null}
                {formatTimestamp(fetchEvent.at) ? (
                  <span className="text-muted-foreground/60">
                    {formatTimestamp(fetchEvent.at)}
                  </span>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {rejectedCount > 0 ? (
          <section className="grid gap-1" data-testid="projection-reconcile">
            <SectionHeading>Reconcile rejections</SectionHeading>
            {projection.reconcile?.rejections.map((rejection, index) => (
              <div
                key={`${rejection.path}-${index}`}
                className="flex min-w-0 flex-wrap items-baseline gap-x-2"
              >
                <span className="break-all font-mono text-foreground/80">
                  {rejection.path}
                </span>
                <span className="font-mono text-red-600 dark:text-red-400">
                  {rejection.code}
                </span>
              </div>
            ))}
            {hiddenRejections > 0 ? (
              <p className="text-muted-foreground/60">
                +{hiddenRejections} more not shown
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </details>
  );
}
