import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Square } from "lucide-react";
import { Identity } from "@/components/Identity";
import { StatusBadge } from "@/components/StatusBadge";
import { relativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LiveRun {
  id: string;
  status: string;
  agentId: string;
  agentName?: string;
  startedAt?: string | null;
  createdAt: string;
}

interface LiveRunWidgetProps {
  threadId: string;
  tenantId?: string | null;
}

function isRunActive(status: string): boolean {
  return status === "queued" || status === "running";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Placeholder LiveRunWidget for thread detail pages.
 *
 * TODO: Wire to a real live-runs query/subscription once the heartbeat
 * infrastructure is available in Thinkwork. The Paperclip version polls
 * `heartbeatsApi.liveRunsForIssue(issueId)` every 3s.
 */
export function LiveRunWidget({ threadId, tenantId }: LiveRunWidgetProps) {
  // TODO: Replace with real live-runs query
  const runs: LiveRun[] = [];
  const [cancellingRunIds, setCancellingRunIds] = useState(new Set<string>());

  const handleCancelRun = async (_runId: string) => {
    // TODO: Wire to cancel mutation
  };

  if (runs.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-500/25 bg-background/80">
      <div className="border-b border-border/60 bg-cyan-500/[0.04] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
          Live Runs
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Active runs attached to this thread.
        </div>
      </div>

      <div className="divide-y divide-border/60">
        {runs.map((run) => {
          const isActive = isRunActive(run.status);
          return (
            <section key={run.id} className="px-4 py-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link
                    to="/agents/$agentId"
                    params={{ agentId: run.agentId }}
                    className="inline-flex hover:underline"
                  >
                    <Identity name={run.agentName ?? run.agentId.slice(0, 8)} size="sm" />
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-2 py-1 font-mono">
                      {run.id.slice(0, 8)}
                    </span>
                    <StatusBadge status={run.status} />
                    <span>{relativeTime(run.startedAt ?? run.createdAt)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isActive && (
                    <button
                      onClick={() => handleCancelRun(run.id)}
                      disabled={cancellingRunIds.has(run.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-500/[0.12] dark:text-red-300 disabled:opacity-50"
                    >
                      <Square className="h-2.5 w-2.5" fill="currentColor" />
                      {cancellingRunIds.has(run.id) ? "Stopping..." : "Stop"}
                    </button>
                  )}
                  <Link
                    to="/agents/$agentId"
                    params={{ agentId: run.agentId }}
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-cyan-700 transition-colors hover:border-cyan-500/30 hover:text-cyan-600 dark:text-cyan-300"
                  >
                    Open run
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
