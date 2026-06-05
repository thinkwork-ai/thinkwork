import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  Loader2,
  Mail,
  Search,
  TestTube,
  Trash2,
  Wrench,
} from "lucide-react";
import { useQuery } from "urql";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
} from "@thinkwork/ui";
import { toast } from "sonner";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsTenantAgentQuery,
  SettingsTenantSandboxStatusQuery,
} from "@/lib/settings-queries";
import {
  deleteBuiltinTool,
  listBuiltinTools,
  testBuiltinTool,
  upsertBuiltinTool,
  type BuiltinTool,
} from "@/lib/builtin-tools-api";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

type CatalogEntry = {
  slug: string;
  name: string;
  description: string;
  providers: Array<{ id: string; label: string }>;
  kind?: "provider-keyed" | "policy-gated";
  fixedProvider?: string;
};

type SandboxState = {
  sandboxEnabled: boolean;
  complianceTier: string | null;
  hasInterpreters: boolean;
};

type AgentToolConfig = {
  agentName: string;
  blockedTools: unknown;
  sandbox: unknown;
  browser: unknown;
  webSearch: unknown;
  webExtract: unknown;
  sendEmail: unknown;
  contextEngine: unknown;
};

type ToolAccess = {
  enabled: boolean;
  label: string;
  detail: string;
  toolName: string | null;
  warning?: boolean;
};

type Row = CatalogEntry & {
  state: BuiltinTool | null;
  sandbox?: SandboxState;
  agentAccess: ToolAccess;
};

const CATALOG: CatalogEntry[] = [
  {
    slug: "browser_automation",
    name: "Browser Automation",
    description:
      "Operate dynamic websites with an AgentCore Browser session controlled by Nova Act.",
    providers: [],
    kind: "policy-gated" as const,
    fixedProvider: "agentcore+nova_act",
  },
  {
    slug: "code-sandbox",
    name: "Code Sandbox",
    description:
      "Run Python against real data in your AWS account through Bedrock AgentCore Code Interpreter.",
    providers: [],
    kind: "policy-gated" as const,
    fixedProvider: "agentcore",
  },
  {
    slug: "agent-email-send",
    name: "Send Email",
    description:
      "Send plain text email from the agent address with reply tracking.",
    providers: [],
    kind: "policy-gated" as const,
    fixedProvider: "thinkwork-email",
  },
  {
    slug: "context-engine",
    name: "Company Brain",
    description:
      "Query Company Brain across memory, pages, workspace files, knowledge bases, and approved context tools.",
    providers: [],
    kind: "policy-gated" as const,
    fixedProvider: "thinkwork-context",
  },
  {
    slug: "web-search",
    name: "Web Search",
    description:
      "Find candidate URLs and web results for research with Exa or SerpAPI.",
    providers: [
      { id: "exa", label: "Exa" },
      { id: "serpapi", label: "SerpAPI" },
    ],
  },
  {
    slug: "web-extract",
    name: "Web Extraction",
    description:
      "Read one known public URL as clean markdown through Firecrawl.",
    providers: [{ id: "firecrawl", label: "Firecrawl" }],
  },
].sort((a, b) => a.name.localeCompare(b.name));

function configEnabled(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const enabled = (value as { enabled?: unknown }).enabled;
  return enabled === undefined ? true : enabled === true;
}

function hasBlockedTool(value: unknown, toolName: string | null): boolean {
  if (!toolName || !Array.isArray(value)) return false;
  return value.map((item) => String(item).toLowerCase()).includes(toolName);
}

function toolNameFor(slug: string): string | null {
  switch (slug) {
    case "code-sandbox":
      return "execute_code";
    case "agent-email-send":
      return "send_email";
    case "context-engine":
      return "query_context";
    case "browser_automation":
      return "browser_automation";
    case "web-search":
      return "web_search";
    case "web-extract":
      return "web_extract";
    default:
      return null;
  }
}

function agentConfigFor(slug: string, agent: AgentToolConfig | null): unknown {
  if (!agent) return null;
  switch (slug) {
    case "code-sandbox":
      return agent.sandbox;
    case "agent-email-send":
      return agent.sendEmail;
    case "context-engine":
      return agent.contextEngine;
    case "browser_automation":
      return agent.browser;
    case "web-search":
      return agent.webSearch;
    case "web-extract":
      return agent.webExtract;
    default:
      return null;
  }
}

