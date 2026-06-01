"use client";

import { useMemo } from "react";
import { Loader2Icon } from "lucide-react";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { createConsolidatedWorkspaceClient } from "@/lib/consolidated-workspace-client";
import { useConsolidatedSources } from "./useConsolidatedSources";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <div className="max-w-sm">{children}</div>
    </div>
  );
}

/**
 * Settings → Workspace: a single, S3-backed editor spanning all three workspace
 * sources (Agent / Spaces / User) as one tree. Editing is gated to owner/admin
 * via `readOnly`; everyone else sees the same files read-only. Replaces the
 * former desktop-only, read-only local-cache inspector — this works in any
 * build because it reads and writes S3 through the workspace-files API.
 */
export function WorkspaceSettingsView() {
  const { subTargets, isAdmin, loading, error } = useConsolidatedSources();
  const client = useMemo(() => createConsolidatedWorkspaceClient(), []);

  usePageHeaderActions({
    title: "Workspace",
    breadcrumbs: [{ label: "Workspace" }],
    actionKey: "workspace-settings",
  });

  const targetKey = useMemo(() => {
    if (!subTargets) return "consolidated:pending";
    // Include space names (not just ids) so a space rename resets the editor and
    // its open paths re-route against the new name.
    const spaceKey = subTargets.spaces
      .map((s) => `${s.id}=${s.name}`)
      .join(",");
    return `consolidated:${subTargets.agentId ?? "-"}:${spaceKey}:${subTargets.userId ?? "-"}`;
  }, [subTargets]);

  if (error) {
    return (
      <Centered>
        <p>Couldn&apos;t load the workspace ({error.message}).</p>
      </Centered>
    );
  }

  if (loading) {
    return (
      <Centered>
        <Loader2Icon className="mx-auto size-5 animate-spin" />
      </Centered>
    );
  }

  if (!subTargets) {
    return <Centered>No workspace is available for your account.</Centered>;
  }

  return (
    <WorkspaceFileEditor
      target={subTargets}
      targetKey={targetKey}
      client={client}
      readOnly={!isAdmin}
      title="Source workspace"
      description="Agent, Spaces, and User are editable source roots. Pi turns render these into an Agent-rooted /workspace with the active Space mounted as Space/."
      bordered={false}
      className="h-full"
    />
  );
}
