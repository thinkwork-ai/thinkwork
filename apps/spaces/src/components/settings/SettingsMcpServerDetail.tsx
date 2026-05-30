import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Badge, Button, Switch } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  deleteMcpServer,
  listMcpServers,
  setMcpServerEnabled,
  type McpServer,
} from "@/lib/mcp-api";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsMcpServerDetail() {
  const { serverId } = useParams({
    from: "/_authed/settings/mcp-servers/$serverId",
  });
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const navigate = useNavigate();

  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    listMcpServers(tenantSlug)
      .then((r) => setServers(r.servers))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [tenantSlug]);

  useEffect(() => {
    load();
  }, [load]);

  const server = useMemo(
    () => servers?.find((s) => s.id === serverId) ?? null,
    [servers, serverId],
  );

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

  if (!servers && !error) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          {error ??
            "This MCP server could not be found — it may have been removed."}
        </p>
      </div>
    );
  }

  const tools = server.tools ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6">
        {error ? (
          <p className="mb-4 text-sm text-destructive">{error}</p>
        ) : null}

        <SettingsSection label="Server">
          <SettingsRow label="URL">
            <span className="max-w-md truncate font-mono text-xs">
              {server.url}
            </span>
          </SettingsRow>
          <SettingsRow label="Status">
            {server.status && server.status !== "approved" ? (
              <Badge variant="outline">{server.status}</Badge>
            ) : (
              <Badge variant="secondary">Approved</Badge>
            )}
          </SettingsRow>
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
