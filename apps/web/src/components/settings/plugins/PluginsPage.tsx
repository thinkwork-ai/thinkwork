import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@thinkwork/ui";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsMyPluginActivationsQuery,
  SettingsPluginCatalogQuery,
  SettingsRefreshPluginCatalogMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { installStateChipClassName, installStateLabel } from "./plugin-state";
import {
  isWorkosAccountConfigured,
  WORKOS_AUTH_PLUGIN_KEY,
  WORKOS_DASHBOARD_URL,
} from "./workos";

type PluginFilter = "all" | "installed";

const CATALOG_METADATA_TOOLTIP_DELAY_MS = 2_000;

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
  const [refreshCatalogState, refreshRemoteCatalog] = useMutation(
    SettingsRefreshPluginCatalogMutation,
  );

  const catalog = sortPluginEntriesByName(
    catalogResult.data?.pluginCatalog ?? [],
  );
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

  async function refreshTrustedCatalog() {
    const result = await refreshRemoteCatalog({});
    if (result.error) {
      toast.error(`Could not refresh plugin catalog: ${result.error.message}`);
      return;
    }
    toast.success("Plugin catalog refreshed.");
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
        actionKey={`catalog-refresh:${catalogMetadata ? catalogMetadataActionKey(catalogMetadata) : "metadata-pending"}:${refreshCatalogState.fetching ? "refreshing" : "idle"}:${showOperatorActions ? "operator" : "member"}`}
        actions={
          <CatalogRefreshAction
            metadata={catalogMetadata}
            refreshing={refreshCatalogState.fetching}
            showTrustedRefresh={showOperatorActions}
            onRefresh={() => {
              if (showOperatorActions) {
                void refreshTrustedCatalog();
              } else {
                refreshAll();
              }
            }}
          />
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
                Installed
              </ToggleGroupItem>
            </ToggleGroup>
          )
        }
      >
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
                  className="flex cursor-pointer items-start justify-between gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:ring-1 focus-visible:ring-ring"
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
                  <div className="flex shrink-0 items-start gap-2">
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

function CatalogRefreshAction({
  metadata,
  refreshing,
  showTrustedRefresh,
  onRefresh,
}: {
  metadata: CatalogMetadata | null;
  refreshing: boolean;
  showTrustedRefresh: boolean;
  onRefresh: () => void;
}) {
  const title = metadata
    ? `Plugin catalog metadata: ${metadataSummary(metadata)}`
    : "Refresh plugins";
  return (
    <TooltipProvider delayDuration={CATALOG_METADATA_TOOLTIP_DELAY_MS}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            aria-label={
              showTrustedRefresh ? "Refresh plugin catalog" : "Refresh plugins"
            }
            disabled={refreshing}
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="max-w-[18rem] border border-border bg-popover px-2.5 py-2 text-popover-foreground shadow-md"
          hideArrow
        >
          {metadata ? <CatalogMetadataDetails metadata={metadata} /> : title}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type CatalogMetadata = {
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

function CatalogMetadataDetails({ metadata }: { metadata: CatalogMetadata }) {
  const commit = metadata.commitSha?.slice(0, 12) ?? null;
  const digest = metadata.catalogSha256.replace(/^sha256:/, "").slice(0, 12);
  return (
    <div className="grid min-w-56 gap-1.5 text-xs leading-tight">
      <div className="grid gap-0.5">
        <p className="font-medium text-popover-foreground">Catalog metadata</p>
        <p className="text-muted-foreground">
          Generated {formatDateTime(metadata.generatedAt)}
          {metadata.fetchedAt
            ? ` · Fetched ${formatDateTime(metadata.fetchedAt)}`
            : ""}
        </p>
      </div>
      {metadata.stale ? <p className="text-amber-500">Stale fallback</p> : null}
      <MetadataLine label="Digest" value={digest} />
      {metadata.repository ? (
        <MetadataLine label="Repository" value={metadata.repository} />
      ) : null}
      {metadata.releaseTag ? (
        <MetadataLine label="Release" value={metadata.releaseTag} />
      ) : null}
      {metadata.assetName ? (
        <MetadataLine label="Asset" value={metadata.assetName} />
      ) : null}
      {metadata.ref ? <MetadataLine label="Ref" value={metadata.ref} /> : null}
      {commit ? <MetadataLine label="Commit" value={commit} /> : null}
      {metadata.lastRefreshStatus ? (
        <MetadataLine label="Status" value={metadata.lastRefreshStatus} />
      ) : null}
      {metadata.rateLimitRemaining ? (
        <MetadataLine
          label="GitHub remaining"
          value={metadata.rateLimitRemaining}
        />
      ) : null}
      {metadata.rateLimitReset ? (
        <MetadataLine
          label="GitHub reset"
          value={formatRateLimitReset(metadata.rateLimitReset)}
        />
      ) : null}
      {metadata.message ? (
        <p className="text-amber-500">{metadata.message}</p>
      ) : null}
    </div>
  );
}

function MetadataLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="truncate text-popover-foreground">
      <span className="text-muted-foreground">{label}</span>{" "}
      <span>{value}</span>
    </p>
  );
}

function metadataSummary(metadata: CatalogMetadata): string {
  const digest = metadata.catalogSha256.replace(/^sha256:/, "").slice(0, 12);
  const generated = formatDateTime(metadata.generatedAt);
  return `${metadata.stale ? "stale fallback" : sourceLabel(metadata.source)}, generated ${generated}, digest ${digest}`;
}

function catalogMetadataActionKey(metadata: CatalogMetadata): string {
  return [
    metadata.source,
    metadata.repository,
    metadata.ref,
    metadata.commitSha,
    metadata.releaseTag,
    metadata.assetName,
    metadata.catalogSha256,
    metadata.generatedAt,
    metadata.fetchedAt,
    metadata.stale ? "stale" : "fresh",
    metadata.lastRefreshStatus,
    metadata.message,
    metadata.rateLimitRemaining,
    metadata.rateLimitReset,
  ]
    .filter(Boolean)
    .join("|");
}

function sortPluginEntriesByName<
  T extends { displayName: string; pluginKey: string },
>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => {
    const byName = left.displayName.localeCompare(
      right.displayName,
      undefined,
      { sensitivity: "base" },
    );
    return byName === 0
      ? left.pluginKey.localeCompare(right.pluginKey)
      : byName;
  });
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

function formatRateLimitReset(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return formatDateTime(new Date(numeric * 1000).toISOString());
}

function pluginEntryIsAuthCapable(entry: {
  versions: Array<{ requiredOauthScopes?: readonly string[] | null }>;
}): boolean {
  return entry.versions.some(
    (version) => (version.requiredOauthScopes?.length ?? 0) > 0,
  );
}

function deployedLaunchUrl(entry: {
  pluginKey: string;
  install?: {
    state: string;
    components?: readonly {
      componentType: string;
      componentKey: string;
      state: string;
    }[];
  } | null;
  launchUrl?: string | null;
}): string | null {
  if (!entry.install || entry.install.state === "uninstalling") return null;
  // WorkOS has no deployed launchUrl; once its account is configured, link the
  // row to the WorkOS dashboard (mirrors the detail-header affordance).
  if (
    entry.pluginKey === WORKOS_AUTH_PLUGIN_KEY &&
    isWorkosAccountConfigured(entry.install.components)
  ) {
    return WORKOS_DASHBOARD_URL;
  }
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
