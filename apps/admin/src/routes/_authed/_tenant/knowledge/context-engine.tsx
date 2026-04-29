import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  ChevronDown,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  HardDrive,
  Loader2,
  Network,
  Settings2,
  Search,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listContextProviders,
  listContextTestAgents,
  queryContextEngine,
  updateContextProviderSetting,
  type ContextTestAgent,
  type ContextHit,
  type ContextProviderStatus,
  type ContextProviderSummary,
  type ContextQueryResult,
} from "@/lib/context-engine-api";
import { useTenant } from "@/context/TenantContext";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute(
  "/_authed/_tenant/knowledge/context-engine",
)({
  component: ContextEnginePage,
});

const FAMILY_ICONS = {
  memory: Database,
  wiki: Network,
  "knowledge-base": FileText,
  workspace: HardDrive,
  mcp: Search,
} as const;

const FAMILY_LABELS: Record<string, string> = {
  memory: "Memory",
  wiki: "Wiki",
  "knowledge-base": "Knowledge Base",
  workspace: "Workspace",
  mcp: "MCP",
};

function statusClasses(state: ContextProviderStatus["state"] | "available") {
  if (state === "ok" || state === "available") {
    return "bg-green-500/15 text-green-700 dark:text-green-400";
  }
  if (state === "skipped") return "bg-muted text-muted-foreground";
  if (state === "timeout") {
    return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
  }
  return "bg-destructive/15 text-destructive";
}

function StatusIcon({ state }: { state: ContextProviderStatus["state"] }) {
  if (state === "ok") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (state === "timeout") return <Clock className="h-3.5 w-3.5" />;
  if (state === "skipped") return <AlertCircle className="h-3.5 w-3.5" />;
  return <XCircle className="h-3.5 w-3.5" />;
}

type ResultDialog =
  | { type: "full"; result: ContextQueryResult }
  | { type: "hit"; hit: ContextHit }
  | {
      type: "provider";
      status: ContextProviderStatus;
      hits: ContextHit[];
    }
  | null;

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function defaultSelectedProviderIds(providers: ContextProviderSummary[]) {
  return providers
    .filter((provider) => provider.enabled !== false && provider.defaultEnabled)
    .map((provider) => provider.id);
}

function memoryModeForHit(hit: ContextHit) {
  const mode = hit.provenance?.metadata?.mode;
  return mode === "recall" || mode === "reflect" ? mode : null;
}

