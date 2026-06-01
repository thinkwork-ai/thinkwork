import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useTheme,
} from "@thinkwork/ui";
import { AgentRuntime } from "@/gql/graphql";
import { LoadingShimmer } from "@/components/LoadingShimmer";
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
  SettingsRenameTenantSlugMutation,
  SettingsTenantAgentQuery,
  SettingsTenantDetailQuery,
  SettingsUpdateTenantAgentMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsGeneral() {
  const { tenantId, isOperator, roleResolved } = useTenant();

  const [tenantResult, refetchTenant] = useQuery({
    query: SettingsTenantDetailQuery,
    variables: { id: tenantId ?? "" },
    pause: !tenantId,
  });

  // Operators only — members never issue the deployment query (it is also
  // gated server-side in U8).
  const showOperator = roleResolved && isOperator;
  const [deployResult] = useQuery({
    query: SettingsDeploymentStatusQuery,
    pause: !showOperator,
  });

  if (tenantResult.fetching && !tenantResult.data) {
    return (
      <SettingsPane>
        <SettingsHeader
          title="General"
          description="Tenant configuration and preferences."
        />
        <div className="flex items-center justify-center py-24">
          <LoadingShimmer />
        </div>
      </SettingsPane>
    );
  }

  if (tenantResult.error || !tenantResult.data?.tenant) {
    return (
      <SettingsPane>
        <SettingsHeader
          title="General"
          description="Tenant configuration and preferences."
        />
        <SettingsSection>
          <div className="flex items-center justify-between p-6">
            <span className="text-sm text-muted-foreground">
              Couldn’t load tenant details.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchTenant({ requestPolicy: "network-only" })}
            >
              Retry
            </Button>
          </div>
        </SettingsSection>
      </SettingsPane>
    );
  }

  const tenant = tenantResult.data.tenant;
  const deployment = deployResult.data?.deploymentStatus;
  const deploymentFailed = showOperator && !!deployResult.error;

  return (
    <SettingsPane>
      <SettingsHeader
        title="General"
        description="Tenant configuration and preferences."
      />

      <SettingsSection label="Organization">
        <SettingsRow label="Name">{tenant.name}</SettingsRow>
        {tenant.plan ? (
          <SettingsRow label="Plan">{tenant.plan}</SettingsRow>
        ) : null}
        {tenant.issuePrefix ? (
          <SettingsRow label="Issue prefix">{tenant.issuePrefix}</SettingsRow>
        ) : null}
        {typeof tenant.issueCounter === "number" ? (
          <SettingsRow label="Issue counter">{tenant.issueCounter}</SettingsRow>
        ) : null}
        {tenant.createdAt ? (
          <SettingsRow label="Created">
            {new Date(tenant.createdAt).toLocaleDateString()}
          </SettingsRow>
        ) : null}
        <SubdomainRow
          slug={tenant.slug}
          tenantId={tenant.id}
          canRename={showOperator}
          onRenamed={() => refetchTenant({ requestPolicy: "network-only" })}
        />
      </SettingsSection>

      <SettingsSection label="Appearance">
        <ThemeRow />
        {isDesktop() ? (
          <>
            <EditorWrapRow />
            <EditorFontSizeRow />
          </>
        ) : null}
      </SettingsSection>

      {showOperator ? <AgentConfigSection /> : null}

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
                <SettingsRow label="Stage">
                  {deployment?.stage ?? "…"}
                </SettingsRow>
                <SettingsRow label="Region">
                  {deployment?.region ?? "…"}
                </SettingsRow>
                <SettingsRow label="Account">
                  {deployment?.accountId ?? "…"}
                </SettingsRow>
                <SettingsRow label="AgentCore">
                  {deployment?.agentcoreStatus ?? "…"}
                </SettingsRow>
              </>
            )}
          </SettingsSection>

          {!deploymentFailed ? (
            <SettingsSection label="Resources & URLs">
              <ResourceRow label="S3 bucket" value={deployment?.bucketName} />
              <ResourceRow
                label="Database"
                value={deployment?.databaseEndpoint}
              />
              <ResourceRow label="ECR" value={deployment?.ecrUrl} />
              <ResourceRow label="API" value={deployment?.apiEndpoint} />
              <ResourceRow label="AppSync" value={deployment?.appsyncUrl} />
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
  { value: AgentRuntime.Strands, label: "Strands" },
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
      <SettingsRow label="Runtime">
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

      <SettingsRow label="Default model">
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
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <SettingsRow label={label}>
      <span className="max-w-[22rem] truncate font-mono text-xs">
        {value ?? "—"}
      </span>
    </SettingsRow>
  );
}

function EditorWrapRow() {
  const wrap = useEditorWrap();
  return (
    <SettingsRow label="Editor Wrap Text">
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
    <SettingsRow label="Editor Font size">
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
    <SettingsRow label="Thread notifications">
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
    <SettingsRow label="Theme">
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

function SubdomainRow({
  slug,
  tenantId,
  canRename,
  onRenamed,
}: {
  slug: string;
  tenantId: string;
  canRename: boolean;
  onRenamed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slug);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [renameState, rename] = useMutation(SettingsRenameTenantSlugMutation);

  async function onSubmit() {
    setErrorMsg(null);
    const result = await rename({ tenantId, newSlug: draft.trim() });
    if (result.error) {
      setErrorMsg(result.error.message);
      return;
    }
    setEditing(false);
    onRenamed();
  }

  if (editing) {
    return (
      <SettingsRow label="Subdomain">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-8 w-48"
          aria-label="New subdomain"
        />
        <span className="text-muted-foreground">.thinkwork.ai</span>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={renameState.fetching || !draft.trim()}
        >
          {renameState.fetching ? "Saving…" : "Save"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            setDraft(slug);
            setErrorMsg(null);
          }}
        >
          Cancel
        </Button>
        {errorMsg ? <span className="text-destructive">{errorMsg}</span> : null}
      </SettingsRow>
    );
  }

  return (
    <SettingsRow label="Subdomain">
      {canRename ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Rename subdomain"
          className="font-mono text-xs outline-none hover:text-foreground focus-visible:underline"
        >
          {slug}.thinkwork.ai
        </button>
      ) : (
        <span className="font-mono text-xs">{slug}.thinkwork.ai</span>
      )}
    </SettingsRow>
  );
}
