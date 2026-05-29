import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@thinkwork/ui";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { AgentRuntime } from "@/gql/graphql";
import { useTenant } from "@/context/TenantContext";
import { spacesWorkspaceFilesClient } from "@/lib/workspace-files-api";
import {
  SettingsModelCatalogQuery,
  SettingsTenantAgentQuery,
  SettingsUpdateTenantAgentMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsSection,
} from "@/components/settings/SettingsContent";

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

  if (agentResult.fetching && !agent) {
    return (
      <SettingsPane>
        <SettingsHeader title="Agent" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  if (agentResult.error) {
    return (
      <SettingsPane>
        <SettingsHeader title="Agent" />
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
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            Agent workspace
          </h1>
          <Button variant="ghost" size="sm" onClick={() => setFilesOpen(false)}>
            Done
          </Button>
        </div>
        <WorkspaceFileEditor
          target={{ agentId: agent.id }}
          targetKey={`agent:${agent.id}`}
          client={spacesWorkspaceFilesClient}
          defaultOpenFile="AGENTS.md"
          className="min-h-0 flex-1"
        />
      </div>
    );
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title="Agent"
        description="Runtime and default model for this tenant’s agent."
      />
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

      <SettingsSection label="Workspace">
        <div className="flex items-center justify-between gap-4 p-4">
          <p className="text-sm text-muted-foreground">
            Edit the agent’s workspace files — AGENTS.md, CONTEXT.md,
            GUARDRAILS.md, skills, and more.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setFilesOpen(true)}
          >
            Open workspace editor
          </Button>
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
