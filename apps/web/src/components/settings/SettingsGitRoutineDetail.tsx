/**
 * Git routine detail (deterministic routines v1) — the in-app view of a
 * git_python routine. Top-header tabs (Code | Executions) mirror the Artifacts
 * tabs; Code renders the GitHub module + fixtures in a FileTree + read-only
 * editor (via the routineSource query), Executions reuses the shared
 * ExecutionList so you can see when the routine ran.
 */

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { FileCode2, FileJson, FileText, Zap } from "lucide-react";
import { Button } from "@thinkwork/ui";
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
import {
  RoutineCodeEditor,
  type RoutineCodeLanguage,
} from "@/components/routines/RoutineCodeEditor";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { cn } from "@/lib/utils";

export type GitRoutineTab = "code" | "executions";

function editorLanguage(language: string): RoutineCodeLanguage {
  return language === "python" ? "python" : "typescript";
}

function FileIcon({ language }: { language: string }) {
  if (language === "python")
    return <FileCode2 className="size-3.5 shrink-0 text-sky-400" />;
  if (language === "json")
    return <FileJson className="size-3.5 shrink-0 text-amber-400" />;
  return <FileText className="size-3.5 shrink-0 text-muted-foreground" />;
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const routine = detailResult.data?.routine;
  const source = sourceResult.data?.routineSource;
  const files = useMemo(() => source?.files ?? [], [source?.files]);
  const activePath = selectedPath ?? files[0]?.path ?? null;
  const activeFile = files.find((f) => f.path === activePath) ?? null;

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
      <Button
        size="sm"
        variant="outline"
        onClick={handleRunNow}
        disabled={triggerState.fetching}
      >
        <Zap className="h-3.5 w-3.5" />
        {triggerState.fetching ? "Starting…" : "Run now"}
      </Button>
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

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      {tab === "executions" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ExecutionList
            routineId={routineId}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            refreshKey={executionRefreshKey}
          />
        </div>
      ) : (
        <CodeTab
          fetching={sourceResult.fetching}
          error={sourceResult.error?.message ?? null}
          ref_={source?.ref ?? null}
          files={files}
          activePath={activePath}
          activeFile={activeFile}
          onSelect={setSelectedPath}
        />
      )}
    </div>
  );
}

function CodeTab({
  fetching,
  error,
  ref_,
  files,
  activePath,
  activeFile,
  onSelect,
}: {
  fetching: boolean;
  error: string | null;
  ref_: string | null;
  files: { path: string; content: string; language: string }[];
  activePath: string | null;
  activeFile: { path: string; content: string; language: string } | null;
  onSelect: (path: string) => void;
}) {
  if (fetching && files.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {error.replace(/^\[GraphQL\]\s*/, "")}
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        No source files found for this routine.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {ref_ ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          Reading <code className="font-mono">{ref_.slice(0, 12)}</code>
        </p>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,240px)_1fr] gap-3">
        <nav
          aria-label="Routine files"
          className="min-h-0 overflow-y-auto rounded-md border p-1"
        >
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onSelect(file.path)}
              title={file.path}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                file.path === activePath
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <FileIcon language={file.language} />
              <span className="truncate">{file.path}</span>
            </button>
          ))}
        </nav>
        <div className="min-h-0 overflow-hidden">
          {activeFile ? (
            <RoutineCodeEditor
              value={activeFile.content}
              language={editorLanguage(activeFile.language)}
              readOnly
              stacked
              onChange={() => {}}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
