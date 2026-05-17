import type {
  ContextHit,
  ContextProviderStatus,
  ContextProviderSummary,
} from "@/lib/context-engine-api";

export const WEB_SEARCH_PROVIDER_ID = "builtin:web-search";
export const WEB_SEARCH_TOOL_SLUG = "web-search";
export const WEB_SEARCH_PROVIDER_PENDING_KEY = "contextProviderPending";

export type ProviderBadgeState =
  | ContextProviderStatus["state"]
  | "available"
  | "disabled"
  | "live";

export type ContextSourceRow = {
  id: string;
  provider: ContextProviderSummary;
  sourceKey: string;
  familyLabel: string;
  description: string;
  badge: {
    label: string;
    state: ProviderBadgeState;
  };
  selectable: boolean;
  configurable: boolean;
  lastTestSummary: string | null;
};

export const FAMILY_LABELS: Record<string, string> = {
  memory: "Memory",
  brain: "Brain",
  wiki: "Pages",
  "knowledge-base": "Knowledge Base",
  workspace: "Workspace",
  mcp: "MCP",
  web: "Web",
  "sub-agent": "Sub-agent",
};

export function memoryConfig(provider?: ContextProviderSummary | null) {
  const config = provider?.config ?? {};
  return {
    queryMode:
      config.queryMode === "recall" || config.queryMode === "reflect"
        ? config.queryMode
        : "reflect",
    timeoutMs:
      typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs)
        ? config.timeoutMs
        : 15_000,
    includeLegacyBanks: config.includeLegacyBanks === true,
  };
}

export function providerSourceKey(
  provider: Pick<ContextProviderSummary, "family" | "sourceFamily">,
) {
  return provider.sourceFamily ?? provider.family;
}

export function resultSourceKey(
  item: Pick<ContextHit | ContextProviderStatus, "family" | "sourceFamily">,
) {
  return item.sourceFamily ?? item.family;
}

export function isPendingWebSearchProvider(provider: ContextProviderSummary) {
  return (
    provider.id === WEB_SEARCH_PROVIDER_ID &&
    provider.config?.[WEB_SEARCH_PROVIDER_PENDING_KEY] === true
  );
}

export function isPlannedSourceAgentProvider(provider: ContextProviderSummary) {
  return (
    provider.family === "sub-agent" && provider.subAgent?.seamState !== "live"
  );
}

export function visibleContextProviders(providers: ContextProviderSummary[]) {
  return providers.filter(
    (provider) => !isPlannedSourceAgentProvider(provider),
  );
}

export function providerSelectable(provider: ContextProviderSummary) {
  return (
    !isPlannedSourceAgentProvider(provider) &&
    provider.enabled !== false &&
    !isPendingWebSearchProvider(provider)
  );
}

export function providerBadge(provider: ContextProviderSummary): {
  label: string;
  state: ProviderBadgeState;
} {
  if (isPendingWebSearchProvider(provider)) {
    return provider.enabled === false
      ? { label: "disabled", state: "disabled" }
      : { label: "waiting on API", state: "stale" };
  }
  if (provider.enabled === false)
    return { label: "disabled", state: "disabled" };
  if (provider.family === "sub-agent") {
    return { label: "live", state: "live" };
  }
  return { label: "available", state: "available" };
}

export function providerDescription(provider: ContextProviderSummary) {
  if (provider.id === WEB_SEARCH_PROVIDER_ID) {
    if (isPendingWebSearchProvider(provider)) {
      return "Exa Research is enabled under Built-in Tools, but this API has not returned its Context Engine adapter yet.";
    }
    return "Runs external research through the tenant-configured Exa Web Search built-in.";
  }
  if (provider.family === "memory") {
    const config = memoryConfig(provider);
    return `Hindsight ${config.queryMode}, ${config.timeoutMs.toLocaleString()} ms`;
  }
  if (provider.family === "brain") {
    return "Tenant-shared ontology-shaped Brain pages, facets, relationships, and citations.";
  }
  if (provider.family === "workspace") {
    return "Requires an agent, template, or defaults workspace target.";
  }
  if (provider.family === "knowledge-base") {
    return "Runs against tenant and agent-linked Bedrock Knowledge Bases.";
  }
  if (provider.family === "mcp") {
    return "Approved at the individual read-only/search-safe tool level.";
  }
  if (provider.family === "sub-agent") {
    return "Searches compiled Company Brain pages with typo-tolerant hybrid retrieval.";
  }
  return "Fast compiled page lookup remains separate from raw page inspection.";
}

export function defaultSelectedProviderIds(
  providers: ContextProviderSummary[],
) {
  return visibleContextProviders(providers)
    .filter(
      (provider) => providerSelectable(provider) && provider.defaultEnabled,
    )
    .map((provider) => provider.id);
}

export function backendDefaultProviderIds(providers: ContextProviderSummary[]) {
  return providers
    .filter(
      (provider) =>
        provider.enabled !== false &&
        !isPendingWebSearchProvider(provider) &&
        provider.defaultEnabled,
    )
    .map((provider) => provider.id);
}

export function sameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

export function providerIdsForQuery(args: {
  selectedProviderIds: string[];
  visibleDefaultProviderIds: string[];
  backendDefaultProviderIds: string[];
}) {
  const selectedMatchesVisibleDefaults = sameIds(
    args.selectedProviderIds,
    args.visibleDefaultProviderIds,
  );
  const backendMatchesVisibleDefaults = sameIds(
    args.backendDefaultProviderIds,
    args.visibleDefaultProviderIds,
  );

  return selectedMatchesVisibleDefaults && backendMatchesVisibleDefaults
    ? undefined
    : args.selectedProviderIds;
}

export function contextSourceRows(
  providers: ContextProviderSummary[],
): ContextSourceRow[] {
  return visibleContextProviders(providers).map((provider) => ({
    id: provider.id,
    provider,
    sourceKey: providerSourceKey(provider),
    familyLabel:
      FAMILY_LABELS[providerSourceKey(provider)] ?? providerSourceKey(provider),
    description: providerDescription(provider),
    badge: providerBadge(provider),
    selectable: providerSelectable(provider),
    configurable:
      provider.family !== "mcp" && !isPlannedSourceAgentProvider(provider),
    lastTestSummary: formatLastTestSummary(provider),
  }));
}

export function formatLastTestSummary(provider: ContextProviderSummary) {
  if (!provider.lastTestState) return null;
  return [
    `Last test: ${provider.lastTestState}`,
    provider.lastTestLatencyMs != null
      ? `${provider.lastTestLatencyMs.toLocaleString()} ms`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
