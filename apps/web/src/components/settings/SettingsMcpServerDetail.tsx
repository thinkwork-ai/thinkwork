import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Badge, Button, Input, Switch } from "@thinkwork/ui";
import { Loader2, LogIn, LogOut, RefreshCw } from "lucide-react";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  buildMcpOAuthAuthorizeUrl,
  callRuntimeMcpTool,
  clearUserMcpToken,
  deleteMcpServer,
  isManagedMcpServer,
  listMcpServers,
  listRuntimeMcpTools,
  listUserMcpServers,
  setMcpServerEnabled,
  type McpServer,
  type RuntimeMcpTool,
} from "@/lib/mcp-api";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
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
  const { tenant, tenantId, userId } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const navigate = useNavigate();

  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [userServers, setUserServers] = useState<McpServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [toolSearch, setToolSearch] = useState("");
  const [toolLimit, setToolLimit] = useState(TOOL_PAGE_SIZE);
  const [runtimeTools, setRuntimeTools] = useState<DisplayTool[] | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);

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
      tenantId && userId
        ? listUserMcpServers(tenantId, userId)
        : Promise.resolve({ servers: [] }),
    ])
      .then(([tenantResult, userResult]) => {
        setServers(tenantResult.servers);
        setUserServers(userResult.servers);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [tenantId, tenantSlug, userId]);

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

  useEffect(() => {
    setRuntimeTools(null);
    setToolsError(null);
    setToolLimit(TOOL_PAGE_SIZE);
    setToolSearch("");
  }, [server?.id]);

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
      { label: "MCP Servers", href: "/settings/mcp-servers" },
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
      navigate({ to: "/settings/mcp-servers" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
      setPending(false);
    }
  }

  function authenticate() {
    if (!tenantId || !userId || !server) return;
    setPending(true);
    setNotice(null);
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.delete("mcpOAuth");
    returnUrl.searchParams.delete("mcpServerId");
    returnUrl.searchParams.delete("reason");
    returnUrl.searchParams.delete("status");
    const authorizeUrl = buildMcpOAuthAuthorizeUrl({
      mcpServerId: server.id,
      userId,
      tenantId,
      returnTo: returnUrl.toString(),
      force: true,
    });
    window.location.assign(authorizeUrl);
  }

  async function clearAuthentication() {
    if (!tenantId || !userId || !server) return;
    setPending(true);
    setNotice(null);
    try {
      await clearUserMcpToken(tenantId, userId, server.id);
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
  const managed = isManagedMcpServer(server);

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
          {managed ? (
            <SettingsRow
              label="Managed application"
              description="Lifecycle changes are controlled from the managed application settings page."
            >
              <Badge variant="outline">System-managed</Badge>
            </SettingsRow>
          ) : null}
          <SettingsRow
            label="Enabled"
            description={
              managed
                ? "Managed application lifecycle controls whether this connector is available."
                : "Make this server's tools available to the agent."
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
              label="User access"
              description="Authorize this MCP server with your ThinkWork user account."
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
                disabled={pending || !tenantId || !userId}
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
                  disabled={pending || !tenantId || !userId}
                  onClick={clearAuthentication}
                  className="gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  Clear
                </Button>
              ) : null}
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
              <Button
                size="icon"
                variant="ghost"
                aria-label="Refresh tools"
                title="Refresh tools"
                disabled={toolsLoading || !runtimeAgentId}
                onClick={loadRuntimeTools}
              >
                {toolsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
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
            Use the managed application settings to park or destroy this
            connector.
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
