import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { normalizeN8nPackageConfig } from "@thinkwork/plugin-n8n/package-config";
import {
  Badge,
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import {
  Activity,
  Copy,
  Loader2,
  PackagePlus,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { TenantCredentialKind, TenantCredentialStatus } from "@/gql/graphql";
import {
  getMcpServiceCredentialStatus,
  listMcpServers,
  saveMcpServiceCredential,
  type McpServer,
  type McpServiceCredentialStatus,
} from "@/lib/mcp-api";
import {
  SettingsCreateTenantCredentialMutation,
  SettingsManagedApplicationDeploymentQuery,
  SettingsN8nPluginSettingsQuery,
  SettingsRotateTenantCredentialMutation,
  SettingsTenantCredentialsQuery,
  SettingsUpdateTenantCredentialMutation,
  SettingsUpdateN8nPluginPackageSettingsMutation,
} from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { ManagedApplicationPlanDialog } from "@/components/settings/managed-applications/ManagedApplicationPlanDialog";
import { BridgeRunTelemetryPanel } from "@/components/workbench/BridgeRunTelemetryPanel";

const TERMINAL_JOB_STATUSES = new Set([
  "succeeded",
  "failed",
  "rejected",
  "cancelled",
  "canceled",
]);
const N8N_API_KEY_SESSION_STORAGE_KEY = "thinkwork:n8n-api-key";

export function N8nSettings({
  installId,
  installState,
  onChanged,
  onRecentAgentStepsActionChange,
}: {
  installId: string;
  installState: string;
  onChanged: () => void;
  onRecentAgentStepsActionChange?: (action: ReactNode | null) => void;
}) {
  const { tenant, tenantId } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const [rows, setRows] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [agentStepsOpen, setAgentStepsOpen] = useState(false);
  const [mcpServer, setMcpServer] = useState<McpServer | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpServiceCredentialStatus | null>(
    null,
  );
  const [mcpToken, setMcpToken] = useState("");
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [n8nApiKey, setN8nApiKey] = useState("");
  const [n8nApiError, setN8nApiError] = useState<string | null>(null);
  const [savedApiKeyLastFour, setSavedApiKeyLastFour] = useState<string | null>(
    null,
  );
  const firstInvalidRef = useRef<HTMLInputElement | null>(null);

  const [settingsResult, refreshSettings] = useQuery({
    query: SettingsN8nPluginSettingsQuery,
    variables: { installId },
    requestPolicy: "cache-and-network",
  });
  const [credentialResult, refreshCredentials] = useQuery({
    query: SettingsTenantCredentialsQuery,
    variables: {
      tenantId: tenantId ?? "",
      status: TenantCredentialStatus.Active,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [jobResult, refreshJob] = useQuery({
    query: SettingsManagedApplicationDeploymentQuery,
    variables: { jobId: selectedJobId ?? "" },
    pause: !selectedJobId,
    requestPolicy: "cache-and-network",
  });
  const [updateState, updatePackages] = useMutation(
    SettingsUpdateN8nPluginPackageSettingsMutation,
  );
  const [createCredentialState, createCredential] = useMutation(
    SettingsCreateTenantCredentialMutation,
  );
  const [rotateCredentialState, rotateCredential] = useMutation(
    SettingsRotateTenantCredentialMutation,
  );
  const [updateCredentialState, updateCredential] = useMutation(
    SettingsUpdateTenantCredentialMutation,
  );

  const settings = settingsResult.data?.n8nPluginSettings ?? null;
  const n8nApiCredential =
    credentialResult.data?.tenantCredentials.find(
      (credential) => credential.slug === "n8n-api",
    ) ?? null;
  const apiCredentialSaving =
    createCredentialState.fetching ||
    rotateCredentialState.fetching ||
    updateCredentialState.fetching;
  const n8nApiLastFour =
    savedApiKeyLastFour ??
    stringFromRecord(n8nApiCredential?.metadataJson, "apiKeyLastFour") ??
    stringFromRecord(n8nApiCredential?.metadataJson, "lastFour");
  const currentPackageConfig = settings?.currentPackageConfig ?? null;
  const job = jobResult.data?.managedApplicationDeployment ?? null;
  const inFlightJob =
    settings?.lastJobStatus &&
    !TERMINAL_JOB_STATUSES.has(settings.lastJobStatus)
      ? settings.lastJobStatus
      : null;

  useEffect(() => {
    if (!currentPackageConfig) return;
    setRows(currentPackageConfig.packageSpecs);
    setServerError(null);
  }, [currentPackageConfig?.digest]);

  const loadMcpServiceCredential = useCallback(async () => {
    if (!tenantSlug) return;
    setMcpLoading(true);
    setMcpError(null);
    try {
      const response = await listMcpServers(tenantSlug);
      const server =
        response.servers.find(isN8nServiceCredentialServer) ?? null;
      setMcpServer(server);
      if (!server) {
        setMcpStatus(null);
        return;
      }
      setMcpStatus(await getMcpServiceCredentialStatus(tenantSlug, server.id));
    } catch (error) {
      setMcpError(
        error instanceof Error
          ? error.message
          : "Failed to load n8n MCP credential status",
      );
    } finally {
      setMcpLoading(false);
    }
  }, [tenantSlug]);

  useEffect(() => {
    void loadMcpServiceCredential();
  }, [loadMcpServiceCredential]);

  useEffect(() => {
    if (!onRecentAgentStepsActionChange) return;
    onRecentAgentStepsActionChange(
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Open recent n8n agent steps"
        title="Recent agent steps"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setAgentStepsOpen(true)}
      >
        <Activity className="size-4" />
      </Button>,
    );
    return () => onRecentAgentStepsActionChange(null);
  }, [onRecentAgentStepsActionChange]);

  const local = useMemo(() => {
    try {
      const rawSpecs = rows.map((row) => row.trim()).filter(Boolean);
      const normalized = normalizeN8nPackageConfig(rawSpecs);
      const duplicateCount = rawSpecs.length - normalized.packageSpecs.length;
      return {
        config: normalized,
        duplicateCount,
        error: null as string | null,
      };
    } catch (error) {
      return {
        config: null,
        duplicateCount: 0,
        error: (error as Error).message,
      };
    }
  }, [rows]);

  const dirty =
    local.config && currentPackageConfig
      ? local.config.digest !== currentPackageConfig.digest
      : false;
  const disabled =
    !settings ||
    settingsResult.fetching ||
    updateState.fetching ||
    installState === "uninstalling" ||
    Boolean(inFlightJob);
  const canSubmit = Boolean(local.config && dirty && !disabled);

  function setRow(index: number, value: string) {
    setServerError(null);
    const pasted = splitPackageSpecs(value);
    if (pasted.length > 1) {
      setRows((current) => [
        ...current.slice(0, index),
        ...pasted,
        ...current.slice(index + 1),
      ]);
      return;
    }
    setRows((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? value : entry,
      ),
    );
  }

  function addRow() {
    setServerError(null);
    setRows((current) => [...current, ""]);
  }

  function removeRow(index: number) {
    setServerError(null);
    setRows((current) => {
      const next = current.filter((_, entryIndex) => entryIndex !== index);
      return next;
    });
  }

  async function submit() {
    setServerError(null);
    if (!local.config || !currentPackageConfig) {
      firstInvalidRef.current?.focus();
      return;
    }
    const result = await updatePackages({
      input: {
        installId,
        customPackageSpecs: local.config.packageSpecs,
        expectedCurrentDigest: currentPackageConfig.digest,
        idempotencyKey: [
          "n8n",
          "packages",
          local.config.digest.slice(0, 12),
          Date.now().toString(36),
        ].join("-"),
      },
    });
    if (result.error) {
      setServerError(result.error.message);
      toast.error(`Could not create n8n package plan: ${result.error.message}`);
      firstInvalidRef.current?.focus();
      return;
    }
    const deploymentJob =
      result.data?.updateN8nPluginPackageSettings.deploymentJob ?? null;
    if (deploymentJob) {
      setSelectedJobId(deploymentJob.id);
      setDialogOpen(true);
    }
    toast.success("n8n package plan created.");
    refreshSettings({ requestPolicy: "network-only" });
    onChanged();
  }

  function openLatestJob() {
    if (settings?.lastJobId) {
      setSelectedJobId(settings.lastJobId);
      setDialogOpen(true);
    }
  }

  async function copyBridgeEndpoint() {
    const endpoint = settings?.agentStepBridgeEndpointPath;
    if (!endpoint) return;
    await navigator.clipboard.writeText(endpoint);
    toast.success("n8n bridge endpoint copied.");
  }

  async function saveMcpAccessToken() {
    if (!tenantSlug || !mcpServer || !mcpToken.trim()) return;
    setMcpSaving(true);
    setMcpError(null);
    try {
      const result = await saveMcpServiceCredential(
        tenantSlug,
        mcpServer.id,
        mcpToken,
      );
      setMcpToken("");
      setMcpStatus((current) => ({
        authType: current?.authType ?? "service_credential",
        credentialKind: current?.credentialKind ?? "n8n-mcp-access-token",
        hasCredential: true,
        lastFour: result.lastFour ?? current?.lastFour ?? null,
        secretRefConfigured: current?.secretRefConfigured ?? true,
        headerName: result.headerName ?? current?.headerName ?? null,
        secretJsonKey: result.secretJsonKey ?? current?.secretJsonKey ?? null,
      }));
      toast.success("n8n MCP access token saved.");
      await loadMcpServiceCredential();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save n8n MCP access token";
      setMcpError(message);
      toast.error(message);
    } finally {
      setMcpSaving(false);
    }
  }

  async function saveN8nApiCredential() {
    const apiKey = n8nApiKey.trim();
    if (!apiKey || !tenantId) return;
    setN8nApiError(null);
    const baseUrl = n8nPublicUrl(settings?.desiredConfig);
    const apiKeyLastFour = apiKey.slice(-6);
    const metadata = {
      ...recordFromUnknown(n8nApiCredential?.metadataJson),
      ...(baseUrl ? { n8nBaseUrl: baseUrl } : {}),
      apiKeyLastFour,
    };
    const result = n8nApiCredential
      ? await rotateCredential({
          input: {
            id: n8nApiCredential.id,
            secretJson: JSON.stringify({ apiKey }),
          },
        }).then(async (rotateResult) => {
          if (rotateResult.error) return rotateResult;
          return updateCredential({
            id: n8nApiCredential.id,
            input: { metadataJson: JSON.stringify(metadata) },
          });
        })
      : await createCredential({
          input: {
            tenantId,
            displayName: "n8n API key",
            slug: "n8n-api",
            kind: TenantCredentialKind.ApiKey,
            metadataJson: JSON.stringify(metadata),
            secretJson: JSON.stringify({ apiKey }),
          },
        });
    if (result.error) {
      setN8nApiError(result.error.message);
      toast.error(`Could not save n8n API key: ${result.error.message}`);
      return;
    }
    if (import.meta.env.DEV) {
      window.sessionStorage.setItem(N8N_API_KEY_SESSION_STORAGE_KEY, apiKey);
    }
    setN8nApiKey("");
    setSavedApiKeyLastFour(apiKeyLastFour);
    toast.success("n8n API key saved.");
    refreshSettings({ requestPolicy: "network-only" });
    refreshCredentials({ requestPolicy: "network-only" });
    onChanged();
  }

  const firstError = local.error ?? serverError;
  const packageSpecs = local.config?.packageSpecs ?? [];
  const packageCount = packageSpecs.length;

  return (
    <SettingsSection label="n8n Settings">
      <SettingsRow
        label={
          <SettingsLabelWithBadge
            label="n8n API key"
            badge={
              <StatusBadge configured={Boolean(n8nApiCredential)}>
                {n8nApiCredential ? "Configured" : "Not configured"}
              </StatusBadge>
            }
          />
        }
        description="Used to pull published workflows from the n8n public API into ThinkWork discovery."
        layout="stacked"
      >
        <div className="w-full space-y-3">
          {n8nApiError ? (
            <p className="text-sm text-destructive">{n8nApiError}</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              aria-label="n8n API key"
              type="password"
              autoComplete="off"
              value={n8nApiKey}
              placeholder={
                n8nApiLastFour
                  ? `API key ending in ...${n8nApiLastFour}`
                  : n8nApiCredential
                    ? "Paste replacement n8n API key"
                    : "Paste n8n API key"
              }
              disabled={!settings || !tenantId || apiCredentialSaving}
              onChange={(event) => setN8nApiKey(event.currentTarget.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={
                !settings || !tenantId || apiCredentialSaving || !n8nApiKey.trim()
              }
              onClick={() => void saveN8nApiCredential()}
            >
              {apiCredentialSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save
            </Button>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow
        label={
          <SettingsLabelWithBadge
            label="MCP access token"
            badge={
              <StatusBadge configured={Boolean(mcpStatus?.hasCredential)}>
                {mcpLoading
                  ? "Checking"
                  : mcpStatus?.hasCredential
                    ? "Configured"
                    : "Not configured"}
              </StatusBadge>
            }
          />
        }
        description="Stored server-side and sent as the Authorization header for the n8n workflow-management MCP server."
        layout="stacked"
      >
        <div className="w-full space-y-3">
          {mcpError ? (
            <p className="text-sm text-destructive">{mcpError}</p>
          ) : null}
          {!mcpServer && !mcpLoading ? (
            <p className="text-sm text-muted-foreground">
              n8n MCP server is not available yet.
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              aria-label="n8n MCP access token"
              type="password"
              autoComplete="off"
              value={mcpToken}
              placeholder={
                mcpStatus?.lastFour
                  ? `Access token ending in ...${mcpStatus.lastFour}`
                  : mcpStatus?.hasCredential
                    ? "Paste replacement access token"
                    : "Paste access token"
              }
              disabled={!mcpServer || mcpLoading || mcpSaving}
              onChange={(event) => setMcpToken(event.currentTarget.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={
                !mcpServer || mcpLoading || mcpSaving || !mcpToken.trim()
              }
              onClick={() => void saveMcpAccessToken()}
            >
              {mcpSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save
            </Button>
          </div>
        </div>
      </SettingsRow>

      {!onRecentAgentStepsActionChange ? (
        <SettingsRow
          label="Recent agent steps"
          description="Redacted bridge-run evidence from n8n workflow steps that delegated work to ThinkWork agents."
          layout="stacked"
        >
          <BridgeRunTelemetryPanel
            runs={settings?.recentAgentStepRuns ?? []}
            title="Recent bridge runs"
            compact
            className="w-full"
          />
          {settings?.recentAgentStepRuns?.length ? null : (
            <p className="text-sm text-muted-foreground">
              No n8n agent-step bridge runs yet.
            </p>
          )}
        </SettingsRow>
      ) : null}

      <SettingsRow
        label={
          <SettingsLabelWithBadge
            label="Custom packages"
            badge={
              <Badge variant={packageCount === 0 ? "secondary" : "outline"}>
                {packageCount} package{packageCount === 1 ? "" : "s"}
              </Badge>
            }
          />
        }
        description="Pinned public npm packages injected into the n8n image and allow-listed for Code nodes."
        layout="stacked"
      >
        <div className="w-full space-y-3">
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_2rem]"
              >
                <div className="grid gap-1.5">
                  <Label htmlFor={`n8n-package-${index}`} className="sr-only">
                    n8n package {index + 1}
                  </Label>
                  <Input
                    ref={
                      index === 0
                        ? (element) => {
                            firstInvalidRef.current = element;
                          }
                        : undefined
                    }
                    id={`n8n-package-${index}`}
                    value={row}
                    placeholder="Package Name @ Version"
                    autoComplete="off"
                    disabled={disabled}
                    aria-invalid={Boolean(firstError)}
                    onChange={(event) =>
                      setRow(index, event.currentTarget.value)
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove n8n package ${index + 1}`}
                  title="Remove package"
                  disabled={disabled || rows.length === 1}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          {firstError ? (
            <p role="alert" className="text-sm text-destructive">
              {firstError}
            </p>
          ) : null}
          {local.duplicateCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {local.duplicateCount} duplicate package{" "}
              {local.duplicateCount === 1 ? "entry was" : "entries were"}{" "}
              collapsed in the preview.
            </p>
          ) : null}

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="space-y-1">
              {packageSpecs.length ? (
                packageSpecs.map((spec) => (
                  <code
                    key={spec}
                    className="block font-mono text-xs text-foreground"
                  >
                    {spec}
                  </code>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No custom packages configured.
                </p>
              )}
            </div>
          </div>

          {settings?.packageImageConfigDigest ? (
            <p className="text-sm text-muted-foreground">
              Current package image digest: {settings.packageImageConfigDigest}
            </p>
          ) : null}
          {inFlightJob ? (
            <p className="text-sm text-muted-foreground">
              Package changes are locked while job {settings?.lastJobId} is{" "}
              {inFlightJob}.
            </p>
          ) : null}
          {settings?.lastJobError ? (
            <p className="text-sm text-destructive">
              Last package plan failed: {settings.lastJobError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={addRow}
            >
              <Plus className="size-4" />
              Add package
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              <PackagePlus className="size-4" />
              Create package plan
            </Button>
            {settings?.lastJobId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={openLatestJob}
              >
                <ShieldCheck className="size-4" />
                Review latest plan
              </Button>
            ) : null}
          </div>
        </div>
      </SettingsRow>

      <SettingsRow
        label={
          <SettingsLabelWithBadge
            label="Agent-step bridge"
            badge={
              <StatusBadge
                configured={Boolean(
                  settings?.agentStepBridgeCredentialConfigured,
                )}
              >
                {settings?.agentStepBridgeCredentialConfigured
                  ? "Configured"
                  : "Not configured"}
              </StatusBadge>
            }
          />
        }
        description="Tenant-scoped HTTP entrypoint for n8n workflows that delegate one workflow step to a ThinkWork agent."
        layout="stacked"
      >
        <div className="w-full space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <code className="min-h-9 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
              {settings?.agentStepBridgeEndpointPath ??
                "/api/integrations/n8n/agent-steps"}
            </code>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Copy n8n bridge endpoint"
              title="Copy endpoint"
              disabled={!settings?.agentStepBridgeEndpointPath}
              onClick={() => void copyBridgeEndpoint()}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      </SettingsRow>

      <ManagedApplicationPlanDialog
        job={job}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onJobChanged={(next) => {
          setSelectedJobId(next.id);
          refreshJob({ requestPolicy: "network-only" });
          refreshSettings({ requestPolicy: "network-only" });
          onChanged();
        }}
      />

      <Sheet open={agentStepsOpen} onOpenChange={setAgentStepsOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="border-b border-border/70 px-6 py-4 pr-14">
            <SheetTitle>Recent agent steps</SheetTitle>
            <SheetDescription>
              Redacted bridge-run evidence from n8n workflow steps that
              delegated work to ThinkWork agents.
            </SheetDescription>
          </SheetHeader>
          <div className="p-6">
            <BridgeRunTelemetryPanel
              runs={settings?.recentAgentStepRuns ?? []}
              title="Recent bridge runs"
              compact
              className="w-full"
            />
            {settings?.recentAgentStepRuns?.length ? null : (
              <p className="mt-3 text-sm text-muted-foreground">
                No n8n agent-step bridge runs yet.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </SettingsSection>
  );
}

function splitPackageSpecs(value: string): string[] {
  if (!/[\n,]/.test(value)) return [];
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function SettingsLabelWithBadge({
  label,
  badge,
}: {
  label: string;
  badge: ReactNode;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{label}</span>
      {badge}
    </span>
  );
}

function StatusBadge({
  configured,
  children,
}: {
  configured: boolean;
  children: ReactNode;
}) {
  return (
    <Badge
      variant={configured ? "outline" : "secondary"}
      className={
        configured ? "border-emerald-500/40 text-emerald-400" : undefined
      }
    >
      {children}
    </Badge>
  );
}

function n8nPublicUrl(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.publicUrl === "string" && record.publicUrl.trim()
    ? record.publicUrl.trim()
    : null;
}

function stringFromRecord(value: unknown, key: string): string | null {
  const record = recordFromUnknown(value);
  const entry = record[key];
  return typeof entry === "string" && entry.trim() ? entry.trim() : null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return recordFromUnknown(parsed);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isN8nServiceCredentialServer(server: McpServer): boolean {
  if (server.authType !== "service_credential") return false;
  if (server.managedApplicationKey === "n8n") return true;
  const slug = server.slug?.toLowerCase() ?? "";
  const name = server.name.toLowerCase();
  return slug.includes("n8n") || name.includes("n8n");
}
