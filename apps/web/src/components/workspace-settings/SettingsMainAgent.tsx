"use client";

import { useQuery } from "urql";
import { Loader2Icon } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
import { ScopedWorkspaceEditor } from "./ScopedWorkspaceEditor";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <div className="max-w-sm">{children}</div>
    </div>
  );
}

/**
 * The S3-backed editor over the tenant Agent source — the baseline AGENTS.md
 * plus its `skills/` and `agents/` folders (one source, one tree). Rendered as
 * the workspace view of Settings → Agents (`?view=workspace`); the host page
 * owns the page header, so this component only renders the editor body. This
 * surface is the canonical edit point reconcile rejections refer to as
 * "Settings → Agents (Workspace files)". It replaces the Agent slice of the
 * retired consolidated Settings → Workspace page; the Spaces and User slices
 * moved to the per-Space and per-user settings pages. Editing is gated to
 * owner/admin via `readOnly`; everyone else sees the same files read-only.
 */
export function SettingsMainAgent({
  defaultOpenFile = "AGENTS.md",
}: {
  defaultOpenFile?: string;
}) {
  const { tenantId, isLoading } = useTenant();

  const [agentResult] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const agentId = agentResult.data?.agent?.id ?? null;
  // Include the tenant-resolution phase so a not-yet-resolved tenantId reads as
  // loading rather than flashing the terminal "no workspace" state.
  const loading = isLoading || (Boolean(tenantId) && agentResult.fetching);

  if (agentResult.error) {
    return (
      <Centered>
        <p>
          Couldn&apos;t load the Main Agent workspace (
          {agentResult.error.message}).
        </p>
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

  if (!agentId) {
    return (
      <Centered>
        No Main Agent workspace is available for your account.
      </Centered>
    );
  }

  return (
    <ScopedWorkspaceEditor
      target={{ agentId }}
      targetKey={`agent:${agentId}`}
      defaultOpenFile={defaultOpenFile}
      bordered={false}
      className="h-full"
    />
  );
}
