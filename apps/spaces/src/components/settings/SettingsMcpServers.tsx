import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Skeleton, Switch } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  deleteMcpServer,
  listMcpServers,
  setMcpServerEnabled,
  type McpServer,
} from "@/lib/mcp-api";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsMcpServers() {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

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

  async function toggle(id: string, enabled: boolean) {
    if (!tenantSlug) return;
    setPending((p) => ({ ...p, [id]: true }));
    setServers(
      (prev) => prev?.map((s) => (s.id === id ? { ...s, enabled } : s)) ?? prev,
    );
    try {
      await setMcpServerEnabled(tenantSlug, id, enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
      load();
    } finally {
      setPending((p) => ({ ...p, [id]: false }));
    }
  }

  async function remove(id: string) {
    if (!tenantSlug) return;
    setPending((p) => ({ ...p, [id]: true }));
    try {
      await deleteMcpServer(tenantSlug, id);
      setServers((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setPending((p) => ({ ...p, [id]: false }));
    }
  }

  if (!servers && !error) {
    return (
      <SettingsPane>
        <SettingsHeader title="MCP Servers" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title="MCP Servers"
        description="Model Context Protocol servers available to the agent."
      />
      <SettingsSection
        action={
          error ? (
            <span className="text-sm text-destructive">{error}</span>
          ) : undefined
        }
      >
        {(servers ?? []).length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No MCP servers configured.
          </div>
        ) : (
          (servers ?? []).map((server) => (
            <SettingsRow
              key={server.id}
              label={server.name}
              description={server.url}
            >
              {server.status && server.status !== "approved" ? (
                <Badge variant="outline">{server.status}</Badge>
              ) : null}
              <Switch
                checked={server.enabled}
                disabled={pending[server.id]}
                onCheckedChange={(v) => toggle(server.id, v)}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={pending[server.id]}
                onClick={() => remove(server.id)}
              >
                Remove
              </Button>
            </SettingsRow>
          ))
        )}
      </SettingsSection>
    </SettingsPane>
  );
}
