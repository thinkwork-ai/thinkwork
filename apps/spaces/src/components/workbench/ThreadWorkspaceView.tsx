import { useMemo } from "react";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import {
  createThreadGoalFilesClient,
  type ThreadGoalFileFallback,
} from "@/lib/workspace-files-api";

interface ThreadWorkspaceViewProps {
  threadId: string;
  goalFiles?: ThreadGoalFileFallback[];
}

export function ThreadWorkspaceView({
  threadId,
  goalFiles = [],
}: ThreadWorkspaceViewProps) {
  const target = useMemo(() => ({ threadId }), [threadId]);
  const targetKey = `thread:${threadId}`;
  const client = useMemo(
    () => createThreadGoalFilesClient(goalFiles),
    [goalFiles],
  );

  return (
    <main className="flex h-full min-h-0 w-full flex-col bg-background p-4">
      <WorkspaceFileEditor
        key={targetKey}
        target={target}
        targetKey={targetKey}
        client={client}
        defaultOpenFile="GOAL.md"
        className="min-h-0 flex-1"
      />
    </main>
  );
}
