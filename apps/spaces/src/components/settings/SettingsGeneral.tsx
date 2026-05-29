import { useState } from "react";
import { useMutation, useQuery } from "urql";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useTheme,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsDeploymentStatusQuery,
  SettingsRenameTenantSlugMutation,
  SettingsTenantDetailQuery,
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
        <SettingsHeader title="General" />
        <Skeleton className="mb-4 h-44 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  if (tenantResult.error || !tenantResult.data?.tenant) {
    return (
      <SettingsPane>
        <SettingsHeader title="General" />
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
      </SettingsSection>

      <TenantIdentifierSection
        slug={tenant.slug}
        tenantId={tenant.id}
        canRename={showOperator}
        onRenamed={() => refetchTenant({ requestPolicy: "network-only" })}
      />

      <SettingsSection label="Configuration">
        <SettingsRow label="Default model">
          {tenant.settings?.defaultModel ?? "—"}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label="Appearance">
        <ColorModeRow />
      </SettingsSection>

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

function ColorModeRow() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsRow
      label="Color mode"
      description="Light or dark theme on this device."
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

function TenantIdentifierSection({
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

  return (
    <SettingsSection
      label="Tenant identifier"
      action={
        canRename && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
          >
            Rename
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-8 w-56"
            aria-label="New subdomain"
          />
          <span className="text-sm text-muted-foreground">.thinkwork.ai</span>
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
          {errorMsg ? (
            <span className="text-sm text-destructive">{errorMsg}</span>
          ) : null}
        </div>
      ) : (
        <SettingsRow label="Subdomain">
          <span className="font-mono text-xs">{slug}.thinkwork.ai</span>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}
