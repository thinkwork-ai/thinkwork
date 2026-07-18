import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Switch,
  TooltipIconButton,
} from "@thinkwork/ui";
import {
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import {
  callRuntimeMcpTool,
  clearUserMcpToken,
  deleteMcpServer,
  getMcpServiceCredentialStatus,
  getAgentCoreOAuthStatus,
  completeAgentCoreOAuth,
  isPluginInstalledMcpServer,
  listMcpServers,
  listRuntimeMcpTools,
  listUserMcpServers,
  resolveMcpOAuthAuthorizeUrl,
  saveMcpServiceCredential,
  setMcpServerEnabled,
  startAgentCoreOAuth,
  type AgentCoreOAuthStatus,
  type McpServer,
  type McpServiceCredentialStatus,
  type RuntimeMcpTool,
} from "@/lib/mcp-api";
import {
  SettingsProvisionAnalystConnectorMutation,
  SettingsRefreshAnalystDataSourceMutation,
  SettingsTenantAgentQuery,
} from "@/lib/settings-queries";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsPageTitle,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

const TOOL_PAGE_SIZE = 25;

type DisplayTool = {
  name: string;
  description?: string;
  category?: string;
  source: "cached" | "runtime" | "catalog";
};

type CatalogTool = {
  name?: unknown;
  description?: unknown;
};

export function SettingsMcpServerDetail() {
  const { serverId } = useParams({
    from: "/_authed/settings/mcp-servers/$serverId",
  });
  const { user } = useAuth();
  const { tenant, tenantId, userId } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const oauthUserId = userId ?? user?.sub ?? null;
  const navigate = useNavigate();

  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [userServers, setUserServers] = useState<McpServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [agentCoreAuthStatus, setAgentCoreAuthStatus] =
    useState<AgentCoreOAuthStatus | null>(null);
  const [agentCoreAuthLoading, setAgentCoreAuthLoading] = useState(false);
  const [toolSearch, setToolSearch] = useState("");
  const [toolLimit, setToolLimit] = useState(TOOL_PAGE_SIZE);
  const [runtimeTools, setRuntimeTools] = useState<DisplayTool[] | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [serviceCredentialStatus, setServiceCredentialStatus] =
    useState<McpServiceCredentialStatus | null>(null);
  const [serviceCredentialToken, setServiceCredentialToken] = useState("");
  const [serviceCredentialLoading, setServiceCredentialLoading] =
    useState(false);
  const [serviceCredentialError, setServiceCredentialError] = useState<
    string | null
  >(null);
  // THINK-230: analyst connector re-approval.
  const [reApproveRotate, setReApproveRotate] = useState(false);
  const [reApproveNotice, setReApproveNotice] = useState<string | null>(null);
  const [reApproveError, setReApproveError] = useState<string | null>(null);
  const [reApproving, setReApproving] = useState(false);
  const [, provisionAnalystConnector] = useMutation(
    SettingsProvisionAnalystConnectorMutation,
  );
  // THINK-283: sourced connector explicit refresh.
  const [refreshConfirming, setRefreshConfirming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [, refreshAnalystDataSource] = useMutation(
    SettingsRefreshAnalystDataSourceMutation,
  );

  const [{ data: agentData }] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const runtimeAgentId = agentData?.agent?.id ?? null;

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    Promise.all([
      listMcpServers(tenantSlug),
      tenantId && oauthUserId
        ? listUserMcpServers(tenantId, oauthUserId)
        : Promise.resolve({ servers: [] }),
    ])
      .then(([tenantResult, userResult]) => {
        setServers(tenantResult.servers);
        setUserServers(userResult.servers);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [oauthUserId, tenantId, tenantSlug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("mcpOAuth");
    if (!status) return;

    const returnedServerId = params.get("mcpServerId");
    if (returnedServerId && returnedServerId !== serverId) return;

    if (status === "success") {
      setNotice("Authentication connected.");
      setError(null);
    } else {
      const reason = params.get("reason");
      setNotice(null);
      setError(
        reason
          ? `Authentication failed: ${reason.replace(/_/g, " ")}.`
          : "Authentication failed.",
      );
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("mcpOAuth");
    nextUrl.searchParams.delete("mcpServerId");
    nextUrl.searchParams.delete("reason");
    nextUrl.searchParams.delete("status");
    window.history.replaceState({}, "", nextUrl.toString());
    load();
  }, [load, serverId]);

  const server = useMemo(() => {
    const tenantServer = servers?.find((s) => s.id === serverId) ?? null;
    if (!tenantServer) return null;
    const userServer = userServers.find((s) => s.id === serverId);
    if (!userServer) return tenantServer;
    return {
      ...tenantServer,
      authStatus: userServer.authStatus,
      tools: userServer.tools ?? tenantServer.tools,
    };
  }, [servers, serverId, userServers]);

  const isTwenty = isTwentyServer(server);

  useEffect(() => {
    if (!tenantSlug || !isTwenty) return;
    let cancelled = false;
    setAgentCoreAuthLoading(true);
    getAgentCoreOAuthStatus(tenantSlug)
      .then((result) => {
        if (!cancelled) setAgentCoreAuthStatus(result.status);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? `AgentCore connection check failed: ${cause.message}`
              : "AgentCore connection check failed.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAgentCoreAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isTwenty, tenantSlug]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get("agentcoreOAuth");
    if (oauthStatus === "success") {
      setAgentCoreAuthStatus("connected");
      setNotice("AgentCore Identity connected.");
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("agentcoreOAuth");
      window.history.replaceState({}, "", nextUrl.toString());
      return;
    }
    if (oauthStatus !== "pending" || !tenantSlug) return;
    const sessionId = params.get("agentcoreSessionId");
    const state = params.get("agentcoreState");
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("agentcoreOAuth");
    nextUrl.searchParams.delete("agentcoreSessionId");
    nextUrl.searchParams.delete("agentcoreState");
    window.history.replaceState({}, "", nextUrl.toString());
    if (!sessionId || !state) {
      setError("AgentCore authorization callback was incomplete.");
      return;
    }
    let cancelled = false;
    setAgentCoreAuthLoading(true);
    completeAgentCoreOAuth(tenantSlug, sessionId, state)
      .then(() => {
        if (cancelled) return;
        setAgentCoreAuthStatus("connected");
        setNotice("AgentCore Identity connected.");
        setError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? `AgentCore authorization failed: ${cause.message}`
            : "AgentCore authorization failed.",
        );
      })
      .finally(() => {
        if (!cancelled) setAgentCoreAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const loadRuntimeTools = useCallback(async () => {
    if (!server || !runtimeAgentId) return;
    setToolsLoading(true);
    setToolsError(null);
    try {
      const runtimeResult = await listRuntimeMcpTools(runtimeAgentId);
      const serverKey = server.slug ?? server.name;
      const matching = runtimeResult.tools.filter((tool) =>
        runtimeToolMatchesServer(tool, server),
      );
      let displayTools = matching.map(runtimeToolToDisplayTool);

      const catalogTool = matching.find(
        (tool) => tool.tool === "get_tool_catalog",
      );
      if (catalogTool) {
        const catalogResult = await callRuntimeMcpTool(
          runtimeAgentId,
          catalogTool.server || serverKey,
          catalogTool.tool,
        );
        const catalogTools = extractCatalogTools(catalogResult);
        if (catalogTools.length > 0) displayTools = catalogTools;
      }

      setRuntimeTools(sortTools(displayTools));
    } catch (e) {
      setToolsError(
        e instanceof Error ? e.message : "Failed to import runtime tools",
      );
    } finally {
      setToolsLoading(false);
    }
  }, [runtimeAgentId, server]);

  const loadServiceCredentialStatus = useCallback(async () => {
    if (!tenantSlug || !server || server.authType !== "service_credential") {
      setServiceCredentialStatus(null);
      setServiceCredentialError(null);
      return;
    }
    setServiceCredentialLoading(true);
    setServiceCredentialError(null);
    try {
      const status = await getMcpServiceCredentialStatus(tenantSlug, server.id);
      setServiceCredentialStatus(status);
    } catch (e) {
      setServiceCredentialError(
        e instanceof Error
          ? e.message
          : "Failed to load service credential status",
      );
    } finally {
      setServiceCredentialLoading(false);
    }
  }, [server, tenantSlug]);

  useEffect(() => {
    setRuntimeTools(null);
    setToolsError(null);
    setToolLimit(TOOL_PAGE_SIZE);
    setToolSearch("");
  }, [server?.id]);

  useEffect(() => {
    void loadServiceCredentialStatus();
  }, [loadServiceCredentialStatus]);

  useEffect(() => {
    const canImport =
      server &&
      runtimeAgentId &&
      server.enabled &&
      server.runtimeEnabled !== false &&
      (server.authType === "oauth" || server.authType === "per_user_oauth"
        ? server.authStatus === "active"
        : true);
    if (!canImport) return;
    void loadRuntimeTools();
  }, [loadRuntimeTools, runtimeAgentId, server]);

  usePageHeaderActions({
    title: server?.name ?? "MCP Server",
    breadcrumbs: [
      { label: "MCP Servers", href: "/settings/mcp-servers/servers" },
      { label: server?.name ?? "MCP Server" },
    ],
  });

  async function toggle(enabled: boolean) {
    if (!tenantSlug || !server) return;
    setPending(true);
    setServers(
      (prev) =>
        prev?.map((s) => (s.id === server.id ? { ...s, enabled } : s)) ?? prev,
    );
    try {
      await setMcpServerEnabled(tenantSlug, server.id, enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
      load();
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!tenantSlug || !server) return;
    setPending(true);
    try {
      await deleteMcpServer(tenantSlug, server.id);
      navigate({ to: "/settings/mcp-servers/servers" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
      setPending(false);
    }
  }

  async function authenticate() {
    if (!tenantId || !oauthUserId || !server) return;
    setPending(true);
    setError(null);
    setNotice("Opening authorization...");
    try {
      const authorizeUrl = await resolveMcpOAuthAuthorizeUrl({
        mcpServerId: server.id,
        userId: oauthUserId,
        tenantId,
        returnTo: mcpOAuthReturnTo(),
        force: true,
      });
      window.location.assign(authorizeUrl);
      window.setTimeout(() => {
        setPending(false);
        setNotice(null);
      }, 1500);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Authentication failed to start: ${e.message}`
          : "Authentication failed to start.",
      );
      setNotice(null);
      setPending(false);
    }
  }

  async function authenticateAgentCore() {
    if (!tenantSlug || !isTwenty) return;
    setAgentCoreAuthLoading(true);
    setError(null);
    setNotice("Opening AgentCore Identity authorization...");
    try {
      const result = await startAgentCoreOAuth(tenantSlug, mcpOAuthReturnTo());
      if (result.status === "connected") {
        setAgentCoreAuthStatus("connected");
        setNotice("AgentCore Identity connected.");
        return;
      }
      if (!result.authorizationUrl) {
        throw new Error("authorization URL was not returned");
      }
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `AgentCore authorization failed to start: ${cause.message}`
          : "AgentCore authorization failed to start.",
      );
      setNotice(null);
      setAgentCoreAuthLoading(false);
    }
  }

  async function clearAuthentication() {
    if (!tenantId || !oauthUserId || !server) return;
    setPending(true);
    setNotice(null);
    try {
      await clearUserMcpToken(tenantId, oauthUserId, server.id);
      setUserServers((prev) =>
        prev.map((s) =>
          s.id === server.id ? { ...s, authStatus: "not_connected" } : s,
        ),
      );
      setNotice("Authentication removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear credentials");
    } finally {
      setPending(false);
    }
  }

  async function saveServiceCredential() {
    if (!tenantSlug || !server || server.authType !== "service_credential") {
      return;
    }
    setPending(true);
    setNotice(null);
    setServiceCredentialError(null);
    try {
      const result = await saveMcpServiceCredential(
        tenantSlug,
        server.id,
        serviceCredentialToken,
      );
      setServiceCredentialToken("");
      setServiceCredentialStatus((current) => ({
        authType: current?.authType ?? "service_credential",
        credentialKind: current?.credentialKind ?? null,
        hasCredential: true,
        lastFour: result.lastFour ?? current?.lastFour ?? null,
        secretRefConfigured: current?.secretRefConfigured ?? true,
        headerName: result.headerName ?? current?.headerName ?? null,
        secretJsonKey: result.secretJsonKey ?? current?.secretJsonKey ?? null,
      }));
      setNotice("Service credential saved.");
      await loadServiceCredentialStatus();
      if (runtimeAgentId) void loadRuntimeTools();
    } catch (e) {
      setServiceCredentialError(
        e instanceof Error ? e.message : "Failed to save service credential",
      );
    } finally {
      setPending(false);
    }
  }

  // THINK-283: explicit fail-closed refresh of a SOURCED analyst connector.
  async function runSourceRefresh() {
    if (refreshing || !server) return;
    setRefreshing(true);
    setRefreshError(null);
    setRefreshNotice(null);
    try {
      const response = await refreshAnalystDataSource({ serverId: server.id });
      if (response.error) {
        setRefreshError(
          response.error.graphQLErrors[0]?.message ??
            response.error.message.replace(/^\[[^\]]*\]\s*/, ""),
        );
        return;
      }
      const outcome = response.data?.refreshAnalystDataSource;
      setRefreshNotice(
        outcome
          ? `Refreshed — ${outcome.tables} table(s) modeled` +
              (outcome.addedTables.length
                ? `; added ${outcome.addedTables.join(", ")}`
                : "") +
              (outcome.removedTables.length
                ? `; removed ${outcome.removedTables.join(", ")}`
                : "") +
              "."
          : "Source refreshed.",
      );
      setRefreshConfirming(false);
      load();
    } catch (e) {
      setRefreshError(
        e instanceof Error ? e.message : "Failed to refresh the source",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function reApproveAnalyst() {
    if (reApproving) return;
    setReApproving(true);
    setReApproveNotice(null);
    setReApproveError(null);
    try {
      const response = await provisionAnalystConnector({
        reApprove: true,
        rotateToken: reApproveRotate,
      });
      if (response.error) {
        // Surface the GraphQL error message verbatim.
        setReApproveError(
          response.error.graphQLErrors[0]?.message ??
            response.error.message.replace(/^\[[^\]]*\]\s*/, ""),
        );
        return;
      }
      const outcome = response.data?.provisionAnalystConnector;
      setReApproveNotice(
        outcome
          ? `Re-approved — connector ${outcome.connectorOutcome}, broker secret ${outcome.brokerSecretOutcome}, ${outcome.foldersWritten} folder(s) written.`
          : "Connection re-approved.",
      );
      setReApproveRotate(false);
      load();
    } catch (e) {
      setReApproveError(
        e instanceof Error ? e.message : "Failed to re-approve connection",
      );
    } finally {
      setReApproving(false);
    }
  }

  if (!servers && !error) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          {error ??
            "This MCP server could not be found — it may have been removed."}
        </p>
      </div>
    );
  }

  const cachedTools: DisplayTool[] = (server.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    source: "cached" as const,
  }));
  const tools = runtimeTools ?? cachedTools;
  const normalizedSearch = toolSearch.trim().toLowerCase();
  const filteredTools = tools.filter((tool) => {
    if (!normalizedSearch) return true;
    return [tool.name, tool.description, tool.category]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalizedSearch));
  });
  const visibleTools = filteredTools.slice(0, toolLimit);
  const hasMoreTools = filteredTools.length > visibleTools.length;
  const managed = isPluginInstalledMcpServer(server);
  const isAnalystConnector = isAnalystServer(server);
  // THINK-283: refresh applies ONLY to sourced connectors — the built-in
  // connector keeps its own provisioning action below.
  const isSourcedAnalyst = isSourcedAnalystServer(server);
  const refreshState = server.dataSource?.refresh ?? null;
  const authUnavailableReason = !tenantId
    ? "Tenant identity is still loading."
    : !oauthUserId
      ? "User identity is still loading."
      : null;
  const managedDescription =
    server.managementSource === "plugin"
      ? "Lifecycle changes are controlled from the plugin settings page."
      : "Lifecycle changes are controlled from the managed application settings page.";

  const statusBadge =
    server.status && server.status !== "approved" ? (
      <Badge variant="outline">{server.status}</Badge>
    ) : (
      <Badge variant="secondary">Approved</Badge>
    );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        {error ? (
          <p className="mb-4 text-sm text-destructive">{error}</p>
        ) : null}
        {notice ? (
          <p className="mb-4 text-sm text-emerald-500">{notice}</p>
        ) : null}

        <SettingsPageTitle title={server.name} badge={statusBadge} />

        <SettingsSection label="Server">
          <SettingsRow label="URL">
            <span className="max-w-md truncate font-mono text-xs">
              {server.url}
            </span>
          </SettingsRow>
          <SettingsRow label="Status">{statusBadge}</SettingsRow>
          {server.dataSource ? (
            <>
              <SettingsRow label="Source type">
                <Badge variant="outline" className="capitalize">
                  {server.dataSource.kind}
                </Badge>
              </SettingsRow>
              <SettingsRow label="Cluster">
                <span className="max-w-md truncate font-mono text-xs">
                  {server.dataSource.host
                    ? server.dataSource.host.split(".")[0]
                    : "workspace cluster"}
                </span>
              </SettingsRow>
              <SettingsRow label="Database">
                <span className="font-mono text-xs">
                  {server.dataSource.database}
                </span>
              </SettingsRow>
              <SettingsRow label="Schema">
                <span className="font-mono text-xs">
                  {server.dataSource.schema}
                </span>
              </SettingsRow>
            </>
          ) : null}
          {managed ? (
            <SettingsRow
              label={
                server.managementSource === "plugin"
                  ? "Plugin"
                  : "Managed application"
              }
              description={managedDescription}
            >
              <Badge variant="outline">
                {server.managementSource === "plugin"
                  ? "Plugin-managed"
                  : "System-managed"}
              </Badge>
            </SettingsRow>
          ) : null}
          <SettingsRow
            label="Enabled"
            description={
              managed
                ? "Managed application lifecycle controls whether this connector is available."
                : "Enable this server in the tenant registry. Assign it to the agent in the Composer."
            }
          >
            <Switch
              checked={server.enabled}
              disabled={pending || managed}
              onCheckedChange={toggle}
            />
          </SettingsRow>
        </SettingsSection>

        {server.authType === "oauth" || server.authType === "per_user_oauth" ? (
          <SettingsSection label="Authentication">
            <SettingsRow
              label={isTwenty ? "Pi access" : "User access"}
              description={
                isTwenty
                  ? "Legacy per-user connection retained while Pi and AgentCore run in parallel."
                  : "Authorize this MCP server with your ThinkWork user account."
              }
            >
              <Badge
                variant={
                  server.authStatus === "active" ? "outline" : "secondary"
                }
                className={
                  server.authStatus === "active"
                    ? "border-emerald-500/40 text-emerald-400"
                    : undefined
                }
              >
                {server.authStatus === "active"
                  ? "Connected"
                  : server.authStatus === "expired"
                    ? "Expired"
                    : "Not connected"}
              </Badge>
              <Button
                size="sm"
                disabled={pending || Boolean(authUnavailableReason)}
                title={authUnavailableReason ?? undefined}
                onClick={authenticate}
                className="gap-2"
              >
                <LogIn className="h-4 w-4" />
                {server.authStatus === "active" ? "Reconnect" : "Authenticate"}
              </Button>
              {server.authStatus === "active" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || Boolean(authUnavailableReason)}
                  title={authUnavailableReason ?? undefined}
                  onClick={clearAuthentication}
                  className="gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  Clear
                </Button>
              ) : null}
            </SettingsRow>
            {isTwenty ? (
              <SettingsRow
                label="AgentCore access"
                description="Authorize Twenty through AgentCore Identity. The user grant is stored in AgentCore Token Vault."
              >
                <Badge
                  variant={
                    agentCoreAuthStatus === "connected"
                      ? "outline"
                      : "secondary"
                  }
                  className={
                    agentCoreAuthStatus === "connected"
                      ? "border-emerald-500/40 text-emerald-400"
                      : undefined
                  }
                >
                  {agentCoreAuthLoading
                    ? "Checking"
                    : agentCoreAuthStatus === "connected"
                      ? "Connected"
                      : "Not connected"}
                </Badge>
                <Button
                  size="sm"
                  disabled={agentCoreAuthLoading}
                  onClick={() => void authenticateAgentCore()}
                  className="gap-2"
                >
                  {agentCoreAuthLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  {agentCoreAuthStatus === "connected"
                    ? "Reconnect"
                    : "Connect AgentCore"}
                </Button>
              </SettingsRow>
            ) : null}
          </SettingsSection>
        ) : null}

        {server.authType === "service_credential" ? (
          <SettingsSection label="Service credential">
            <SettingsRow
              label="Access token"
              description="Stored server-side and sent as the Authorization header for this MCP server."
              layout="stacked"
            >
              <div className="w-full space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      serviceCredentialStatus?.hasCredential
                        ? "outline"
                        : "secondary"
                    }
                    className={
                      serviceCredentialStatus?.hasCredential
                        ? "border-emerald-500/40 text-emerald-400"
                        : undefined
                    }
                  >
                    {serviceCredentialLoading
                      ? "Checking"
                      : serviceCredentialStatus?.hasCredential
                        ? "Configured"
                        : "Not configured"}
                  </Badge>
                  {serviceCredentialStatus?.lastFour ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      ends in {serviceCredentialStatus.lastFour}
                    </span>
                  ) : null}
                  {serviceCredentialStatus?.secretJsonKey ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {serviceCredentialStatus.secretJsonKey}
                    </span>
                  ) : null}
                </div>
                {serviceCredentialError ? (
                  <p className="text-sm text-destructive">
                    {serviceCredentialError}
                  </p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    aria-label="Service credential access token"
                    type="password"
                    autoComplete="off"
                    value={serviceCredentialToken}
                    placeholder={
                      serviceCredentialStatus?.hasCredential
                        ? "Paste replacement access token"
                        : "Paste access token"
                    }
                    disabled={pending || serviceCredentialLoading}
                    onChange={(event) =>
                      setServiceCredentialToken(event.currentTarget.value)
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      pending ||
                      serviceCredentialLoading ||
                      !serviceCredentialToken.trim()
                    }
                    onClick={() => void saveServiceCredential()}
                  >
                    {pending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : serviceCredentialStatus?.hasCredential ? (
                      <Save className="h-4 w-4" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    Save token
                  </Button>
                </div>
              </div>
            </SettingsRow>
          </SettingsSection>
        ) : null}

        {isSourcedAnalyst ? (
          <SettingsSection label="Data source">
            <SettingsRow
              label="Refresh source"
              description="Adopt tables created since registration (and drop removed ones) into the source's read surface. The source is unavailable while the refresh runs."
              layout="stacked"
            >
              <div className="w-full space-y-3">
                {refreshState?.status === "running" ? (
                  <p className="text-sm text-amber-500" role="status">
                    A refresh is in progress — the source is withheld until it
                    completes.
                  </p>
                ) : null}
                {refreshState?.status === "failed" ? (
                  <p className="text-sm text-destructive" role="alert">
                    {refreshState.detail ??
                      "The last refresh failed — the source is withheld until a retry succeeds."}
                  </p>
                ) : null}
                {refreshError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {refreshError}
                  </p>
                ) : null}
                {refreshNotice ? (
                  <p className="text-sm text-emerald-500" role="status">
                    {refreshNotice}
                  </p>
                ) : null}
                {refreshConfirming ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Refresh{" "}
                      <span className="font-mono">
                        {server.dataSource?.database}/
                        {server.dataSource?.schema}
                      </span>
                      ? The source is withheld from the agent while grants,
                      model, and folders reconcile, and previously issued access
                      is re-authorized against the new surface.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={refreshing}
                        onClick={() => void runSourceRefresh()}
                        className="gap-2"
                      >
                        {refreshing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Confirm refresh
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={refreshing}
                        onClick={() => setRefreshConfirming(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-start">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        refreshing || refreshState?.status === "running"
                      }
                      onClick={() => {
                        setRefreshError(null);
                        setRefreshNotice(null);
                        setRefreshConfirming(true);
                      }}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {refreshState?.status === "failed"
                        ? "Retry refresh"
                        : "Refresh source"}
                    </Button>
                  </div>
                )}
              </div>
            </SettingsRow>
          </SettingsSection>
        ) : null}

        {isAnalystConnector ? (
          <SettingsSection label="Analyst connection">
            <SettingsRow
              label="Re-approve connection"
              description="Restamp the approval and re-pin the config hash for the analyst Postgres connector. Optionally rotate the broker token."
              layout="stacked"
            >
              <div className="w-full space-y-3">
                {reApproveError ? (
                  <p className="text-sm text-destructive">{reApproveError}</p>
                ) : null}
                {reApproveNotice ? (
                  <p className="text-sm text-emerald-500">{reApproveNotice}</p>
                ) : null}
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={reApproveRotate}
                    disabled={reApproving}
                    onCheckedChange={(v) => setReApproveRotate(v === true)}
                    aria-label="Rotate broker token"
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      Rotate broker token
                    </span>
                    <span className="block text-muted-foreground">
                      Issue a fresh broker secret as part of the re-approval.
                    </span>
                  </span>
                </label>
                <div className="flex justify-start">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reApproving}
                    onClick={() => void reApproveAnalyst()}
                    className="gap-2"
                  >
                    {reApproving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    Re-approve connection
                  </Button>
                </div>
              </div>
            </SettingsRow>
          </SettingsSection>
        ) : null}

        <SettingsSection
          label={`Tools${tools.length ? ` (${tools.length})` : ""}`}
          action={
            <div className="flex items-center gap-2">
              <Input
                aria-label="Search tools"
                placeholder="Search tools..."
                value={toolSearch}
                onChange={(event) => {
                  setToolSearch(event.target.value);
                  setToolLimit(TOOL_PAGE_SIZE);
                }}
                className="h-8 w-48 text-sm"
              />
              <TooltipIconButton
                size="icon"
                label="Refresh tools"
                disabled={toolsLoading || !runtimeAgentId}
                onClick={loadRuntimeTools}
              >
                {toolsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </TooltipIconButton>
            </div>
          }
        >
          {toolsError ? (
            <div className="border-b border-border px-4 py-3 text-sm text-destructive">
              {toolsError}
            </div>
          ) : null}
          {toolsLoading && tools.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing tools...
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {tools.length === 0
                ? "No tools reported for this server."
                : "No tools match this search."}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleTools.map((tool) => (
                <div
                  key={`${tool.category ?? tool.source}:${tool.name}`}
                  className="px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words font-mono text-sm font-medium text-foreground">
                      {tool.name}
                    </p>
                    {tool.category ? (
                      <Badge variant="outline" className="shrink-0">
                        {tool.category}
                      </Badge>
                    ) : null}
                  </div>
                  {tool.description ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {tool.description}
                    </p>
                  ) : null}
                </div>
              ))}
              {hasMoreTools ? (
                <div className="flex justify-center px-4 py-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setToolLimit((current) => current + TOOL_PAGE_SIZE)
                    }
                  >
                    Show more
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </SettingsSection>

        {managed ? (
          <p className="text-right text-sm text-muted-foreground">
            {server.managementSource === "plugin"
              ? "Use the plugin settings to uninstall this connector."
              : "Use the managed application settings to park or destroy this connector."}
          </p>
        ) : (
          <div className="flex justify-end">
            <Button variant="destructive" disabled={pending} onClick={remove}>
              Remove server
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// THINK-230: the analyst Postgres connector is identified by its `postgres-dev`
// slug, or — more robustly — by a URL whose path ends in `/mcp/analyst`.
function isAnalystServer(server: McpServer): boolean {
  if (server.slug === "postgres-dev") return true;
  try {
    const pathname = new URL(server.url).pathname.replace(/\/+$/, "");
    return pathname.endsWith("/mcp/analyst");
  } catch {
    return server.url.replace(/\/+$/, "").endsWith("/mcp/analyst");
  }
}

// THINK-283: a SOURCED analyst connector rides `/mcp/analyst/<slug>` — the
// bare `/mcp/analyst` builtin is excluded (it has its own provisioning flow).
function isSourcedAnalystServer(server: McpServer): boolean {
  try {
    const pathname = new URL(server.url).pathname.replace(/\/+$/, "");
    return /^\/mcp\/analyst\/[a-z0-9][a-z0-9-]{1,38}$/.test(pathname);
  } catch {
    return false;
  }
}

function runtimeToolMatchesServer(tool: RuntimeMcpTool, server: McpServer) {
  const candidates = new Set(
    [server.slug, server.name, server.managedApplicationKey]
      .filter(Boolean)
      .map((value) => normalizeServerKey(value ?? "")),
  );
  const runtimeServer = normalizeServerKey(tool.server);
  const runtimeNamePrefix = normalizeServerKey(tool.name.split("__")[0] ?? "");
  return candidates.has(runtimeServer) || candidates.has(runtimeNamePrefix);
}

function isTwentyServer(server: McpServer | null) {
  if (!server) return false;
  const key = normalizeServerKey(server.slug ?? server.name);
  return key === "twenty--crm" || server.url.includes("crm.thinkwork.ai/mcp");
}

function mcpOAuthReturnTo() {
  if (typeof window === "undefined") return "/";
  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.delete("mcpOAuth");
  returnUrl.searchParams.delete("mcpServerId");
  returnUrl.searchParams.delete("reason");
  returnUrl.searchParams.delete("status");
  return returnUrl.toString();
}

function normalizeServerKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function runtimeToolToDisplayTool(tool: RuntimeMcpTool): DisplayTool {
  return {
    name: tool.tool || tool.name,
    description: tool.description,
    source: "runtime",
  };
}

function extractCatalogTools(result: {
  content?: Array<{ type?: string; text?: string }>;
}): DisplayTool[] {
  const text = result.content?.find((entry) => entry.text)?.text;
  if (!text) return [];

  try {
    const parsed = JSON.parse(text) as {
      catalog?: Record<string, CatalogTool[]>;
    };
    return Object.entries(parsed.catalog ?? {}).flatMap(([category, tools]) =>
      (Array.isArray(tools) ? tools : [])
        .filter((tool): tool is { name: string; description?: string } => {
          return typeof tool.name === "string" && tool.name.length > 0;
        })
        .map((tool) => ({
          name: tool.name,
          description:
            typeof tool.description === "string" ? tool.description : undefined,
          category,
          source: "catalog" as const,
        })),
    );
  } catch {
    return [];
  }
}

function sortTools(tools: DisplayTool[]) {
  return [...tools].sort((a, b) => {
    const categoryCompare = (a.category ?? "").localeCompare(b.category ?? "");
    if (categoryCompare !== 0) return categoryCompare;
    return a.name.localeCompare(b.name);
  });
}
