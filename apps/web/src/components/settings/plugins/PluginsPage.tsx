import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button, ToggleGroup, ToggleGroupItem } from "@thinkwork/ui";
import { ArrowDownToLine, ExternalLink, RefreshCw } from "lucide-react";
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
  const navigate = useNavigate();
  const { isOperator, roleResolved } = useTenant();
  const showOperatorActions = roleResolved && isOperator;
  const selfServiceOnly = roleResolved && !isOperator;
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
  const catalogMetadata = catalogResult.data?.pluginCatalogMetadata ?? null;
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
  const visible = selfServiceOnly
    ? catalog.filter(
        (entry) => Boolean(entry.install) && pluginEntryIsAuthCapable(entry),
      )
    : filter === "installed"
      ? catalog.filter((entry) => entry.install)
      : catalog;

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

  function openPlugin(pluginKey: string) {
    void navigate({
      to: "/settings/plugins/$pluginKey",
      params: { pluginKey },
    });
  }

  return (
    <SettingsPane className="max-w-none">
      <SettingsHeader
        title="Plugins"
        description={
          selfServiceOnly
            ? "Connect installed plugins to your account."
            : "Install applications from the plugin catalog and connect them to your account."
        }
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
        label={selfServiceOnly ? "Installed plugins" : "Catalog"}
        action={
          selfServiceOnly ? null : (
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
          )
        }
      >
        {catalogMetadata && !catalogUnavailable ? (
          <CatalogMetadataStrip metadata={catalogMetadata} />
        ) : null}
        {!roleResolved ? (
          <div className="p-4 text-sm text-muted-foreground">
            Loading plugins...
          </div>
        ) : catalogUnavailable ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              {selfServiceOnly
                ? "Plugin connection data is currently unavailable."
                : "Plugin catalog is currently unavailable. Installed plugins remain active."}
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
            {selfServiceOnly
              ? "No installed plugins are available to connect yet."
              : "No plugins are installed for this workspace."}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((entry) => {
              const needsReauth =
                Boolean(entry.install) && needsReauthKeys.has(entry.pluginKey);
              const activationStatus = activationStatusFor(
                entry.install?.id,
                entry.pluginKey,
                activations,
              );
              const launchUrl = deployedLaunchUrl(entry);
              return (
                <div
                  key={entry.pluginKey}
                  role="link"
                  tabIndex={0}
                  aria-label={`Open ${entry.displayName}`}
                  onClick={() => openPlugin(entry.pluginKey)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openPlugin(entry.pluginKey);
                    }
                  }}
                  className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-foreground">
                        {entry.displayName}
                      </p>
                      {launchUrl ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Open ${entry.displayName} application`}
                          title={`Open ${entry.displayName} application`}
                          onClick={(event) => {
                            event.stopPropagation();
                            window.open(
                              launchUrl,
                              "_blank",
                              "noopener,noreferrer",
                            );
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <ExternalLink className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {catalogListDescription(entry)}
                    </p>
                    {!selfServiceOnly ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {entry.install
                            ? `Installed v${entry.install.pinnedVersion} · Latest v${entry.latestVersion}`
                            : `Latest v${entry.latestVersion}`}{" "}
                          · {entry.versions.length}{" "}
                          {entry.versions.length === 1 ? "version" : "versions"}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {entry.install && selfServiceOnly ? (
                      <Badge
                        variant={
                          activationStatus === "active"
                            ? "outline"
                            : "secondary"
                        }
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
                    ) : entry.install ? (
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
                      entry.premium?.installKeyRequired ? (
                        <Badge variant="outline">Not installed</Badge>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={installState.fetching}
                          onClick={(event) => {
                            event.stopPropagation();
                            void install(entry.pluginKey);
                          }}
                        >
                          <ArrowDownToLine className="mr-2 size-4" />
                          Install
                        </Button>
                      )
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

function CatalogMetadataStrip({
  metadata,
}: {
  metadata: {
    source: string;
    repository?: string | null;
    ref?: string | null;
    commitSha?: string | null;
    releaseTag?: string | null;
    assetName?: string | null;
    catalogSha256: string;
    generatedAt: string;
    fetchedAt?: string | null;
    stale: boolean;
    lastRefreshStatus?: string | null;
    message?: string | null;
    rateLimitRemaining?: string | null;
    rateLimitReset?: string | null;
  };
}) {
  const commit = metadata.commitSha?.slice(0, 12) ?? null;
  const digest = metadata.catalogSha256.replace(/^sha256:/, "").slice(0, 12);
  const channel =
    metadata.repository && metadata.releaseTag
      ? `${metadata.repository} · ${metadata.releaseTag}`
      : metadata.repository || sourceLabel(metadata.source);

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              Catalog source
            </p>
            <Badge
              variant="outline"
              className={
                metadata.stale
                  ? "border-amber-500/40 text-amber-500"
                  : metadata.source.startsWith("github")
                    ? "border-emerald-500/40 text-emerald-500"
                    : undefined
              }
            >
              {metadata.stale ? "Stale fallback" : sourceLabel(metadata.source)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {channel}
            {commit ? ` · ${commit}` : ""}
            {metadata.ref ? ` · ${metadata.ref}` : ""}
          </p>
          {metadata.message ? (
            <p className="mt-1 text-sm text-amber-500">{metadata.message}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground md:justify-end">
          <span>Generated {formatDateTime(metadata.generatedAt)}</span>
          {metadata.fetchedAt ? (
            <span>Fetched {formatDateTime(metadata.fetchedAt)}</span>
          ) : null}
          <span>Digest {digest}</span>
          {metadata.rateLimitRemaining ? (
            <span>GitHub remaining {metadata.rateLimitRemaining}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function catalogListDescription(entry: {
  pluginKey: string;
  description: string;
}): string {
  if (entry.pluginKey === "company-brain") {
    return entry.description.replace(/^Premium\s+/i, "");
  }
  return entry.description;
}

function sourceLabel(source: string): string {
  switch (source) {
    case "github-release":
      return "GitHub-backed";
    case "github-release-stale":
      return "GitHub stale fallback";
    case "bundled-signed":
      return "Bundled signed";
    case "bundled-unsigned":
      return "Bundled unsigned";
    default:
      return source;
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function pluginEntryIsAuthCapable(entry: {
  versions: Array<{ requiredOauthScopes?: readonly string[] | null }>;
}): boolean {
  return entry.versions.some(
    (version) => (version.requiredOauthScopes?.length ?? 0) > 0,
  );
}

function deployedLaunchUrl(entry: {
  install?: { state: string } | null;
  launchUrl?: string | null;
}): string | null {
  if (!entry.install || entry.install.state === "uninstalling") return null;
  return entry.launchUrl || null;
}

function activationStatusFor(
  installId: string | undefined,
  pluginKey: string,
  activations: Array<{
    pluginInstallId: string;
    pluginKey: string;
    status: string;
  }>,
): string | null {
  const activation = activations.find(
    (candidate) =>
      candidate.status !== "revoked" &&
      ((installId && candidate.pluginInstallId === installId) ||
        candidate.pluginKey === pluginKey),
  );
  return activation?.status ?? null;
}