function accessForTool(
  row: Pick<Row, "slug" | "kind" | "state" | "sandbox">,
  agent: AgentToolConfig | null,
): ToolAccess {
  const toolName = toolNameFor(row.slug);
  const agentName = agent?.agentName ?? "Agent";
  const agentEnabled = configEnabled(agentConfigFor(row.slug, agent));

  if (!agent) {
    return {
      enabled: false,
      label: "Loading",
      detail: "Loading platform agent configuration.",
      toolName,
      warning: true,
    };
  }

  if (hasBlockedTool(agent.blockedTools, toolName)) {
    return {
      enabled: false,
      label: "Blocked",
      detail: `${toolName} is blocked on ${agentName}.`,
      toolName,
      warning: true,
    };
  }

  if (row.slug === "code-sandbox") {
    const tenantReady =
      !!row.sandbox?.sandboxEnabled && !!row.sandbox?.hasInterpreters;
    const enabled = tenantReady && agentEnabled;
    return {
      enabled,
      label: enabled ? "Enabled" : tenantReady ? "Agent off" : "Platform off",
      detail: enabled
        ? `${agentName} receives execute_code.`
        : tenantReady
          ? `${agentName} is not opted into execute_code.`
          : "The tenant Code Sandbox is disabled or still provisioning.",
      toolName,
      warning: !enabled,
    };
  }

  if (row.kind !== "policy-gated" && row.state?.enabled !== true) {
    return {
      enabled: false,
      label: row.state ? "Provider off" : "Provider missing",
      detail: row.state
        ? "The provider row is disabled."
        : "No provider is configured for this built-in tool.",
      toolName,
      warning: true,
    };
  }

  return {
    enabled: agentEnabled,
    label: agentEnabled ? "Enabled" : "Agent off",
    detail: agentEnabled
      ? `${agentName} receives ${toolName ?? row.slug}.`
      : `${agentName} is not opted into ${toolName ?? row.slug}.`,
    toolName,
    warning: !agentEnabled,
  };
}

