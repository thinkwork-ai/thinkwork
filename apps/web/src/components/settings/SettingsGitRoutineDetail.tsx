/**
 * Git routine detail (deterministic routines v1) — the in-app view of a
 * git_python routine. Top-header tabs (Code | Executions) mirror the Artifacts
 * tabs. Code renders the GitHub module + fixtures with the SAME shared
 * WorkspaceFileEditor the Skill Library and agent workspace use, fed by a
 * read-only in-memory client over the routineSource query. Executions reuses
 * the shared ExecutionList so you can see when the routine ran.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import { Button } from "@thinkwork/ui";
import {
  WorkspaceFileEditor,
  type WorkspaceFilesClient,
} from "@thinkwork/workspace-editor";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  RoutineDetailQuery,
  RoutineSourceQuery,
  TriggerRoutineRunMutation,
} from "@/lib/routine-queries";
import {
  ExecutionList,
  type StatusFilterId,
} from "@/components/routines/ExecutionList";
import { LoadingShimmer } from "@/components/LoadingShimmer";

export type GitRoutineTab = "code" | "executions";

type RoutineSourceFile = { path: string; content: string; language: string };

/**
 * Read-only WorkspaceFilesClient backed by the in-memory routineSource files.
 * The routine's GitHub code is already resolved server-side, so listing/reading
 * are synchronous lookups; mutation methods are inert (readOnly editor).
 */
function createRoutineFilesClient(
  files: RoutineSourceFile[],
): WorkspaceFilesClient<{ routineId: string }> {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  return {
    async listFiles() {
      return {
        files: files.map((f) => ({
          path: f.path,
          source: "catalog" as const,
          sha256: "",
        })),
      };
    },
    async getFile(_target, path) {
      return {
        content: byPath.get(path) ?? null,
        source: "catalog" as const,
        sha256: "",
      };
    },
    async putFile() {
      throw new Error("Routine source is read-only.");
    },
    async deleteFile() {
      throw new Error("Routine source is read-only.");
    },
  };
}

export function SettingsGitRoutineDetail({
  routineId,
  tab,
}: {
  routineId: string;
  tab: GitRoutineTab;
}) {
  const [detailResult] = useQuery({
    query: RoutineDetailQuery,
    variables: { id: routineId },
  });
  const [sourceResult] = useQuery({
    query: RoutineSourceQuery,
    variables: { routineId },
    // Only reach out to GitHub when the Code tab is showing.
    pause: tab !== "code",
  });
  const [triggerState, executeTrigger] = useMutation(TriggerRoutineRunMutation);
  const [executionRefreshKey, setExecutionRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilterId>("all");

  const routine = detailResult.data?.routine;
  const source = sourceResult.data?.routineSource;
  const files = useMemo<RoutineSourceFile[]>(() => {
    const raw = source?.files ?? [];
    if (raw.length === 0) return [];
    // Root the tree at the routine's own folder — strip the shared repo
    // prefix (the module's directory) so it reads `main.py` / `fixtures/…`
    // instead of `routines/<slug>/…`.
    const modulePath = raw[0].path;
    const dir = modulePath.includes("/")
      ? modulePath.slice(0, modulePath.lastIndexOf("/") + 1)
      : "";
    if (!dir) return raw;
    return raw.map((f) =>
      f.path.startsWith(dir) ? { ...f, path: f.path.slice(dir.length) } : f,
    );
  }, [source?.files]);
  const filesClient = useMemo(() => createRoutineFilesClient(files), [files]);

  usePageHeaderActions({
    title: routine?.name ?? "Routine",
    breadcrumbs: [
      { label: "Routines", href: "/settings/routines" },
      { label: routine?.name ?? "Routine" },
    ],
    backHref: "/settings/routines",
    backBehavior: "history",
    tabs: [
      { to: `/settings/routines/${routineId}`, label: "Code" },
      { to: `/settings/routines/${routineId}/executions`, label: "Executions" },
    ],
    action: routine ? (
      <div className="flex items-center gap-1">
        {tab === "executions" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setExecutionRefreshKey((key) => key + 1)}
            aria-label="Refresh executions"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={handleRunNow}
          disabled={triggerState.fetching}
          aria-label="Run now"
          title="Run now"
        >
          {triggerState.fetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Zap className="h-4 w-4" />
          )}
        </Button>
      </div>
    ) : undefined,
    actionKey: `git-routine:${routineId}:${tab}:${triggerState.fetching}:${routine?.name ?? ""}`,
  });

  async function handleRunNow() {
    const res = await executeTrigger({ routineId, input: null });
    if (!res.error) setExecutionRefreshKey((key) => key + 1);
  }

  if (detailResult.fetching && !routine) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }
  if (!routine) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          This routine could not be loaded — it may have been removed.
        </p>
      </div>
    );
  }

  // The Code tab is edge-to-edge (like the Skill editor); the Executions tab
  // keeps the standard settings padding.
  if (tab === "executions") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col p-6">
        <ExecutionList
          routineId={routineId}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          refreshKey={executionRefreshKey}
        />
      </div>
    );
  }

  if (sourceResult.error) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {sourceResult.error.message.replace(/^\[GraphQL\]\s*/, "")}
      </div>
    );
  }
  if (files.length === 0 && sourceResult.fetching) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-muted-foreground">
        No source files found for this routine.
      </div>
    );
  }

  return (
    <WorkspaceFileEditor
      target={{ routineId }}
      targetKey={`routine:${routineId}`}
      refreshKey={source?.ref ?? files.length}
      client={filesClient}
      defaultOpenFile={files[0]?.path}
      readOnly
      bordered={false}
      className="h-full"
      managedSectionHeadings={[]}
      loadingSlot={<LoadingShimmer />}
    />
  );
}
