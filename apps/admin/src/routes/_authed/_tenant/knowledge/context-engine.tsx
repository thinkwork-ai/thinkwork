import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
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
  Bot,
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
import { listBuiltinTools, type BuiltinTool } from "@/lib/builtin-tools-api";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FAMILY_LABELS,
  WEB_SEARCH_PROVIDER_ID,
  WEB_SEARCH_PROVIDER_PENDING_KEY,
  WEB_SEARCH_TOOL_SLUG,
  backendDefaultProviderIds as getBackendDefaultProviderIds,
  contextSourceRows,
  defaultSelectedProviderIds,
  isPendingWebSearchProvider,
  memoryConfig,
  providerIdsForQuery,
  providerSelectable,
  providerSourceKey,
  resultSourceKey,
  visibleContextProviders,
  type ContextSourceRow,
  type ProviderBadgeState,
} from "./-context-engine-sources";

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
  web: Search,
  "sub-agent": Bot,
} as const;

type SourceAgentTraceStep = {
  id?: string;
  type?: string;
  turn?: number;
  status?: string;
  summary?: string;
  tool?: string;
  toolCallId?: string;
  durationMs?: number;
};

function statusClasses(state: ProviderBadgeState) {
  if (state === "ok" || state === "available" || state === "live") {
    return "bg-green-500/15 text-green-700 dark:text-green-400";
  }
  if (state === "skipped" || state === "disabled") {
    return "bg-muted text-muted-foreground";
  }
  if (state === "stale") {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  }
  if (state === "timeout") {
    return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
  }
  return "bg-destructive/15 text-destructive";
}

function withBuiltinWebSearchFallback(
  providers: ContextProviderSummary[],
  builtinTools: BuiltinTool[],
) {
  if (providers.some((provider) => provider.id === WEB_SEARCH_PROVIDER_ID)) {
    return providers;
  }
  const webSearchTool = builtinTools.find(
    (tool) => tool.toolSlug === WEB_SEARCH_TOOL_SLUG,
  );
  if (!webSearchTool) return providers;
  const provider: ContextProviderSummary = {
    id: WEB_SEARCH_PROVIDER_ID,
    family: "mcp",
    sourceFamily: "web",
    displayName:
      webSearchTool.provider === "exa" ? "Exa Research" : "Web Search",
    enabled: webSearchTool.enabled,
    defaultEnabled: false,
    config: {
      toolSlug: webSearchTool.toolSlug,
      provider: webSearchTool.provider,
      enabledInBuiltins: webSearchTool.enabled,
      hasSecret: webSearchTool.hasSecret,
      [WEB_SEARCH_PROVIDER_PENDING_KEY]: true,
    },
    lastTestedAt: webSearchTool.lastTestedAt ?? null,
  };
  return [...providers, provider];
}

