import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useTheme,
} from "@thinkwork/ui";
import { AgentRuntime } from "@/gql/graphql";
import { useTenant } from "@/context/TenantContext";
import { isDesktop } from "@/lib/desktop-detection";
import { requestDesktopNotificationPermission } from "@/lib/desktop-notifications";
import {
  setThreadNotificationsEnabled,
  useThreadNotificationsEnabled,
} from "@/lib/thread-notifications-pref";
import {
  EDITOR_FONT_SIZES,
  setEditorFontSize,
  setEditorWrap,
  useEditorFontSize,
  useEditorWrap,
} from "@/lib/editor-prefs";
import {
  SettingsDeploymentStatusQuery,
  SettingsModelCatalogQuery,
  SettingsTenantAgentQuery,
  SettingsUpdateTenantAgentMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsGeneral() {
  const { isOperator, roleResolved } = useTenant();

  // Operators only — members never issue the deployment query (it is also
  // gated server-side in U8).
  const showOperator = roleResolved && isOperator;
  const [deployResult] = useQuery({
    query: SettingsDeploymentStatusQuery,
    pause: !showOperator,
  });

  const deployment = deployResult.data?.deploymentStatus;
  const deploymentFailed = showOperator && !!deployResult.error;

  return (
    <SettingsPane>
      <SettingsHeader
        title="General"
        description="Configure agent runtime, default model, appearance, and deployment."
      />

      {showOperator ? <AgentConfigSection /> : null}

      <SettingsSection label="Appearance">
        <ThemeRow />
        {isDesktop() ? (
          <>
            <EditorFontSizeRow />
            <EditorWrapRow />
          </>
        ) : null}
      </SettingsSection>

      {isDesktop() ? (
        <SettingsSection label="Notifications">
          <ThreadNotificationsRow />
        </SettingsSection>
      ) : null}

      {showOperator ? (
        <>
          <SettingsSection label="Deployment">
            {deploymentFailed ? (
              <div className="p-4 text-sm text-muted-foreground">
                Deployment status unavailable.
              </div>
            ) : (
              <>
                <SettingsRow
                  label="Stage"
                  description="Deployment stage this console is connected to."
                >
                  {deployment?.stage ?? "…"}
                </SettingsRow>
                <SettingsRow
                  label="Region"
                  description="AWS region hosting this deployment."
                >
                  {deployment?.region ?? "…"}
                </SettingsRow>
                <SettingsRow
                  label="Account"
                  description="AWS account ID hosting this deployment."
                >
                  {deployment?.accountId ?? "…"}
                </SettingsRow>
                <SettingsRow
                  label="AgentCore"
                  description="Bedrock AgentCore runtime status."
                >
                  {deployment?.agentcoreStatus ?? "…"}
                </SettingsRow>
              </>
            )}
          </SettingsSection>

          {!deploymentFailed ? (
            <SettingsSection label="Resources & URLs">
              <ResourceRow
                label="S3 bucket"
                description="Workspace and artifact storage bucket."
                value={deployment?.bucketName}
              />
              <ResourceRow
                label="Database"
                description="Aurora Postgres cluster endpoint."
                value={deployment?.databaseEndpoint}
              />
              <ResourceRow
                label="ECR"
                description="Container image registry for agent runtimes."
                value={deployment?.ecrUrl}
              />
              <ResourceRow
                label="API"
                description="GraphQL HTTP API endpoint."
                value={deployment?.apiEndpoint}
              />
              <ResourceRow
                label="AppSync"
                description="Realtime subscriptions endpoint."
                value={deployment?.appsyncUrl}
              />
            </SettingsSection>
          ) : null}
        </>
      ) : null}
    </SettingsPane>
  );
}

const RUNTIME_OPTIONS: { value: AgentRuntime; label: string }[] = [
  // FLUE is the Pi runtime; surfaced as "Pi" per product naming.
  { value: AgentRuntime.Flue, label: "Pi" },
];

/**
 * Tenant agent runtime + default model. Folded into General (operator-only);
 * formerly its own "Agent" settings page. Edits auto-save on change. The
 * AGENTS.md workspace editor now lives solely in Settings → Workspace.
 */
function AgentConfigSection() {
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

  const agent = agentResult.data?.agent;

  useEffect(() => {
    if (agent) {
      setRuntime(agent.runtime);
      setModel(agent.model ?? null);
    }
  }, [agent]);

  const catalog = catalogResult.data?.modelCatalog ?? [];
  const catalogFailed = !!catalogResult.error;

  async function persist(input: {
    runtime?: AgentRuntime;
    model?: string | null;
  }) {
    if (!tenantId) return;
    setErrorMsg(null);
    const result = await save({ tenantId, input });
    if (result.error) setErrorMsg(result.error.message);
  }

  return (
    <SettingsSection
      label="Agent"
      action={
        saveState.fetching ? (
          <span className="text-sm text-muted-foreground">Saving…</span>
        ) : errorMsg ? (
          <span className="text-sm text-destructive">{errorMsg}</span>
        ) : undefined
      }
    >
      <SettingsRow
        label="Runtime"
        description="Execution runtime that powers this tenant's agent."
      >
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
      </SettingsRow>

      <SettingsRow
        label="Default model"
        description="Model used when a thread doesn't specify its own."
      >
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
      </SettingsRow>
    </SettingsSection>
  );
}

function ResourceRow({
  label,
  description,
  value,
}: {
  label: string;
  description?: string;
  value?: string | null;
}) {
  return (
    <SettingsRow label={label} description={description}>
      <span className="max-w-[22rem] truncate font-mono text-xs">
        {value ?? "—"}
      </span>
    </SettingsRow>
  );
}

function EditorWrapRow() {
  const wrap = useEditorWrap();
  return (
    <SettingsRow
      label="Editor Wrap Text"
      description="Soft-wrap long lines in the workspace editor."
    >
      <Switch
        checked={wrap}
        onCheckedChange={(next) => setEditorWrap(next)}
        aria-label="Wrap text"
      />
    </SettingsRow>
  );
}

function EditorFontSizeRow() {
  const fontSize = useEditorFontSize();
  return (
    <SettingsRow
      label="Editor Font size"
      description="Text size for the workspace code/markdown editor."
    >
      <Select
        value={String(fontSize)}
        onValueChange={(v) => setEditorFontSize(Number(v))}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EDITOR_FONT_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}px
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

function ThreadNotificationsRow() {
  const enabled = useThreadNotificationsEnabled();

  async function onToggle(next: boolean) {
    setThreadNotificationsEnabled(next);
    if (next) {
      // Ask the OS for permission on enable; warn if the user has blocked it.
      const result = await requestDesktopNotificationPermission();
      if (result === "denied") {
        toast.message("Notifications are blocked", {
          description:
            "Enable notifications for ThinkWork in your system settings to receive them.",
        });
      }
    }
  }

  return (
    <SettingsRow
      label="Thread notifications"
      description="Show a desktop notification when a thread updates."
    >
      <Switch
        checked={enabled}
        onCheckedChange={(next) => void onToggle(next)}
        aria-label="Thread notifications"
      />
    </SettingsRow>
  );
}

function ThemeRow() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsRow
      label="Theme"
      description="Light or dark appearance on this device."
    >
      <Select
        value={theme}
        onValueChange={(v) => setTheme(v as "light" | "dark")}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}
