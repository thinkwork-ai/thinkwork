import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button, Input, Label } from "@thinkwork/ui";
import {
  ArrowDownToLine,
  Brain,
  KeyRound,
  LogIn,
  LogOut,
  RotateCw,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { getDesktopBridge } from "@/lib/desktop-runtime";
import {
  SettingsActivatePluginMutation,
  SettingsActivatePluginWithCredentialsMutation,
  SettingsDeactivatePluginMutation,
  SettingsInstallPluginMutation,
  SettingsManagedApplicationDeploymentQuery,
  SettingsMyPluginActivationsQuery,
  SettingsPluginCatalogQuery,
  SettingsPluginInstallsQuery,
  SettingsRetryPluginComponentMutation,
  SettingsUpgradePluginMutation,
} from "@/lib/settings-queries";
import {
  SettingsPageTitle,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { ManagedApplicationPlanDialog } from "@/components/settings/managed-applications/ManagedApplicationPlanDialog";
import { InstallKeyDialog } from "./InstallKeyDialog";
import { UninstallPluginDialog } from "./UninstallPluginDialog";
import {
  broadenedScopes,
  componentStateChipClassName,
  componentStateLabel,
  componentTypeLabel,
  installStateChipClassName,
  installStateLabel,
} from "./plugin-state";

/**
 * Plugin detail page (plan 2026-06-12-001 U8): component status, versions,
 * update flow, and per-user activation. Reachable by all members — Connect /
 * Disconnect are member affordances; install / update / retry / uninstall
 * render only for operators.
 */
export function PluginDetail() {
  const { pluginKey } = useParams({
    from: "/_authed/settings/plugins/$pluginKey",
  });
  const navigate = useNavigate();
  const { isOperator, roleResolved } = useTenant();
  const showOperatorActions = roleResolved && isOperator;
  const selfServiceOnly = roleResolved && !isOperator;

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installKeyError, setInstallKeyError] = useState<string | null>(null);
  const [installKeyOpen, setInstallKeyOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentialForm, setCredentialForm] = useState({
    apiKey: "",
    workspaceSlug: "",
  });

  const [catalogResult, refreshCatalog] = useQuery({
    query: SettingsPluginCatalogQuery,
    requestPolicy: "cache-and-network",
  });
  const [installsResult, refreshInstalls] = useQuery({
    query: SettingsPluginInstallsQuery,
    requestPolicy: "cache-and-network",
  });
  const [activationsResult, refreshActivations] = useQuery({
    query: SettingsMyPluginActivationsQuery,
    requestPolicy: "cache-and-network",
  });

  const [installMutationState, installPlugin] = useMutation(
    SettingsInstallPluginMutation,
  );
  const [upgradeState, upgradePlugin] = useMutation(
    SettingsUpgradePluginMutation,
  );
  const [retryState, retryComponent] = useMutation(
    SettingsRetryPluginComponentMutation,
  );
  const [activateState, activatePlugin] = useMutation(
    SettingsActivatePluginMutation,
  );
  const [activateWithCredentialsState, activatePluginWithCredentials] =
    useMutation(SettingsActivatePluginWithCredentialsMutation);
  const [deactivateState, deactivatePlugin] = useMutation(
    SettingsDeactivatePluginMutation,
  );

  const entry =
    catalogResult.data?.pluginCatalog.find(
      (candidate) => candidate.pluginKey === pluginKey,
    ) ?? null;
  // Installed state comes from pluginInstalls so the page keeps working when
  // the catalog is unreachable (installed plugins remain active).
  const install =
    installsResult.data?.pluginInstalls.find(
      (candidate) => candidate.pluginKey === pluginKey,
    ) ??
    entry?.install ??
    null;
  const activation =
    (install &&
      activationsResult.data?.myPluginActivations.find(
        (candidate) => candidate.pluginInstallId === install.id,
      )) ||
    null;
  const activationStatus =
    activation && activation.status !== "revoked" ? activation.status : null;

  const displayName = entry?.displayName ?? install?.pluginKey ?? pluginKey;
  const usesCredentialConnection = pluginUsesCredentialConnection(pluginKey);
  const authCapable =
    usesCredentialConnection ||
    (entry && pluginEntryIsAuthCapable(entry)) ||
    Boolean(activation);
  const premium = entry?.premium ?? null;
  const entitlement = entry?.entitlement ?? null;
  const hasActiveEntitlement = entitlement?.status === "active";
  const installNeedsKey = Boolean(
    premium?.installKeyRequired && !hasActiveEntitlement,
  );
  const isCompanyBrain = pluginKey === "company-brain";

  // Mutations don't invalidate urql's document cache — refetch every affected
  // query explicitly after each one.
  function refreshAll() {
    refreshInstalls({ requestPolicy: "network-only" });
    refreshCatalog({ requestPolicy: "network-only" });
    refreshActivations({ requestPolicy: "network-only" });
  }

  // OAuth callback landing: /settings/plugins/$pluginKey?pluginOAuth=...
  // Read + clear the params on mount, show the notice, refetch activations
  // (mirrors SettingsMcpServerDetail's mcpOAuth handling).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("pluginOAuth");
    if (!status) return;

    if (status === "success") {
      setNotice("Connected.");
      setError(null);
    } else {
      const reason = params.get("reason");
      setNotice(null);
      setError(
        reason
          ? `Connection failed: ${reason.replace(/_/g, " ")}.`
          : "Connection failed.",
      );
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("pluginOAuth");
    nextUrl.searchParams.delete("reason");
    window.history.replaceState({}, "", nextUrl.toString());
    refreshActivations({ requestPolicy: "network-only" });
    refreshInstalls({ requestPolicy: "network-only" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only param sweep
  }, []);

  usePageHeaderActions({
    title: displayName,
    breadcrumbs: [
      { label: "Plugins", href: "/settings/plugins" },
      { label: displayName },
    ],
  });

  async function install_(installKey?: string) {
    setInstallKeyError(null);
    const idempotencyKey = [
      "plugins",
      pluginKey,
      "install",
      Date.now().toString(36),
    ].join("-");
    const result = await installPlugin({
      input: { pluginKey, idempotencyKey, installKey },
    });
    if (result.error) {
      if (installKey) {
        setInstallKeyError(result.error.message);
      }
      toast.error(`Could not install ${displayName}: ${result.error.message}`);
      return;
    }
    toast.success(`Installing ${displayName}.`);
    setInstallKeyOpen(false);
    refreshAll();
  }

  async function installUpdate() {
    if (!install || !entry) return;
    const idempotencyKey = [
      "plugins",
      pluginKey,
      "upgrade",
      entry.latestVersion,
      Date.now().toString(36),
    ].join("-");
    const result = await upgradePlugin({
      input: {
        installId: install.id,
        version: entry.latestVersion,
        idempotencyKey,
      },
    });
    if (result.error) {
      toast.error(`Could not update ${displayName}: ${result.error.message}`);
      return;
    }
    toast.success(`Updating ${displayName} to v${entry.latestVersion}.`);
    refreshAll();
  }

  async function retry(componentKey: string) {
    if (!install) return;
    const result = await retryComponent({
      input: { installId: install.id, componentKey },
    });
    if (result.error) {
      toast.error(`Could not retry ${componentKey}: ${result.error.message}`);
      return;
    }
    toast.success(`Retrying ${componentKey}.`);
    refreshInstalls({ requestPolicy: "network-only" });
    refreshCatalog({ requestPolicy: "network-only" });
  }

  async function connect() {
    if (!install) return;
    setNotice(null);
    setError(null);
    const returnTo = await pluginOAuthReturnTo(pluginKey);
    const result = await activatePlugin({
      input: {
        installId: install.id,
        returnTo,
      },
    });
    const authorizeUrl = result.data?.activatePlugin.authorizeUrl;
    if (result.error || !authorizeUrl) {
      setError(
        result.error
          ? `Could not start connection: ${result.error.message}`
          : "Could not start connection.",
      );
      return;
    }
    window.location.assign(authorizeUrl);
  }

  async function saveCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!install) return;
    setNotice(null);
    setError(null);
    setCredentialError(null);

    const apiKey = credentialForm.apiKey.trim();
    const workspaceSlug = credentialForm.workspaceSlug.trim();
    if (!apiKey || !workspaceSlug) {
      setCredentialError(
        "Enter both a Plane personal access token and workspace slug.",
      );
      return;
    }

    const result = await activatePluginWithCredentials({
      input: {
        installId: install.id,
        credentials: [
          { key: "apiKey", value: apiKey },
          { key: "workspaceSlug", value: workspaceSlug },
        ],
      },
    });
    if (result.error) {
      setCredentialError(`Could not save credentials: ${result.error.message}`);
      return;
    }

    setCredentialForm({ apiKey: "", workspaceSlug: "" });
    setNotice("Credentials saved.");
    toast.success("Credentials saved.");
    refreshActivations({ requestPolicy: "network-only" });
    refreshInstalls({ requestPolicy: "network-only" });
  }

  async function disconnect() {
    if (!install) return;
    const result = await deactivatePlugin({
      input: { installId: install.id },
    });
    if (result.error) {
      toast.error(`Could not disconnect: ${result.error.message}`);
      return;
    }
    toast.success("Disconnected.");
    refreshActivations({ requestPolicy: "network-only" });
    refreshInstalls({ requestPolicy: "network-only" });
  }

  const loading =
    (catalogResult.fetching || installsResult.fetching) && !entry && !install;
  if (loading) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">Loading plugin...</p>
      </div>
    );
  }

  if (!roleResolved) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">Loading plugin...</p>
      </div>
    );
  }

  if (!entry && !install) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          This plugin could not be found — it may have been removed from the
          catalog.
        </p>
      </div>
    );
  }

  if (selfServiceOnly && (!install || !authCapable)) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          This plugin is not available for self-service connection.
        </p>
      </div>
    );
  }

  const updateAvailable = Boolean(entry?.updateAvailable && install);
  const newScopes =
    updateAvailable && entry && install
      ? broadenedScopes(entry, install.pinnedVersion, entry.latestVersion)
      : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        {error ? (
          <p className="mb-4 text-sm text-destructive">{error}</p>
        ) : null}
        {notice ? (
          <p className="mb-4 text-sm text-emerald-500">{notice}</p>
        ) : null}

        <SettingsPageTitle
          title={displayName}
          description={entry ? pluginDetailDescription(entry) : undefined}
          badge={
            selfServiceOnly ? undefined : install ? (
              <Badge
                variant="outline"
                className={installStateChipClassName(install.state)}
              >
                {installStateLabel(install.state)}
              </Badge>
            ) : (
              <Badge variant="outline">Not installed</Badge>
            )
          }
        />

        {catalogResult.error ? (
          !selfServiceOnly ? (
            <p className="mb-6 text-sm text-muted-foreground">
              Plugin catalog is currently unavailable. Installed plugins remain
              active.
            </p>
          ) : null
        ) : null}

        {install?.state === "awaiting_approval" && !selfServiceOnly ? (
          <PluginPendingApprovalSection
            deploymentJobId={findPluginDeploymentJobId(install.components)}
            showOperatorActions={showOperatorActions}
            onJobChanged={refreshAll}
          />
        ) : null}

        {!install && entry && showOperatorActions ? (
          <SettingsSection label="Install">
            <SettingsRow
              label={`Install ${entry.displayName}`}
              description={`Latest version v${entry.latestVersion}.`}
            >
              <Button
                type="button"
                size="sm"
                disabled={installMutationState.fetching}
                onClick={() => {
                  if (installNeedsKey) {
                    setInstallKeyError(null);
                    setInstallKeyOpen(true);
                  } else {
                    void install_();
                  }
                }}
              >
                <ArrowDownToLine className="mr-2 size-4" />
                {installNeedsKey ? "Enter key" : "Install"}
              </Button>
            </SettingsRow>
          </SettingsSection>
        ) : null}

        {updateAvailable && entry && install && showOperatorActions ? (
          <SettingsSection label="Update available">
            <SettingsRow
              label={`v${install.pinnedVersion} → v${entry.latestVersion}`}
              description={
                newScopes.length > 0
                  ? `This update requests new permissions (${newScopes.join(", ")}). Connected users will need to reconnect.`
                  : "No re-authentication required."
              }
            >
              <Button
                type="button"
                size="sm"
                disabled={upgradeState.fetching}
                onClick={() => void installUpdate()}
              >
                <ArrowDownToLine className="mr-2 size-4" />
                Install update
              </Button>
            </SettingsRow>
          </SettingsSection>
        ) : null}

        {install && !selfServiceOnly ? (
          <SettingsSection label="Components">
            {install.lastError ? (
              <div className="border-b border-border px-4 py-3 text-sm text-destructive">
                {install.lastError}
              </div>
            ) : null}
            {install.components.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No components reported for this install.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {install.components.map((component) => (
                  <div key={component.id} className="px-4 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate font-mono text-sm text-foreground">
                          {component.componentKey}
                        </p>
                        <Badge variant="outline">
                          {componentTypeLabel(component.componentType)}
                        </Badge>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant="outline"
                          className={componentStateChipClassName(
                            component.state,
                          )}
                        >
                          {componentStateLabel(component.state)}
                        </Badge>
                        {component.state === "failed" && showOperatorActions ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={retryState.fetching}
                            aria-label={`Retry ${component.componentKey}`}
                            onClick={() => void retry(component.componentKey)}
                          >
                            <RotateCw className="mr-2 size-4" />
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {component.lastError ? (
                      <p className="mt-1 text-sm text-destructive">
                        {component.lastError}
                      </p>
                    ) : null}
                    {isCompanyBrain &&
                    component.componentType === "infrastructure" &&
                    handlerRefBoolean(
                      component.handlerRef,
                      "adoptionRequiresNoChange",
                    ) ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Adoption plan verifies the existing Brain substrate
                        before ownership changes.
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>
        ) : null}

        {isCompanyBrain && (install || hasActiveEntitlement) ? (
          <SettingsSection label="Workspace">
            <SettingsRow
              label="Brain operations"
              description="Inspect substrate status, migration posture, evidence, and operator actions."
            >
              <Button asChild type="button" variant="outline" size="sm">
                <Link to="/settings/brain-operations">
                  <Settings2 className="size-4" />
                  Open operations
                </Link>
              </Button>
            </SettingsRow>
            <SettingsRow
              label="Memory / Ontology"
              description="Open the graph workspace powered by Company Brain."
            >
              <Button asChild type="button" variant="outline" size="sm">
                <Link to="/settings/memory/knowledge-graph">
                  <Brain className="size-4" />
                  Open Ontology
                </Link>
              </Button>
            </SettingsRow>
          </SettingsSection>
        ) : null}

        {pluginKey === "twenty" && install && showOperatorActions ? (
          // U10 IA decision: SettingsCrm stays a standalone operator
          // deployment-detail page (service details, health checks,
          // lifecycle actions), reachable from here rather than folded
          // into PluginDetail — the smallest correct change while the
          // plugin and managed-application surfaces coexist.
          <SettingsSection label="Deployment">
            <SettingsRow
              label="Twenty CRM deployment"
              description="Runtime status, service details, health checks, and lifecycle actions for the deployed CRM."
            >
              <Button asChild type="button" variant="outline" size="sm">
                <Link to="/settings/crm">
                  <Settings2 className="size-4" />
                  Open deployment details
                </Link>
              </Button>
            </SettingsRow>
          </SettingsSection>
        ) : null}

        {install && authCapable ? (
          <SettingsSection label="Connection">
            {usesCredentialConnection ? (
              <PlaneCredentialConnectionRow
                activationStatus={activationStatus}
                credentialError={credentialError}
                credentialForm={credentialForm}
                disconnecting={deactivateState.fetching}
                saving={activateWithCredentialsState.fetching}
                onCredentialChange={(field, value) =>
                  setCredentialForm((current) => ({
                    ...current,
                    [field]: value,
                  }))
                }
                onDisconnect={() => void disconnect()}
                onSubmit={(event) => void saveCredentials(event)}
              />
            ) : (
              <OAuthConnectionRow
                activationStatus={activationStatus}
                activating={activateState.fetching}
                disconnecting={deactivateState.fetching}
                onConnect={() => void connect()}
                onDisconnect={() => void disconnect()}
              />
            )}
          </SettingsSection>
        ) : null}

        {install && showOperatorActions ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              disabled={install.state === "uninstalling"}
              onClick={() => setUninstallOpen(true)}
            >
              <Trash2 className="mr-2 size-4" />
              Uninstall plugin
            </Button>
          </div>
        ) : null}

        {install ? (
          <UninstallPluginDialog
            install={install}
            displayName={displayName}
            open={uninstallOpen}
            onOpenChange={setUninstallOpen}
            onUninstalled={() => {
              refreshAll();
              navigate({ to: "/settings/plugins" });
            }}
          />
        ) : null}
        {entry && premium ? (
          <InstallKeyDialog
            open={installKeyOpen}
            onOpenChange={setInstallKeyOpen}
            pluginName={entry.displayName}
            prompt={premium.installKeyPrompt}
            submitting={installMutationState.fetching}
            error={installKeyError}
            onSubmit={(key) => void install_(key)}
          />
        ) : null}
      </div>
    </div>
  );
}

function OAuthConnectionRow({
  activationStatus,
  activating,
  disconnecting,
  onConnect,
  onDisconnect,
}: {
  activationStatus: string | null;
  activating: boolean;
  disconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <SettingsRow
      label="Your access"
      description="Connect your account to use this plugin's tools and skills. One connection covers all of the plugin's servers."
    >
      <PluginConnectionStatusBadge activationStatus={activationStatus} />
      <Button
        size="sm"
        disabled={activating}
        onClick={onConnect}
        className="gap-2"
      >
        <LogIn className="size-4" />
        {activationStatus === "active" || activationStatus === "needs_reauth"
          ? "Reconnect"
          : "Connect"}
      </Button>
      {activationStatus ? (
        <Button
          size="sm"
          variant="outline"
          disabled={disconnecting}
          onClick={onDisconnect}
          className="gap-2"
        >
          <LogOut className="size-4" />
          Disconnect
        </Button>
      ) : null}
    </SettingsRow>
  );
}

function PlaneCredentialConnectionRow({
  activationStatus,
  credentialError,
  credentialForm,
  disconnecting,
  saving,
  onCredentialChange,
  onDisconnect,
  onSubmit,
}: {
  activationStatus: string | null;
  credentialError: string | null;
  credentialForm: { apiKey: string; workspaceSlug: string };
  disconnecting: boolean;
  saving: boolean;
  onCredentialChange: (
    field: "apiKey" | "workspaceSlug",
    value: string,
  ) => void;
  onDisconnect: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <SettingsRow
      label="Plane access"
      description="Save the credentials the agent uses for Plane work-item tools."
    >
      <form
        className="flex w-full min-w-[18rem] max-w-sm flex-col items-stretch gap-3 text-left"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-end gap-2">
          <PluginConnectionStatusBadge activationStatus={activationStatus} />
          {activationStatus ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disconnecting}
              onClick={onDisconnect}
              className="gap-2"
            >
              <LogOut className="size-4" />
              Disconnect
            </Button>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plane-plugin-api-key">
            Plane personal access token
          </Label>
          <Input
            id="plane-plugin-api-key"
            type="password"
            autoComplete="off"
            value={credentialForm.apiKey}
            onChange={(event) =>
              onCredentialChange("apiKey", event.currentTarget.value)
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plane-plugin-workspace-slug">Workspace slug</Label>
          <Input
            id="plane-plugin-workspace-slug"
            autoComplete="off"
            value={credentialForm.workspaceSlug}
            onChange={(event) =>
              onCredentialChange("workspaceSlug", event.currentTarget.value)
            }
          />
        </div>
        {credentialError ? (
          <p className="text-sm text-destructive">{credentialError}</p>
        ) : null}
        <Button type="submit" size="sm" disabled={saving} className="gap-2">
          <KeyRound className="size-4" />
          Save credentials
        </Button>
      </form>
    </SettingsRow>
  );
}

function PluginConnectionStatusBadge({
  activationStatus,
}: {
  activationStatus: string | null;
}) {
  return (
    <Badge
      variant={activationStatus === "active" ? "outline" : "secondary"}
      className={
        activationStatus === "active"
          ? "border-emerald-500/40 text-emerald-400"
          : activationStatus === "needs_reauth"
            ? "border-amber-500/40 text-amber-500"
            : undefined
      }
    >
      {activationStatus === "active"
        ? "Connected"
        : activationStatus === "needs_reauth"
          ? "Reconnect"
          : "Not connected"}
    </Badge>
  );
}

async function pluginOAuthReturnTo(pluginKey: string): Promise<string> {
  const path = `/settings/plugins/${pluginKey}`;
  const bridge = getDesktopBridge();
  if (!bridge) return `${window.location.origin}${path}`;

  try {
    const config = await bridge.getDesktopConfig();
    const scheme = new URL(config.oauthRedirectUri).protocol.replace(/:$/, "");
    if (scheme) return `${scheme}://app${path}`;
  } catch {
    // Fall through to the current origin; the API will surface validation
    // failures if the fallback cannot be used.
  }

  return `${window.location.origin}${path}`;
}

function pluginDetailDescription(entry: {
  pluginKey: string;
  description: string;
}): string {
  if (entry.pluginKey === "company-brain") {
    return entry.description.replace(/^Premium\s+/i, "");
  }
  return entry.description;
}

function pluginEntryIsAuthCapable(entry: {
  versions: Array<{ requiredOauthScopes?: readonly string[] | null }>;
}): boolean {
  return entry.versions.some(
    (version) => (version.requiredOauthScopes?.length ?? 0) > 0,
  );
}

function pluginUsesCredentialConnection(pluginKey: string): boolean {
  return pluginKey === "plane";
}

/**
 * handler_ref of an infrastructure component carries the linked deployment
 * job ({ managedApplicationId, deploymentJobId, ... }). AWSJSON may arrive
 * as an object or a JSON string depending on the transport.
 */
function findPluginDeploymentJobId(
  components: Array<{ componentType: string; handlerRef?: unknown }>,
): string | null {
  for (const component of components) {
    if (component.componentType !== "infrastructure") continue;
    let ref = component.handlerRef;
    if (typeof ref === "string") {
      try {
        ref = JSON.parse(ref);
      } catch {
        continue;
      }
    }
    if (ref && typeof ref === "object" && !Array.isArray(ref)) {
      const jobId = (ref as Record<string, unknown>).deploymentJobId;
      if (typeof jobId === "string" && jobId) return jobId;
    }
  }
  return null;
}

function handlerRefBoolean(value: unknown, key: string): boolean {
  let ref = value;
  if (typeof ref === "string") {
    try {
      ref = JSON.parse(ref);
    } catch {
      return false;
    }
  }
  return Boolean(
    ref &&
    typeof ref === "object" &&
    !Array.isArray(ref) &&
    (ref as Record<string, unknown>)[key] === true,
  );
}

/**
 * U11 handoff: an install parked at awaiting_approval links its infra
 * component's deployment plan job — review/approve/reject happens in the
 * EXISTING ManagedApplicationPlanDialog (no plugin-specific approval
 * surface).
 */
function PluginPendingApprovalSection({
  deploymentJobId,
  showOperatorActions,
  onJobChanged,
}: {
  deploymentJobId: string | null;
  showOperatorActions: boolean;
  onJobChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [jobResult, refetchJob] = useQuery({
    query: SettingsManagedApplicationDeploymentQuery,
    variables: { jobId: deploymentJobId ?? "" },
    pause: !deploymentJobId,
    requestPolicy: "cache-and-network",
  });
  const job = jobResult.data?.managedApplicationDeployment ?? null;

  return (
    <SettingsSection label="Pending approval">
      <SettingsRow
        label="Deployment plan awaiting approval"
        description={
          showOperatorActions
            ? "This plugin provisions managed infrastructure. Review the Terraform plan, data impact, and evidence before approving."
            : "This plugin provisions managed infrastructure. An operator must review and approve the deployment plan."
        }
      >
        {showOperatorActions && deploymentJobId ? (
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <ShieldCheck className="mr-2 size-4" />
            Review deployment plan
          </Button>
        ) : null}
      </SettingsRow>
      {showOperatorActions && deploymentJobId ? (
        <ManagedApplicationPlanDialog
          job={job}
          open={open}
          onOpenChange={setOpen}
          onJobChanged={() => {
            refetchJob({ requestPolicy: "network-only" });
            onJobChanged();
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
