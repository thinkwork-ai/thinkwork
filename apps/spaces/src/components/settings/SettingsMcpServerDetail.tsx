import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Badge, Button, Switch } from "@thinkwork/ui";
import { LogIn, LogOut } from "lucide-react";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  buildMcpOAuthAuthorizeUrl,
  clearUserMcpToken,
  deleteMcpServer,
  listMcpServers,
  listUserMcpServers,
  setMcpServerEnabled,
  type McpServer,
} from "@/lib/mcp-api";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsPageTitle,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

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

  const tools = server.tools ?? [];

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
          <SettingsRow
            label="Enabled"
            description="Make this server's tools available to the agent."
          >
            <Switch
              checked={server.enabled}
              disabled={pending}
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
        >
          {tools.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No tools reported for this server.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tools.map((tool) => (
                <div key={tool.name} className="px-4 py-3">
                  <p className="font-mono text-sm font-medium text-foreground">
                    {tool.name}
                  </p>
                  {tool.description ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {tool.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </SettingsSection>

        <div className="flex justify-end">
          <Button variant="destructive" disabled={pending} onClick={remove}>
            Remove server
          </Button>
        </div>
      </div>
    </div>
  );
}
