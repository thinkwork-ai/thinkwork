import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button } from "@thinkwork/ui";
import { ArrowDownToLine, RefreshCw } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsInstallPluginMutation,
  SettingsPluginCatalogQuery,
  SettingsPluginInstallsQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { installStateChipClassName, installStateLabel } from "./plugin-state";

/**
 * Plugins settings surface (plan 2026-06-12-001 U8): catalog browse with
 * install state overlay, plus the tenant's installed plugins. Reachable by
 * all members (Connect lives on the detail page); install actions render
 * only for operators.
 */
export function PluginsPage() {
  const { isOperator, roleResolved } = useTenant();
  const showOperatorActions = roleResolved && isOperator;

  const [catalogResult, refreshCatalog] = useQuery({
    query: SettingsPluginCatalogQuery,
    requestPolicy: "cache-and-network",
  });
  const [installsResult, refreshInstalls] = useQuery({
    query: SettingsPluginInstallsQuery,
    requestPolicy: "cache-and-network",
  });
  const [installState, installPlugin] = useMutation(
    SettingsInstallPluginMutation,
  );

  const catalog = catalogResult.data?.pluginCatalog ?? [];
  const installs = installsResult.data?.pluginInstalls ?? [];
  const catalogUnavailable = Boolean(catalogResult.error);
  const catalogLoading = catalogResult.fetching && catalog.length === 0;
  const installsLoading = installsResult.fetching && installs.length === 0;

  function refreshAll() {
    refreshCatalog({ requestPolicy: "network-only" });
    refreshInstalls({ requestPolicy: "network-only" });
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
    refreshInstalls({ requestPolicy: "network-only" });
    refreshCatalog({ requestPolicy: "network-only" });
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

      <SettingsSection label="Installed">
        {installsLoading ? (
          <div className="p-4 text-sm text-muted-foreground">
            Loading installed plugins...
          </div>
        ) : installsResult.error ? (
          <div className="p-4 text-sm text-muted-foreground">
            Installed plugins are unavailable right now.
          </div>
        ) : installs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No plugins are installed for this workspace.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {installs.map((install) => {
              const entry = catalog.find(
                (candidate) => candidate.pluginKey === install.pluginKey,
              );
              return (
                <Link
                  key={install.id}
                  to="/settings/plugins/$pluginKey"
                  params={{ pluginKey: install.pluginKey }}
                  aria-label={`Open ${entry?.displayName ?? install.pluginKey}`}
                  className="flex items-center justify-between gap-3 px-4 py-3.5 outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {entry?.displayName ?? install.pluginKey}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      v{install.pinnedVersion}
                      {install.lastError ? ` — ${install.lastError}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {entry?.updateAvailable ? (
                      <Badge
                        variant="outline"
                        className="border-sky-500/40 text-sky-400"
                      >
                        Update available
                      </Badge>
                    ) : null}
                    <Badge
                      variant="outline"
                      className={installStateChipClassName(install.state)}
                    >
                      {installStateLabel(install.state)}
                    </Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </SettingsSection>

      <SettingsSection label="Catalog">
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
        ) : (
          <div className="divide-y divide-border">
            {catalog.map((entry) => (
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
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPane>
  );
}
