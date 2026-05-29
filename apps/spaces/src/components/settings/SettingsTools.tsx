import { useCallback, useEffect, useState } from "react";
import { Skeleton, Switch } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  listBuiltinTools,
  setBuiltinToolEnabled,
  type BuiltinTool,
} from "@/lib/builtin-tools-api";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsTools() {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const [tools, setTools] = useState<BuiltinTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    listBuiltinTools(tenantSlug)
      .then((r) => setTools(r.tools))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [tenantSlug]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(slug: string, enabled: boolean) {
    if (!tenantSlug) return;
    setPending((p) => ({ ...p, [slug]: true }));
    // Optimistic update.
    setTools(
      (prev) =>
        prev?.map((t) => (t.toolSlug === slug ? { ...t, enabled } : t)) ?? prev,
    );
    try {
      await setBuiltinToolEnabled(tenantSlug, slug, enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
      load(); // revert to server truth
    } finally {
      setPending((p) => ({ ...p, [slug]: false }));
    }
  }

  if (!tools && !error) {
    return (
      <SettingsPane>
        <SettingsHeader title="Built-in Tools" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title="Built-in Tools"
        description="Enable or disable the agent’s built-in tools."
      />
      <SettingsSection
        action={
          error ? (
            <span className="text-sm text-destructive">{error}</span>
          ) : undefined
        }
      >
        {(tools ?? []).length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No built-in tools available.
          </div>
        ) : (
          (tools ?? []).map((tool) => (
            <SettingsRow
              key={tool.id}
              label={tool.toolSlug}
              description={tool.provider ?? undefined}
            >
              <Switch
                checked={tool.enabled}
                disabled={pending[tool.toolSlug]}
                onCheckedChange={(v) => toggle(tool.toolSlug, v)}
              />
            </SettingsRow>
          ))
        )}
      </SettingsSection>
    </SettingsPane>
  );
}
