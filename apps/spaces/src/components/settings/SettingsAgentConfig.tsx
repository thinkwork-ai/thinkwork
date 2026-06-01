import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { AgentRuntime } from "@/gql/graphql";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { spacesWorkspaceFilesClient } from "@/lib/workspace-files-api";
import {
  SettingsModelCatalogQuery,
  SettingsTenantAgentQuery,
  SettingsUpdateTenantAgentMutation,
} from "@/lib/settings-queries";
import {
  SettingsPageTitle,
  SettingsPane,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { WorkspaceViewToggle } from "@/components/settings/WorkspaceViewToggle";

const RUNTIME_OPTIONS: { value: AgentRuntime; label: string }[] = [
  // FLUE is the Pi runtime; surfaced as "Pi" per product naming.
  { value: AgentRuntime.Flue, label: "Pi" },
  { value: AgentRuntime.Strands, label: "Strands" },
];

export function SettingsAgentConfig() {
  const { tenantId } = useTenant();
  const [agentResult] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [catalogResult] = useQuery({ query: SettingsModelCatalogQuery });
  const [saveState, save] = useMutation(SettingsUpdateTenantAgentMutation);

  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);

  const agent = agentResult.data?.agent;

  // Hydrate the form once the agent loads.
  useEffect(() => {
    if (agent) {
      setRuntime(agent.runtime);
      setModel(agent.model ?? null);
    }
  }, [agent]);

  // Title relocates to the settings header bar; the files sub-view adds a
  // "Workspace" crumb and a Done action. Called unconditionally before any
  // early return.
  usePageHeaderActions({
    title: "Agent",
    breadcrumbs:
      filesOpen && agent
        ? [{ label: "Agent", href: "/settings/agent" }, { label: "Workspace" }]
        : [{ label: "Agent" }],
    // Toggle stays visible once workspace view is open even if `agent` briefly
    // re-fetches to null, so the user can always toggle back. Opening is a
    // no-op until the agent loads (no workspace target otherwise).
    action:
      filesOpen || agent ? (
        <WorkspaceViewToggle
          showingWorkspace={filesOpen}
          onToggle={() => {
            if (!filesOpen && !agent) return;
            setFilesOpen(!filesOpen);
          }}
        />
      ) : undefined,
    actionKey: filesOpen || agent ? `agent-files:${filesOpen}` : undefined,
  });

  if (agentResult.fetching && !agent) {
    return (
      <SettingsPane>
        <SettingsPageTitle title="Agent" />
        <div className="flex items-center justify-center py-24">
          <LoadingShimmer />
        </div>
      </SettingsPane>
    );
  }

  if (agentResult.error) {
    return (
      <SettingsPane>
        <SettingsPageTitle title="Agent" />
        <SettingsSection>
          <div className="p-6 text-sm text-muted-foreground">
            Couldn’t load agent configuration. {agentResult.error.message}
          </div>
        </SettingsSection>
      </SettingsPane>
    );
  }

  const catalog = catalogResult.data?.modelCatalog ?? [];
  const catalogFailed = !!catalogResult.error;

  // Auto-save: any runtime/model change persists immediately (partial input).
  async function persist(input: {
    runtime?: AgentRuntime;
    model?: string | null;
  }) {
    if (!tenantId) return;
    setErrorMsg(null);
    const result = await save({ tenantId, input });
    if (result.error) setErrorMsg(result.error.message);
  }

  if (filesOpen && agent) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col p-6">
        <WorkspaceFileEditor
          target={{ agentId: agent.id }}
          targetKey={`agent:${agent.id}`}
          client={spacesWorkspaceFilesClient}
          title="Agent source workspace"
          description="Agent files are the tenant-wide runtime base. They hydrate at /workspace root before User context and the active Space are added."
          defaultOpenFile="AGENTS.md"
          className="min-h-0 flex-1"
        />
      </div>
    );
  }

  return (
    <SettingsPane>
      <SettingsPageTitle title="Agent" />
      <SettingsSection
        label="Configuration"
        action={
          saveState.fetching ? (
            <span className="text-sm text-muted-foreground">Saving…</span>
          ) : errorMsg ? (
            <span className="text-sm text-destructive">{errorMsg}</span>
          ) : undefined
        }
      >
        <div className="space-y-5 p-5">
          <Field label="Runtime">
            <Select
              value={runtime ?? undefined}
              onValueChange={(v) => {
                const next = v as AgentRuntime;
                setRuntime(next);
                void persist({ runtime: next });
              }}
            >
              <SelectTrigger className="w-60">
                <SelectValue placeholder="Select runtime" />
              </SelectTrigger>
              <SelectContent>
                {RUNTIME_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Default model">
            {catalogFailed ? (
              <div className="text-sm text-muted-foreground">
                {model ?? "—"}{" "}
                <span className="text-destructive">
                  (model catalog unavailable)
                </span>
              </div>
            ) : (
              <Select
                value={model ?? undefined}
                onValueChange={(v) => {
                  setModel(v);
                  void persist({ model: v });
                }}
                disabled={catalogResult.fetching}
              >
                <SelectTrigger className="w-60">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((m) => (
                    <SelectItem key={m.id} value={m.modelId}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
      </SettingsSection>
    </SettingsPane>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