function SubAgentConfigDetails({
  provider,
}: {
  provider: ContextProviderSummary;
}) {
  const subAgent = provider.subAgent;
  if (!subAgent) return null;
  const status = subAgent.seamState === "live" ? "Live" : "Planned";
  const resources = subAgent.resources ?? [];
  const skills = subAgent.skills ?? [];

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Source agent anatomy</p>
          <p className="text-xs text-muted-foreground">
            Prompt, resources, skills, and tool surface for this Company Brain
            adapter.
          </p>
        </div>
        <Badge
          variant="secondary"
          className={
            subAgent.seamState === "live"
              ? "bg-green-500/15 text-green-700 dark:text-green-400"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          }
        >
          {status}
        </Badge>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <ConfigFact
          label="Process"
          value={formatSubAgentProcessModel(subAgent.processModel)}
        />
        <ConfigFact label="Depth cap" value={String(subAgent.depthCap)} />
        <ConfigFact label="Prompt ref" value={subAgent.promptRef} />
        <ConfigFact label="Provider id" value={provider.id} />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Prompt</p>
        <div className="rounded-md bg-muted/40 p-2">
          <p className="text-sm font-medium">
            {subAgent.prompt?.title ?? subAgent.promptRef}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {subAgent.prompt?.summary ??
              "Prompt details have not been declared."}
          </p>
          {(subAgent.prompt?.instructions?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {subAgent.prompt?.instructions?.map((instruction) => (
                <li key={instruction}>- {instruction}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfigList
        title="Resources"
        empty="No resources declared."
        items={resources.map((resource) => ({
          id: resource.id,
          title: resource.label,
          subtitle: resource.description,
          badges: [resource.type, resource.access],
        }))}
      />
      <ConfigList
        title="Skills"
        empty="No skills declared."
        items={skills.map((skill) => ({
          id: skill.id,
          title: skill.label,
          subtitle: skill.description,
        }))}
      />
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Tools</p>
        <div className="flex flex-wrap gap-1.5">
          {subAgent.toolAllowlist.map((tool) => (
            <Badge
              key={tool}
              variant="outline"
              className="font-mono text-[11px]"
            >
              {tool}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatSubAgentProcessModel(processModel: string): string {
  switch (processModel) {
    case "deterministic-retrieval":
      return "Deterministic retrieval seam";
    case "lambda-bedrock-converse":
      return "Bedrock source-agent loop";
    case "agentcore":
      return "AgentCore runtime";
    default:
      return processModel;
  }
}

function ConfigFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-xs">{value}</p>
    </div>
  );
}

function ConfigList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{
    id: string;
    title: string;
    subtitle: string;
    badges?: string[];
  }>;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-md bg-muted/40 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-medium">{item.title}</p>
                {item.badges?.map((badge) => (
                  <Badge
                    key={badge}
                    variant="outline"
                    className="font-mono text-[10px]"
                  >
                    {badge}
                  </Badge>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.subtitle}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function sourceAgentTrace(
  status: ContextProviderStatus,
): SourceAgentTraceStep[] {
  const sourceAgent = status.metadata?.sourceAgent;
  if (!sourceAgent || typeof sourceAgent !== "object") return [];
  const trace = (sourceAgent as { trace?: unknown }).trace;
  if (!Array.isArray(trace)) return [];
  return trace.filter(
    (step): step is SourceAgentTraceStep => !!step && typeof step === "object",
  );
}

function SourceAgentTraceSummary({
  status,
}: {
  status: ContextProviderStatus;
}) {
  const trace = sourceAgentTrace(status);
  if (trace.length === 0) return null;
  return (
    <div className="rounded-md border">
      <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        Source-agent trace
      </div>
      <div className="divide-y">
        {trace.map((step, index) => (
          <div
            key={step.id ?? `${step.type}-${index}`}
            className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[6rem_minmax(0,1fr)]"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-mono text-[10px]">
                {step.type ?? "step"}
              </Badge>
              {step.status && (
                <Badge
                  variant="secondary"
                  className={`text-[10px] ${statusClasses(step.status === "ok" ? "ok" : "error")}`}
                >
                  {step.status}
                </Badge>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-foreground">
                {step.summary ?? step.tool ?? step.id ?? "Trace step"}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                turn {step.turn ?? "?"}
                {step.tool ? ` · ${step.tool}` : ""}
                {step.toolCallId ? ` · ${step.toolCallId}` : ""}
                {step.durationMs != null
                  ? ` · ${step.durationMs.toLocaleString()} ms`
                  : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ state }: { state: ContextProviderStatus["state"] }) {
  if (state === "ok") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (state === "timeout") return <Clock className="h-3.5 w-3.5" />;
  if (state === "stale") return <Clock className="h-3.5 w-3.5" />;
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

function memoryModeForHit(hit: ContextHit) {
  const mode = hit.provenance?.metadata?.mode;
  return mode === "recall" || mode === "reflect" ? mode : null;
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
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const tenantSlug = tenant?.slug;
  useBreadcrumbs([
    { label: "Company Brain", href: "/knowledge/memory" },
    { label: "Sources" },
  ]);
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
    Promise.all([
      listContextProviders(),
      tenantSlug
        ? listBuiltinTools(tenantSlug).catch(() => ({ tools: [] }))
        : Promise.resolve({ tools: [] }),
    ])
      .then(([next, builtinTools]) => {
        if (!cancelled) {
          const providersWithFallback = withBuiltinWebSearchFallback(
            next,
            builtinTools.tools ?? [],
          );
          setProviders(providersWithFallback);
          setSelectedProviderIds((current) => {
            const visibleProviderIds = new Set(
              visibleContextProviders(providersWithFallback).map(
                (provider) => provider.id,
              ),
            );
            const visibleCurrent = current.filter((id) =>
              visibleProviderIds.has(id),
            );
            if (visibleCurrent.length > 0) return visibleCurrent;
            return defaultSelectedProviderIds(providersWithFallback);
          });
          const memoryProvider = providersWithFallback.find(
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
  }, [tenantSlug]);

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

  const visibleProviders = useMemo(
    () => visibleContextProviders(providers),
    [providers],
  );

  const selectedProviders = useMemo(
    () =>
      selectedProviderIds
        .map((id) => visibleProviders.find((provider) => provider.id === id))
        .filter((provider): provider is ContextProviderSummary =>
          Boolean(provider),
        ),
    [selectedProviderIds, visibleProviders],
  );

  const memorySelected = selectedProviders.some(
    (provider) => provider.family === "memory",
  );
  const defaultProviderIds = useMemo(
    () => defaultSelectedProviderIds(providers),
    [providers],
  );
  const backendProviderDefaultIds = useMemo(
    () => getBackendDefaultProviderIds(providers),
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
          providerIds: providerIdsForQuery({
            selectedProviderIds,
            visibleDefaultProviderIds: defaultProviderIds,
            backendDefaultProviderIds: backendProviderDefaultIds,
          }),
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

  const configProvider = providers.find(
    (provider) => provider.id === configProviderId,
  );
  const sourceRows = useMemo(() => contextSourceRows(providers), [providers]);
  const sourceColumns = useMemo<ColumnDef<ContextSourceRow>[]>(
    () => [
      {
        accessorKey: "provider.displayName",
        header: "Source",
        cell: ({ row }) => {
          const Icon =
            FAMILY_ICONS[row.original.sourceKey as keyof typeof FAMILY_ICONS] ??
            Search;
          return (
            <div className="flex min-w-0 items-start gap-2 py-1">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {row.original.provider.displayName}
                </p>
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {row.original.description}
                </p>
              </div>
            </div>
          );
        },
        size: 420,
      },
      {
        accessorKey: "familyLabel",
        header: "Family",
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono text-[11px]">
            {row.original.provider.family}
            {row.original.provider.sourceFamily &&
            row.original.provider.sourceFamily !== row.original.provider.family
              ? `:${row.original.provider.sourceFamily}`
              : ""}
          </Badge>
        ),
        size: 150,
      },
      {
        accessorKey: "provider.defaultEnabled",
        header: "Default",
        cell: ({ row }) => (
          <Badge variant="secondary" className="text-[11px]">
            {row.original.provider.defaultEnabled ? "default" : "opt-in"}
          </Badge>
        ),
        size: 110,
      },
      {
        accessorKey: "badge.label",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <Badge
              variant="secondary"
              className={`text-xs ${statusClasses(row.original.badge.state)}`}
            >
              {row.original.badge.label}
            </Badge>
            {row.original.lastTestSummary && (
              <span className="truncate text-xs text-muted-foreground">
                {row.original.lastTestSummary}
              </span>
            )}
          </div>
        ),
        size: 170,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.configurable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openProviderConfig(row.original.provider)}
            >
              <Settings2 className="h-4 w-4" />
              Configure
            </Button>
          ) : null,
        size: 120,
      },
    ],
    [],
  );

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
                    disabled={providersLoading || visibleProviders.length === 0}
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
                  <DropdownMenuLabel>Company Brain sources</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {visibleProviders.map((provider) => {
                    const Icon =
                      FAMILY_ICONS[
                        providerSourceKey(provider) as keyof typeof FAMILY_ICONS
                      ] ?? Search;
                    return (
                      <DropdownMenuCheckboxItem
                        key={provider.id}
                        checked={selectedProviderIds.includes(provider.id)}
                        disabled={!providerSelectable(provider)}
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
              placeholder="Search memory, pages, knowledge bases, files, and approved MCP tools..."
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
              {memoryModeMismatch}. Deploy the Company Brain source-options
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
                            {FAMILY_LABELS[resultSourceKey(hit)] ??
                              resultSourceKey(hit)}
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
                      {sourceAgentTrace(status).length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {sourceAgentTrace(status).length} source-agent trace
                          steps
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

      {providersLoading ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading providers...
        </div>
      ) : (
        <DataTable
          columns={sourceColumns}
          data={sourceRows}
          pageSize={0}
          tableClassName="table-fixed"
        />
      )}

      <Dialog
        open={Boolean(resultDialog)}
        onOpenChange={(open) => !open && setResultDialog(null)}
      >
        <DialogContent className="max-h-[80vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {resultDialog?.type === "full"
                ? "Full Company Brain Result"
                : resultDialog?.type === "hit"
                  ? resultDialog.hit.title
                  : resultDialog?.type === "provider"
                    ? resultDialog.status.displayName
                    : "Company Brain Result"}
            </DialogTitle>
            <DialogDescription>
              {resultDialog?.type === "full"
                ? "Complete structured response returned by query_context."
                : resultDialog?.type === "hit"
                  ? `${FAMILY_LABELS[resultSourceKey(resultDialog.hit)] ?? resultSourceKey(resultDialog.hit)} hit`
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
                    {FAMILY_LABELS[resultSourceKey(resultDialog.hit)] ??
                      resultSourceKey(resultDialog.hit)}
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
                              {FAMILY_LABELS[resultSourceKey(hit)] ??
                                resultSourceKey(hit)}
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
                <SourceAgentTraceSummary status={resultDialog.status} />
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {configProvider?.displayName ?? "Adapter Configuration"}
            </DialogTitle>
            <DialogDescription>
              Tenant policy controls which Company Brain sources are eligible
              and which sources run by default.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[70vh] space-y-4">
            {configProvider?.family === "sub-agent" && (
              <SubAgentConfigDetails provider={configProvider} />
            )}
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor="adapter-enabled">Eligible</Label>
                <p className="text-xs text-muted-foreground">
                  Disabled sources cannot be selected by templates or tests.
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
                  Default sources run when a query does not name providers.
                </p>
              </div>
              <Switch
                id="adapter-default"
                checked={configDefaultEnabled}
                disabled={!configEnabled}
                onCheckedChange={setConfigDefaultEnabled}
              />
            </div>
            {configProvider?.family === "memory" && (
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
