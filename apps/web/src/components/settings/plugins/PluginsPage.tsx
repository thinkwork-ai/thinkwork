import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button, ToggleGroup, ToggleGroupItem } from "@thinkwork/ui";
import { ArrowDownToLine, RefreshCw } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsInstallPluginMutation,
  SettingsMyPluginActivationsQuery,
  SettingsPluginCatalogQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { installStateChipClassName, installStateLabel } from "./plugin-state";

type PluginFilter = "all" | "installed";

/**
 * Plugins settings surface (plan 2026-06-12-001 U8): one catalog list with an
 * install-state overlay and an All / Installed filter. The catalog already
 * carries each plugin's install state via `entry.install`, so there is no
 * separate "Installed" list to duplicate it. Per-user `needs_reauth` is read
 * from `myPluginActivations` and surfaced as a "Reconnect needed" badge so the
 * list agrees with the sidebar reconnect warning. Reachable by all members
 * (Connect lives on the detail page); install actions render only for operators.
 */
export function PluginsPage() {
  const { isOperator, roleResolved } = useTenant();
  const showOperatorActions = roleResolved && isOperator;
  const [filter, setFilter] = useState<PluginFilter>("all");

  const [catalogResult, refreshCatalog] = useQuery({
    query: SettingsPluginCatalogQuery,
    requestPolicy: "cache-and-network",
  });
  const [activationsResult, refreshActivations] = useQuery({
    query: SettingsMyPluginActivationsQuery,
    requestPolicy: "cache-and-network",
  });
  const [installState, installPlugin] = useMutation(
    SettingsInstallPluginMutation,
  );

  const catalog = catalogResult.data?.pluginCatalog ?? [];
  const activations = activationsResult.data?.myPluginActivations ?? [];
  const catalogUnavailable = Boolean(catalogResult.error);
  const catalogLoading = catalogResult.fetching && catalog.length === 0;

  // Per-user reconnect state, keyed by plugin (mirrors the sidebar warning).
  const needsReauthKeys = new Set(
    activations
      .filter((activation) => activation.status === "needs_reauth")
      .map((activation) => activation.pluginKey),
  );

  const installedCount = catalog.filter((entry) => entry.install).length;
  const visible =
    filter === "installed" ? catalog.filter((entry) => entry.install) : catalog;

  function refreshAll() {
    refreshCatalog({ requestPolicy: "network-only" });
    refreshActivations({ requestPolicy: "network-only" });
  }

  async function install(pluginKey: string) {
    const idempotencyKey = [
      "plugins",
      pluginKey,
      "install",
      Date.now().toString(36),
    ].join("-");
    const result = await installPlugin({
      input: { pluginKey, idempotencyKey },
    });
    if (result.error) {
      toast.error(`Could not install ${pluginKey}: ${result.error.message}`);
      return;
    }
    toast.success(`Installing ${pluginKey}.`);
    // urql's document cache does not invalidate on its own — refetch every
    // affected query explicitly.
    refreshCatalog({ requestPolicy: "network-only" });
    refreshActivations({ requestPolicy: "network-only" });
  }

  return (
    <SettingsPane className="max-w-none">
      <SettingsHeader
        title="Plugins"
        description="Install applications from the plugin catalog and connect them to your account."
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={refreshAll}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className="size-4" />
          </Button>
        }
      />

      <SettingsSection
        label="Catalog"
        action={
          <ToggleGroup
            type="single"
            value={filter}
            variant="outline"
            size="sm"
            onValueChange={(value) => {
              if (value) setFilter(value as PluginFilter);
            }}
            aria-label="Filter plugins"
          >
            <ToggleGroupItem value="all" className="px-3 text-xs">
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="installed" className="px-3 text-xs">
              Installed{installedCount ? ` (${installedCount})` : ""}
            </ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {catalogUnavailable ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              Plugin catalog is currently unavailable. Installed plugins remain
              active.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => refreshCatalog({ requestPolicy: "network-only" })}
            >
              <RefreshCw className="mr-2 size-4" />
              Retry
            </Button>
          </div>
        ) : catalogLoading ? (
          <div className="p-4 text-sm text-muted-foreground">
            Loading plugin catalog...
          </div>
        ) : catalog.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            The plugin catalog is empty.
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No plugins are installed for this workspace.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((entry) => {
              const needsReauth =
                Boolean(entry.install) && needsReauthKeys.has(entry.pluginKey);
              return (
                <div
                  key={entry.pluginKey}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <Link
                      to="/settings/plugins/$pluginKey"
                      params={{ pluginKey: entry.pluginKey }}
                      className="text-sm font-medium text-foreground outline-none hover:underline focus-visible:underline"
                    >
                      {entry.displayName}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {entry.description}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Latest v{entry.latestVersion} · {entry.versions.length}{" "}
                      {entry.versions.length === 1 ? "version" : "versions"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {entry.install ? (
                      <>
                        {needsReauth ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 text-amber-400"
                          >
                            Reconnect needed
                          </Badge>
                        ) : null}
                        {entry.updateAvailable ? (
                          <Badge
                            variant="outline"
                            className="border-sky-500/40 text-sky-400"
                          >
                            Update available
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className={installStateChipClassName(
                            entry.install.state,
                          )}
                        >
                          {installStateLabel(entry.install.state)}
                        </Badge>
                      </>
                    ) : showOperatorActions ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={installState.fetching}
                        onClick={() => void install(entry.pluginKey)}
                      >
                        <ArrowDownToLine className="mr-2 size-4" />
                        Install
                      </Button>
                    ) : (
                      <Badge variant="outline">Not installed</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>
    </SettingsPane>
  );
}
