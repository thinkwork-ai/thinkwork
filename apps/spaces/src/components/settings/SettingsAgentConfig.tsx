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
import { AgentRuntime } from "@/gql/graphql";
import { useTenant } from "@/context/TenantContext";
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
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
  const dirty =
    runtime !== agent?.runtime || (model ?? null) !== (agent?.model ?? null);

  async function onSave() {
    if (!tenantId || !runtime) return;
    setSaved(false);
    setErrorMsg(null);
    const result = await save({
      tenantId,
      input: { runtime, model },
    });
    if (result.error) {
      setErrorMsg(result.error.message);
      return;
    }
    setSaved(true);
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title="Agent"
        description="Runtime and default model for this tenant’s agent."
      />
      <SettingsSection label="Configuration">
        <div className="space-y-5 p-5">
          <Field label="Runtime">
            <Select
              value={runtime ?? undefined}
              onValueChange={(v) => setRuntime(v as AgentRuntime)}
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
                onValueChange={(v) => setModel(v)}
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

      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={!dirty || saveState.fetching}>
          {saveState.fetching ? "Saving…" : "Save"}
        </Button>
        {saved && !dirty ? (
          <span className="text-sm text-muted-foreground">Saved</span>
        ) : null}
        {errorMsg ? (
          <span className="text-sm text-destructive">{errorMsg}</span>
        ) : null}
      </div>
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