export function SettingsTools() {
  const { tenant, tenantId } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const [tools, setTools] = useState<BuiltinTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeRow, setActiveRow] = useState<Row | null>(null);

  const [{ data: sandboxData }] = useQuery({
    query: SettingsTenantSandboxStatusQuery,
    variables: { id: tenantId ?? "" },
    pause: !tenantId,
  });
  const [{ data: agentData }] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    listBuiltinTools(tenantSlug)
      .then((response) => setTools(response.tools))
      .catch((loadError) =>
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load",
        ),
      );
  }, [tenantSlug]);

  useEffect(() => {
    load();
  }, [load]);

  const sandboxState: SandboxState | undefined = sandboxData?.tenant
    ? {
        sandboxEnabled: !!sandboxData.tenant.sandboxEnabled,
        complianceTier: sandboxData.tenant.complianceTier ?? null,
        hasInterpreters:
          !!sandboxData.tenant.sandboxInterpreterPublicId &&
          !!sandboxData.tenant.sandboxInterpreterInternalId,
      }
    : undefined;

  const agent: AgentToolConfig | null = agentData?.agent
    ? {
        agentName: agentData.agent.name,
        blockedTools: agentData.agent.blockedTools,
        sandbox: agentData.agent.sandbox,
        browser: agentData.agent.browser,
        webSearch: agentData.agent.webSearch,
        webExtract: agentData.agent.webExtract,
        sendEmail: agentData.agent.sendEmail,
        contextEngine: agentData.agent.contextEngine,
      }
    : null;

  const rows = useMemo<Row[]>(() => {
    const states = tools ?? [];
    const catalogRows = CATALOG.map((entry) => {
      const state = states.find((tool) => tool.toolSlug === entry.slug) ?? null;
      const sandbox =
        entry.kind === "policy-gated" && entry.slug === "code-sandbox"
          ? sandboxState
          : undefined;
      return {
        ...entry,
        state,
        sandbox,
        agentAccess: accessForTool({ ...entry, state, sandbox }, agent),
      };
    });
    const extraRows = states
      .filter((tool) => !CATALOG.some((entry) => entry.slug === tool.toolSlug))
      .map((tool) => {
        const entry: CatalogEntry = {
          slug: tool.toolSlug,
          name: tool.toolSlug,
          description: "Tenant built-in tool.",
          providers: tool.provider
            ? [{ id: tool.provider, label: tool.provider }]
            : [],
        };
        return {
          ...entry,
          state: tool,
          agentAccess: accessForTool({ ...entry, state: tool }, agent),
        };
      });
    return [...catalogRows, ...extraRows];
  }, [agent, sandboxState, tools]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Tool",
        cell: ({ row }) => (
          <div className="min-w-0 pl-3">
            <span className="font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "provider",
        header: "Provider",
        cell: ({ row }) => {
          const provider =
            row.original.fixedProvider ?? row.original.state?.provider;
          if (!provider) {
            return <span className="text-sm text-muted-foreground">-</span>;
          }
          return (
            <Badge
              variant="secondary"
              className="whitespace-nowrap font-mono text-xs"
            >
              {provider}
            </Badge>
          );
        },
      },
      {
        id: "platform",
        header: () => (
          <div className="whitespace-nowrap text-center">Platform</div>
        ),
        cell: ({ row }) => {
          if (row.original.kind === "policy-gated") {
            if (row.original.slug !== "code-sandbox") {
              return (
                <div className="flex justify-center">
                  <Badge variant="secondary" className="text-xs">
                    Platform built-in
                  </Badge>
                </div>
              );
            }

            const sandbox = row.original.sandbox;
            if (!sandbox) {
              return (
                <div className="flex justify-center">
                  <Badge variant="secondary" className="text-xs">
                    Loading...
                  </Badge>
                </div>
              );
            }

            const enabled = sandbox.sandboxEnabled;
            const provisioning = enabled && !sandbox.hasInterpreters;
            return (
              <div className="flex justify-center">
                <Badge
                  variant="secondary"
                  className={`gap-1 text-xs ${
                    provisioning
                      ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                      : enabled
                        ? "bg-green-500/15 text-green-600 dark:text-green-400"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {provisioning
                    ? "Provisioning"
                    : enabled
                      ? "Enabled"
                      : "Disabled"}
                </Badge>
              </div>
            );
          }

          const state = row.original.state;
          const enabled = state?.enabled === true;
          return (
            <div className="flex justify-center">
              <Badge
                variant="secondary"
                className={`gap-1 text-xs ${
                  enabled
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {enabled ? "Enabled" : state ? "Disabled" : "Not configured"}
              </Badge>
            </div>
          );
        },
      },
      {
        id: "agentAccess",
        header: () => (
          <div className="whitespace-nowrap text-center">Agent access</div>
        ),
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Badge
              variant="secondary"
              className={`text-xs ${
                row.original.agentAccess.enabled
                  ? "bg-green-500/15 text-green-600 dark:text-green-400"
                  : row.original.agentAccess.warning
                    ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {row.original.agentAccess.label}
            </Badge>
          </div>
        ),
      },
      {
        id: "apiKey",
        header: () => <div className="whitespace-nowrap">API Key</div>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.state?.hasSecret ? "Set" : "-"}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <SettingsTablePane
      title="Built-in Tools"
      description="Configure platform built-ins, provider credentials, and tenant agent access for this Space."
      loading={!tools && !error}
      toolbar={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
        )
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        filterColumn="name"
        onRowClick={(row) => setActiveRow(row)}
        scrollable
        allowHorizontalScroll={false}
        pageSize={25}
        tableClassName="table-auto [&_tbody_tr]:h-12"
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No built-in tools available.
          </div>
        }
      />
      {activeRow?.kind === "policy-gated" ? (
        <PolicyGatedInfoDialog
          row={activeRow}
          agentName={agent?.agentName ?? "Agent"}
          onClose={() => setActiveRow(null)}
        />
      ) : activeRow ? (
        <ConfigureBuiltinToolDialog
          row={activeRow}
          tenantSlug={tenantSlug}
          onClose={() => setActiveRow(null)}
          onChanged={load}
        />
      ) : null}
    </SettingsTablePane>
  );
}

function ConfigureBuiltinToolDialog({
  row,
  tenantSlug,
  onClose,
  onChanged,
}: {
  row: Row;
  tenantSlug: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const existing = row.state;
  const [provider, setProvider] = useState(
    existing?.provider ?? row.providers[0]?.id ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    resultCount?: number;
    error?: string;
  } | null>(null);

  const canSave =
    !!tenantSlug && !!provider && (!!apiKey || !!existing?.hasSecret);

  const handleSave = async () => {
    if (!tenantSlug) return;
    setSaving(true);
    try {
      await upsertBuiltinTool(tenantSlug, row.slug, {
        provider,
        enabled,
        ...(apiKey ? { apiKey } : {}),
      });
      toast.success(`${row.name} saved`);
      setApiKey("");
      onChanged();
      onClose();
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!tenantSlug) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testBuiltinTool(tenantSlug, row.slug, {
        provider,
        ...(apiKey ? { apiKey } : {}),
      });
      setTestResult(result);
      if (result.ok) {
        toast.success(`Connected - ${result.resultCount ?? 0} result(s)`);
      } else {
        toast.error(result.error || "Test failed");
      }
    } catch (testError) {
      const message =
        testError instanceof Error ? testError.message : "Test failed";
      setTestResult({ ok: false, error: message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!tenantSlug) return;
    setDeleting(true);
    try {
      await deleteBuiltinTool(tenantSlug, row.slug);
      toast.success(`${row.name} removed`);
      onChanged();
      onClose();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error ? deleteError.message : "Delete failed",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-4 overflow-y-auto p-6 sm:max-w-lg"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            {row.name}
          </SheetTitle>
          <SheetDescription>{row.description}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {row.providers.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="builtin-tool-api-key">
              API Key{" "}
              {existing?.hasSecret ? (
                <span className="text-xs text-muted-foreground">
                  (leave blank to keep existing key)
                </span>
              ) : null}
            </Label>
            <Input
              id="builtin-tool-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                existing?.hasSecret
                  ? "••••••••••••••••••••••••••••••••"
                  : `Paste your ${provider || row.name} API key`
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="builtin-tool-enabled">Enabled</Label>
            <Switch
              id="builtin-tool-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          {testResult ? (
            <div
              className={`flex items-start gap-2 rounded-md p-3 text-sm ${
                testResult.ok
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>
                {testResult.ok
                  ? `Connected. ${testResult.resultCount ?? 0} result(s) returned.`
                  : `Failed: ${testResult.error}`}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t pt-3">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || (!apiKey && !existing?.hasSecret)}
              >
                {testing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <TestTube className="mr-1.5 h-3.5 w-3.5" />
                )}
                Test
              </Button>
              {existing ? (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Confirm delete"
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remove
                  </Button>
                )
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!canSave || saving}
              >
                {saving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PolicyGatedInfoDialog({
  row,
  agentName,
  onClose,
}: {
  row: Row;
  agentName: string;
  onClose: () => void;
}) {
  const sandbox = row.sandbox;
  const isSandbox = row.slug === "code-sandbox";
  const isEmail = row.slug === "agent-email-send";
  const isContextEngine = row.slug === "context-engine";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-4 overflow-y-auto p-6 sm:max-w-lg"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="flex items-center gap-2">
            {isContextEngine ? (
              <BrainCircuit className="h-5 w-5" />
            ) : isEmail ? (
              <Mail className="h-5 w-5" />
            ) : (
              <Wrench className="h-5 w-5" />
            )}
            {row.name}
          </SheetTitle>
          <SheetDescription>{row.description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Provider</Label>
            <div>
              <Badge variant="secondary" className="font-mono text-xs">
                {row.fixedProvider ?? "agentcore"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {isSandbox
                ? "Bedrock AgentCore Code Interpreter. One public and one internal-only interpreter are provisioned per tenant on first enrollment."
                : isContextEngine
                  ? "Company Brain is provided by Thinkwork and resolves source status for memory, pages, workspace files, knowledge bases, and approved MCP context tools at query time."
                  : isEmail
                    ? "Thinkwork platform email sending uses the agent email channel and records reply tokens for bidirectional conversations."
                    : "Bedrock AgentCore Browser sessions are controlled through Nova Act. Cost is recorded as separate Nova Act and AgentCore Browser events."}
            </p>
          </div>

          {isSandbox ? (
            <div className="space-y-1">
              <Label>Status</Label>
              <div className="flex flex-wrap items-center gap-2">
                {!sandbox ? (
                  <Badge variant="secondary" className="text-xs">
                    Loading...
                  </Badge>
                ) : (
                  <>
                    <Badge
                      variant="secondary"
                      className={`text-xs ${
                        sandbox.sandboxEnabled && sandbox.hasInterpreters
                          ? "bg-green-500/15 text-green-600 dark:text-green-400"
                          : sandbox.sandboxEnabled
                            ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {sandbox.sandboxEnabled && !sandbox.hasInterpreters
                        ? "Provisioning"
                        : sandbox.sandboxEnabled
                          ? "Enabled"
                          : "Disabled"}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-xs">
                      tier: {sandbox.complianceTier ?? "standard"}
                    </Badge>
                  </>
                )}
              </div>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label>Agent access</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className={`text-xs ${
                  row.agentAccess.enabled
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                }`}
              >
                {row.agentAccess.label}
              </Badge>
              {row.agentAccess.toolName ? (
                <Badge variant="outline" className="font-mono text-xs">
                  {row.agentAccess.toolName}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {row.agentAccess.detail} This is the effective configuration for{" "}
              {agentName}, the tenant platform agent used by chat.
            </p>
          </div>

          {isSandbox ? (
            <div className="space-y-1">
              <Label>Tenant policy toggle</Label>
              <p className="text-xs text-muted-foreground">
                The tenant-level kill switch (<code>sandbox_enabled</code>) and
                compliance tier are managed through the{" "}
                <code>updateTenantPolicy</code> mutation.
              </p>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