function memoryConfig(provider?: ContextProviderSummary | null) {
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

function sameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function MarkdownPreview({ children }: { children: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:my-2 prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:break-words prose-table:table-fixed prose-table:w-full">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

function ProviderStatusBadge({
  state,
}: {
  state: ContextProviderStatus["state"];
}) {
  return (
    <Badge
      variant="secondary"
      className={`gap-1 text-xs ${statusClasses(state)}`}
    >
      <StatusIcon state={state} />
      {state}
    </Badge>
  );
}

function ContextEnginePage() {
  const { tenantId } = useTenant();
  const [providers, setProviders] = useState<ContextProviderSummary[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [agents, setAgents] = useState<ContextTestAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("defaults");
  const [query, setQuery] = useState("");
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [memoryQueryMode, setMemoryQueryMode] = useState<"recall" | "reflect">(
    "reflect",
  );
  const [result, setResult] = useState<ContextQueryResult | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [resultDialog, setResultDialog] = useState<ResultDialog>(null);
  const [configProviderId, setConfigProviderId] = useState<string | null>(null);
  const [configEnabled, setConfigEnabled] = useState(true);
  const [configDefaultEnabled, setConfigDefaultEnabled] = useState(false);
  const [configMemoryMode, setConfigMemoryMode] = useState<
    "recall" | "reflect"
  >("reflect");
  const [configMemoryTimeout, setConfigMemoryTimeout] = useState("15000");
  const [configMemoryLegacy, setConfigMemoryLegacy] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProvidersLoading(true);
    listContextProviders()
      .then((next) => {
        if (!cancelled) {
          setProviders(next);
          setSelectedProviderIds((current) => {
            if (current.length > 0) return current;
            return defaultSelectedProviderIds(next);
          });
          const memoryProvider = next.find(
            (provider) => provider.id === "memory",
          );
          setMemoryQueryMode(memoryConfig(memoryProvider).queryMode);
          setProvidersError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setProvidersError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setAgentsLoading(true);
    listContextTestAgents(tenantId)
      .then((next) => {
        if (!cancelled) {
          setAgents(next);
          setAgentsError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAgentsError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const selectedProviders = useMemo(
    () =>
      selectedProviderIds
        .map((id) => providers.find((provider) => provider.id === id))
        .filter((provider): provider is ContextProviderSummary =>
          Boolean(provider),
        ),
    [providers, selectedProviderIds],
  );

  const memorySelected = selectedProviders.some(
    (provider) => provider.family === "memory",
  );
  const defaultProviderIds = useMemo(
    () => defaultSelectedProviderIds(providers),
    [providers],
  );
  const persistedMemoryConfig = useMemo(
    () => memoryConfig(providers.find((provider) => provider.id === "memory")),
    [providers],
  );
  const memoryModeMismatch = useMemo(() => {
    if (!result || !memorySelected) return null;
    const mismatched = result.hits.find((hit) => {
      if (hit.providerId !== "memory") return false;
      const mode = memoryModeForHit(hit);
      return mode !== null && mode !== memoryQueryMode;
    });
    if (!mismatched) return null;
    return memoryModeForHit(mismatched);
  }, [memoryQueryMode, memorySelected, result]);

  function setProviderSelected(providerId: string, checked: boolean) {
    setSelectedProviderIds((current) => {
      if (checked) {
        return current.includes(providerId)
          ? current
          : [...current, providerId];
      }
      return current.filter((id) => id !== providerId);
    });
  }

  function openProviderConfig(provider: ContextProviderSummary) {
    const config = memoryConfig(provider);
    setConfigProviderId(provider.id);
    setConfigEnabled(provider.enabled !== false);
    setConfigDefaultEnabled(provider.defaultEnabled);
    setConfigMemoryMode(config.queryMode);
    setConfigMemoryTimeout(String(config.timeoutMs));
    setConfigMemoryLegacy(config.includeLegacyBanks);
    setConfigError(null);
  }

  async function saveProviderConfig() {
    const provider = providers.find((item) => item.id === configProviderId);
    if (!provider) return;
    if (configDefaultEnabled && !configEnabled) {
      setConfigError("Disabled adapters cannot be tenant defaults.");
      return;
    }
    const timeoutMs = Math.max(
      500,
      Math.min(60_000, Math.floor(Number(configMemoryTimeout) || 15_000)),
    );
    const config =
      provider.family === "memory"
        ? {
            queryMode: configMemoryMode,
            timeoutMs,
            includeLegacyBanks: configMemoryLegacy,
          }
        : {};
    setConfigSaving(true);
    setConfigError(null);
    try {
      const saved = await updateContextProviderSetting({
        providerId: provider.id,
        enabled: configEnabled,
        defaultEnabled: configDefaultEnabled,
        config,
      });
      setProviders((current) =>
        current.map((item) =>
          item.id === provider.id
            ? {
                ...item,
                ...saved,
                displayName: item.displayName,
                family: item.family,
              }
            : item,
        ),
      );
      if (provider.id === "memory")
        setMemoryQueryMode(memoryConfig(saved).queryMode);
      if (!saved.enabled) {
        setSelectedProviderIds((current) =>
          current.filter((id) => id !== saved.id),
        );
      }
      setConfigProviderId(null);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfigSaving(false);
    }
  }

  async function runQuery() {
    const clean = query.trim();
    if (!clean) return;
    setQueryLoading(true);
    setQueryError(null);
    try {
      setResult(
        await queryContextEngine(clean, {
          providerIds: sameIds(selectedProviderIds, defaultProviderIds)
            ? undefined
            : selectedProviderIds,
          memoryQueryMode: memorySelected ? memoryQueryMode : undefined,
          memoryIncludeLegacyBanks: memorySelected
            ? persistedMemoryConfig.includeLegacyBanks
            : undefined,
          agentId: selectedAgentId === "defaults" ? undefined : selectedAgentId,
        }),
      );
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueryLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <CardTitle className="text-sm xl:w-28 xl:shrink-0">
              Test query
            </CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={providersLoading || providers.length === 0}
                    className="flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm font-normal whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50 sm:w-44 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                  >
                    <span className="min-w-0 truncate">Adapters</span>
                    <span className="flex items-center gap-1.5">
                      <Badge
                        variant="secondary"
                        className="h-5 px-1.5 text-[11px]"
                      >
                        {selectedProviderIds.length}
                      </Badge>
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuLabel>Context adapters</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {providers.map((provider) => {
                    const Icon =
                      FAMILY_ICONS[
                        provider.family as keyof typeof FAMILY_ICONS
                      ] ?? Search;
                    return (
                      <DropdownMenuCheckboxItem
                        key={provider.id}
                        checked={selectedProviderIds.includes(provider.id)}
                        disabled={provider.enabled === false}
                        onCheckedChange={(checked) =>
                          setProviderSelected(provider.id, Boolean(checked))
                        }
                        onSelect={(event) => event.preventDefault()}
                        className="gap-2"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {provider.displayName}
                        </span>
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setSelectedProviderIds(defaultProviderIds);
                    }}
                  >
                    Reset defaults
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setSelectedProviderIds([]);
                    }}
                  >
                    Clear selection
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Select
                value={selectedAgentId}
                onValueChange={setSelectedAgentId}
              >
                <SelectTrigger
                  aria-label="Workspace target"
                  className="w-full shrink-0 sm:w-56"
                >
                  <SelectValue placeholder="Tenant defaults" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="defaults">Tenant defaults</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {memorySelected && (
                <Select
                  value={memoryQueryMode}
                  onValueChange={(value) =>
                    setMemoryQueryMode(value as "recall" | "reflect")
                  }
                >
                  <SelectTrigger
                    aria-label="Hindsight strategy"
                    className="w-full shrink-0 sm:w-36"
                  >
                    <SelectValue placeholder="Hindsight" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recall">recall</SelectItem>
                    <SelectItem value="reflect">reflect</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Search memory, wiki, knowledge bases, files, and approved MCP tools..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && runQuery()}
              className="min-w-0 flex-1"
            />
            <Button
              onClick={runQuery}
              disabled={
                queryLoading ||
                !query.trim() ||
                selectedProviderIds.length === 0
              }
            >
              {queryLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Test
            </Button>
          </div>
          {(agentsLoading || agentsError) && (
            <p className="text-xs text-muted-foreground">
              {agentsLoading
                ? "Loading agents..."
                : `Agent list unavailable: ${agentsError}`}
            </p>
          )}
          {queryError && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" />
              {queryError}
            </p>
          )}
          {memoryModeMismatch && (
            <p className="flex items-center gap-1.5 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
              <AlertCircle className="h-3.5 w-3.5" />
              Requested Hindsight {memoryQueryMode}, but the API returned{" "}
              {memoryModeMismatch}. Deploy the Context Engine provider-options
              handler before trusting this test result.
            </p>
          )}
          {result && (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="rounded-md border">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Top hits
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setResultDialog({ type: "full", result })}
                  >
                    View full result
                  </Button>
                </div>
                {result.hits.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No matching context found.
                  </p>
                ) : (
                  <div className="divide-y">
                    {result.hits.slice(0, 5).map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className="block w-full space-y-1 px-3 py-2 text-left hover:bg-muted/40"
                        onClick={() => setResultDialog({ type: "hit", hit })}
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="font-mono text-[11px]"
                          >
                            {FAMILY_LABELS[hit.family] ?? hit.family}
                          </Badge>
                          <p className="truncate text-sm font-medium">
                            {hit.title}
                          </p>
                        </div>
                        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {hit.snippet}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-md border">
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  Provider status
                </div>
                <div className="divide-y">
                  {result.providers.map((status) => (
                    <button
                      key={status.providerId}
                      type="button"
                      className="block w-full space-y-1 px-3 py-2 text-left hover:bg-muted/40"
                      onClick={() =>
                        setResultDialog({
                          type: "provider",
                          status,
                          hits: result.hits.filter(
                            (hit) => hit.providerId === status.providerId,
                          ),
                        })
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm">
                          {status.displayName}
                        </span>
                        <ProviderStatusBadge state={status.state} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {status.hitCount ?? 0} hits
                        {status.durationMs != null
                          ? ` · ${status.durationMs.toLocaleString()} ms`
                          : ""}
                      </p>
                      {(status.error || status.reason) && (
                        <p className="text-xs text-muted-foreground">
                          {status.error || status.reason}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {providersError && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5" />
          {providersError}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {providersLoading ? (
          <Card size="sm">
            <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading providers...
            </CardContent>
          </Card>
        ) : (
          providers.map((provider) => {
            const Icon =
              FAMILY_ICONS[provider.family as keyof typeof FAMILY_ICONS] ??
              Search;
            return (
              <Card key={provider.id} size="sm">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <CardTitle className="truncate text-sm">
                        {provider.displayName}
                      </CardTitle>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`shrink-0 text-xs ${statusClasses("available")}`}
                    >
                      {provider.enabled === false ? "disabled" : "available"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {provider.family}
                    </Badge>
                    <Badge variant="secondary" className="text-[11px]">
                      {provider.defaultEnabled ? "default" : "opt-in"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {provider.family === "memory"
                      ? `Hindsight ${memoryConfig(provider).queryMode}, ${memoryConfig(provider).timeoutMs.toLocaleString()} ms`
                      : provider.family === "workspace"
                        ? "Requires an agent, template, or defaults workspace target."
                        : provider.family === "knowledge-base"
                          ? "Runs against tenant and agent-linked Bedrock Knowledge Bases."
                          : provider.family === "mcp"
                            ? "Approved at the individual read-only/search-safe tool level."
                            : "Fast compiled-wiki lookup remains separate from raw Wiki inspection."}
                  </p>
                  {provider.lastTestState && (
                    <p className="text-xs text-muted-foreground">
                      Last test: {provider.lastTestState}
                      {provider.lastTestLatencyMs != null
                        ? ` · ${provider.lastTestLatencyMs.toLocaleString()} ms`
                        : ""}
                    </p>
                  )}
                  {provider.family !== "mcp" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      onClick={() => openProviderConfig(provider)}
                    >
                      <Settings2 className="h-4 w-4" />
                      Configure
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Dialog
        open={Boolean(resultDialog)}
        onOpenChange={(open) => !open && setResultDialog(null)}
      >
        <DialogContent className="max-h-[80vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {resultDialog?.type === "full"
                ? "Full Context Result"
                : resultDialog?.type === "hit"
                  ? resultDialog.hit.title
                  : resultDialog?.type === "provider"
                    ? resultDialog.status.displayName
                    : "Context Result"}
            </DialogTitle>
            <DialogDescription>
              {resultDialog?.type === "full"
                ? "Complete structured response returned by query_context."
                : resultDialog?.type === "hit"
                  ? `${FAMILY_LABELS[resultDialog.hit.family] ?? resultDialog.hit.family} hit`
                  : resultDialog?.type === "provider"
                    ? "Adapter status and hits from this test run."
                    : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[60vh] space-y-3">
            {resultDialog?.type === "hit" && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {FAMILY_LABELS[resultDialog.hit.family] ??
                      resultDialog.hit.family}
                  </Badge>
                  {resultDialog.hit.score != null && (
                    <span className="text-xs text-muted-foreground">
                      score {resultDialog.hit.score.toFixed(3)}
                    </span>
                  )}
                  {resultDialog.hit.rank != null && (
                    <span className="text-xs text-muted-foreground">
                      rank {resultDialog.hit.rank}
                    </span>
                  )}
                </div>
                <MarkdownPreview>{resultDialog.hit.snippet}</MarkdownPreview>
              </div>
            )}
            {resultDialog?.type === "full" && (
              <div className="space-y-3">
                {resultDialog.result.answer?.text && (
                  <div className="rounded-md border p-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Answer
                    </p>
                    <MarkdownPreview>
                      {resultDialog.result.answer.text}
                    </MarkdownPreview>
                  </div>
                )}
                <div className="rounded-md border">
                  <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                    Provider status
                  </div>
                  <div className="divide-y">
                    {resultDialog.result.providers.map((status) => (
                      <div
                        key={status.providerId}
                        className="flex items-start justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {status.displayName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {status.hitCount ?? 0} hits
                            {status.durationMs != null
                              ? ` · ${status.durationMs.toLocaleString()} ms`
                              : ""}
                          </p>
                          {(status.error || status.reason) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {status.error || status.reason}
                            </p>
                          )}
                        </div>
                        <ProviderStatusBadge state={status.state} />
                      </div>
                    ))}
                  </div>
                </div>
                {resultDialog.result.hits.length > 0 && (
                  <div className="rounded-md border">
                    <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                      Top hits
                    </div>
                    <div className="divide-y">
                      {resultDialog.result.hits.map((hit) => (
                        <div key={hit.id} className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {FAMILY_LABELS[hit.family] ?? hit.family}
                            </Badge>
                            <p className="truncate text-sm font-medium">
                              {hit.title}
                            </p>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            <MarkdownPreview>{hit.snippet}</MarkdownPreview>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {resultDialog?.type === "provider" && (
              <div className="space-y-3">
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <ProviderStatusBadge state={resultDialog.status.state} />
                    <span className="text-xs text-muted-foreground">
                      {resultDialog.status.hitCount ?? 0} hits
                      {resultDialog.status.durationMs != null
                        ? ` · ${resultDialog.status.durationMs.toLocaleString()} ms`
                        : ""}
                    </span>
                  </div>
                  {(resultDialog.status.error ||
                    resultDialog.status.reason) && (
                    <p className="text-sm text-muted-foreground">
                      {resultDialog.status.error || resultDialog.status.reason}
                    </p>
                  )}
                </div>
                {resultDialog.hits.length > 0 && (
                  <div className="space-y-2">
                    {resultDialog.hits.map((hit) => (
                      <div key={hit.id} className="rounded-md border p-3">
                        <p className="text-sm font-medium">{hit.title}</p>
                        <div className="mt-1 text-muted-foreground">
                          <MarkdownPreview>{hit.snippet}</MarkdownPreview>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {resultDialog && (
              <pre className="overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
                {formatJson(
                  resultDialog.type === "full"
                    ? resultDialog.result
                    : resultDialog.type === "hit"
                      ? resultDialog.hit
                      : {
                          status: resultDialog.status,
                          hits: resultDialog.hits,
                        },
                )}
              </pre>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(configProviderId)}
        onOpenChange={(open) => !open && setConfigProviderId(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {providers.find((provider) => provider.id === configProviderId)
                ?.displayName ?? "Adapter Configuration"}
            </DialogTitle>
            <DialogDescription>
              Tenant policy controls which built-in adapters are eligible and
              which adapters run by default.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor="adapter-enabled">Eligible</Label>
                <p className="text-xs text-muted-foreground">
                  Disabled adapters cannot be selected by templates or tests.
                </p>
              </div>
              <Switch
                id="adapter-enabled"
                checked={configEnabled}
                onCheckedChange={(checked) => {
                  setConfigEnabled(checked);
                  if (!checked) setConfigDefaultEnabled(false);
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor="adapter-default">Tenant default</Label>
                <p className="text-xs text-muted-foreground">
                  Default adapters run when a query does not name providers.
                </p>
              </div>
              <Switch
                id="adapter-default"
                checked={configDefaultEnabled}
                disabled={!configEnabled}
                onCheckedChange={setConfigDefaultEnabled}
              />
            </div>
            {providers.find((provider) => provider.id === configProviderId)
              ?.family === "memory" && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1">
                  <Label>Hindsight strategy</Label>
                  <Select
                    value={configMemoryMode}
                    onValueChange={(value) =>
                      setConfigMemoryMode(value as "recall" | "reflect")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recall">recall</SelectItem>
                      <SelectItem value="reflect">reflect</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="memory-timeout">Timeout budget (ms)</Label>
                  <Input
                    id="memory-timeout"
                    inputMode="numeric"
                    value={configMemoryTimeout}
                    onChange={(event) =>
                      setConfigMemoryTimeout(event.target.value)
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="memory-legacy-banks">
                      Include historical banks
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Expands Hindsight recall beyond the primary user bank.
                    </p>
                  </div>
                  <Switch
                    id="memory-legacy-banks"
                    checked={configMemoryLegacy}
                    onCheckedChange={setConfigMemoryLegacy}
                  />
                </div>
              </div>
            )}
            {configError && (
              <p className="text-xs text-destructive">{configError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfigProviderId(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={saveProviderConfig}
                disabled={configSaving}
              >
                {configSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Settings2 className="h-4 w-4" />
                )}
                Save
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
