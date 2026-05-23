import { useState, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  TestTube,
  Trash2,
  Wrench,
  Search,
  Mail,
  BrainCircuit,
} from "lucide-react";
import {
  TenantAgentQuery,
  TenantSandboxStatusQuery,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  listBuiltinTools,
  upsertBuiltinTool,
  deleteBuiltinTool,
  testBuiltinTool,
  type BuiltinTool,
} from "@/lib/builtin-tools-api";

export const Route = createFileRoute(
  "/_authed/_tenant/agent/tools",
)({
  component: BuiltinToolsPage,
});

// ---------------------------------------------------------------------------
// Catalog — mirrors BUILTIN_TOOL_CATALOG in the API handler
// ---------------------------------------------------------------------------

type CatalogEntry = {
  slug: string;
  name: string;
  description: string;
  providers: Array<{ id: string; label: string }>;
  /** Tools with no configurable provider slot (e.g. policy-gated
   * capabilities like Code Sandbox). Rendered with a fixed provider
   * label and opened in a read-only info dialog. */
  kind?: "provider-keyed" | "policy-gated";
  /** Fixed provider label shown in the Provider column when kind ===
   * "policy-gated". Code Sandbox = agentcore (Bedrock AgentCore Code
   * Interpreter). */
  fixedProvider?: string;
};

const CATALOG: CatalogEntry[] = [
  {
    slug: "browser_automation",
    name: "Browser Automation",
    description:
      "Lets the platform agent operate dynamic websites with an AgentCore Browser session controlled by Nova Act. Policy-gated at the tenant level and controlled on the tenant platform agent.",
    providers: [],
    kind: "policy-gated" as const,
    fixedProvider: "agentcore+nova_act",
  },
  {
    slug: "code-sandbox",
    name: "Code Sandbox",
    description:
      "Lets the platform agent run Python via execute_code against real data in your AWS account. Runs on Bedrock AgentCore Code Interpreter and is controlled on the tenant platform agent.",
    providers: [],
    kind: "policy-gated" as const,
    fixedProvider: "agentcore",
  },
  {
    slug: "agent-email-send",
    name: "Send Email",
    description:
      "Lets the platform agent send plain text email from its agent address with reply tracking. Policy-gated by the agent email channel and controlled on the tenant platform agent.",
    providers: [],
    kind: "policy-gated" as const,
    fixedProvider: "thinkwork-email",
  },
  {
    slug: "context-engine",
    name: "Company Brain",
    description:
      "Lets the platform agent query Company Brain across memory, pages, workspace files, knowledge bases, and approved search-safe MCP tools.",
    providers: [],
    kind: "policy-gated" as const,
    fixedProvider: "thinkwork-context",
  },
  {
    slug: "web-search",
    name: "Web Search",
    description:
      "Lets agents search the web, read pages, and research companies. Choose a provider and supply an API key.",
    providers: [
      { id: "exa", label: "Exa" },
      { id: "serpapi", label: "SerpAPI" },
    ],
  },
].sort((a, b) => a.name.localeCompare(b.name));

type SandboxState = {
  sandboxEnabled: boolean;
  complianceTier: string | null;
  hasInterpreters: boolean;
};

type Row = CatalogEntry & {
  state: BuiltinTool | null;
  sandbox?: SandboxState;
  agentAccess: ToolAccess;
};

type AgentToolConfig = {
  agentName: string;
  blockedTools: unknown;
  sandbox: unknown;
  browser: unknown;
  webSearch: unknown;
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
    default:
      return null;
  }
}

function agentConfigFor(
  slug: string,
  agent: AgentToolConfig | null,
): unknown {
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
      label: enabled
        ? "Enabled"
        : tenantReady
          ? "Agent off"
          : "Platform off",
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

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const columns: ColumnDef<Row>[] = [
  {
    accessorKey: "name",
    header: "Tool",
    size: 220,
    cell: ({ row }) => (
      <div className="pl-3">
        <span className="font-medium">{row.original.name}</span>
      </div>
    ),
  },
  {
    accessorKey: "provider",
    header: "Provider",
    size: 240,
    cell: ({ row }) => {
      const p = row.original.fixedProvider ?? row.original.state?.provider;
      if (!p) return <span className="text-sm text-muted-foreground">—</span>;
      return (
        <Badge
          variant="secondary"
          className="whitespace-nowrap text-xs font-mono"
        >
          {p}
        </Badge>
      );
    },
  },
  {
    accessorKey: "enabled",
    header: () => <div className="text-center">Platform</div>,
    size: 150,
    cell: ({ row }) => {
      // Policy-gated tools (Code Sandbox) derive their Enabled/Disabled
      // from tenant policy + provisioning state, not from the
      // builtin-tools handler's per-provider row.
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
        const sb = row.original.sandbox;
        if (!sb) {
          return (
            <div className="flex justify-center">
              <Badge variant="secondary" className="text-xs">
                Loading…
              </Badge>
            </div>
          );
        }
        const enabled = sb.sandboxEnabled;
        const provisioning = enabled && !sb.hasInterpreters;
        return (
          <div className="flex justify-center">
            <Badge
              variant="secondary"
              className={`text-xs gap-1 ${
                provisioning
                  ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                  : enabled
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {provisioning ? "Provisioning" : enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        );
      }
      const st = row.original.state;
      const enabled = st?.enabled === true;
      const configured = !!st;
      return (
        <div className="flex justify-center">
          <Badge
            variant="secondary"
            className={`text-xs gap-1 ${
              enabled
                ? "bg-green-500/15 text-green-600 dark:text-green-400"
                : configured
                  ? "bg-muted text-muted-foreground"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {enabled ? "Enabled" : configured ? "Disabled" : "Not configured"}
          </Badge>
        </div>
      );
    },
  },
  {
    accessorKey: "agentAccess",
    header: () => <div className="text-center">Agent access</div>,
    size: 150,
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
    accessorKey: "hasSecret",
    header: "API Key",
    size: 100,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.state?.hasSecret ? "Set" : "—"}
      </span>
    ),
  },
  {
    accessorKey: "lastTestedAt",
    header: "Last tested",
    size: 160,
    cell: ({ row }) => {
      const t = row.original.state?.lastTestedAt;
      return (
        <span className="text-xs text-muted-foreground">
          {t ? new Date(t).toLocaleString() : "—"}
        </span>
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function BuiltinToolsPage() {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug;
  const tenantId = tenant?.id;
  useBreadcrumbs([
    { label: "Agent", href: "/agent" },
    { label: "Built-in Tools" },
  ]);

  const [tools, setTools] = useState<BuiltinTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRow, setActiveRow] = useState<Row | null>(null);
  const [search, setSearch] = useState("");

  // Policy-gated tools (Code Sandbox) read their Enabled/Disabled state
  // from the tenant row, not from the listBuiltinTools API.
  const [{ data: sandboxData }] = useQuery({
    query: TenantSandboxStatusQuery,
    variables: { id: tenantId ?? "" },
    pause: !tenantId,
  });
  const [{ data: agentData }] = useQuery({
    query: TenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const sandboxState: SandboxState | undefined = sandboxData?.tenant
    ? {
        sandboxEnabled: !!sandboxData.tenant.sandboxEnabled,
        complianceTier: sandboxData.tenant.complianceTier ?? null,
        hasInterpreters:
          !!sandboxData.tenant.sandboxInterpreterPublicId &&
          !!sandboxData.tenant.sandboxInterpreterInternalId,
      }
    : undefined;

  const refresh = useCallback(() => {
    if (!tenantSlug) return;
    setLoading(true);
    listBuiltinTools(tenantSlug)
      .then((r) => setTools(r.tools || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!tenantSlug) return <PageSkeleton />;
  if (loading && tools.length === 0) return <PageSkeleton />;

  const agent: AgentToolConfig | null = agentData?.agent
    ? {
        agentName: agentData.agent.name,
        blockedTools: agentData.agent.blockedTools,
        sandbox: agentData.agent.sandbox,
        browser: agentData.agent.browser,
        webSearch: agentData.agent.webSearch,
        sendEmail: agentData.agent.sendEmail,
        contextEngine: agentData.agent.contextEngine,
      }
    : null;

  const rows: Row[] = CATALOG.map((c) => {
    const state = tools.find((t) => t.toolSlug === c.slug) ?? null;
    const sandbox =
      c.kind === "policy-gated" && c.slug === "code-sandbox"
        ? sandboxState
        : undefined;
    return {
      ...c,
      state,
      sandbox,
      agentAccess: accessForTool({ ...c, state, sandbox }, agent),
    };
  });

  return (
    <>
      <div className="flex flex-col h-full min-h-0">
        <div className="shrink-0 flex items-center gap-4 mb-4">
          <div className="relative" style={{ width: "16rem" }}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <DataTable
            columns={columns}
            data={rows}
            filterValue={search}
            scrollable
            tableClassName="table-fixed [&_tbody_tr]:h-10"
            onRowClick={(r) => setActiveRow(r)}
          />
        </div>
      </div>

      {activeRow?.kind === "policy-gated" ? (
        <PolicyGatedInfoDialog
          row={activeRow}
          agentName={agent?.agentName ?? "Agent"}
          onClose={() => setActiveRow(null)}
        />
      ) : activeRow ? (
        <ConfigureDialog
          row={activeRow}
          tenantSlug={tenantSlug}
          onClose={() => setActiveRow(null)}
          onChanged={refresh}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Configure Dialog
// ---------------------------------------------------------------------------

function ConfigureDialog({
  row,
  tenantSlug,
  onClose,
  onChanged,
}: {
  row: Row;
  tenantSlug: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const existing = row.state;
  const [provider, setProvider] = useState<string>(
    existing?.provider ?? row.providers[0].id,
  );
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState<boolean>(existing?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    resultCount?: number;
    error?: string;
  } | null>(null);

  const handleSave = async () => {
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
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testBuiltinTool(tenantSlug, row.slug, {
        provider,
        ...(apiKey ? { apiKey } : {}),
      });
      setTestResult(result);
      if (result.ok) {
        toast.success(`Connected — ${result.resultCount ?? 0} result(s)`);
      } else {
        toast.error(result.error || "Test failed");
      }
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
      toast.error("Test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteBuiltinTool(tenantSlug, row.slug);
      toast.success(`${row.name} removed`);
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const canSave = !!provider && (!!apiKey || !!existing?.hasSecret);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {row.slug === "context-engine" ? (
              <BrainCircuit className="h-5 w-5" />
            ) : row.slug === "agent-email-send" ? (
              <Mail className="h-5 w-5" />
            ) : (
              <Wrench className="h-5 w-5" />
            )}
            {row.name}
          </DialogTitle>
          <DialogDescription>{row.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {row.providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="api-key">
              API Key{" "}
              {existing?.hasSecret && (
                <span className="text-xs text-muted-foreground">
                  (leave blank to keep existing key)
                </span>
              )}
            </Label>
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                existing?.hasSecret
                  ? "••••••••••••••••••••••••••••••••"
                  : `Paste your ${provider} API key`
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="enabled">Enabled</Label>
            <Switch
              id="enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 p-3 rounded-md text-sm ${
                testResult.ok
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <div>
                {testResult.ok
                  ? `Connected. ${testResult.resultCount ?? 0} result(s) returned.`
                  : `Failed: ${testResult.error}`}
              </div>
            </div>
          )}

          <div className="border-t pt-3 flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || (!apiKey && !existing?.hasSecret)}
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <TestTube className="h-3.5 w-3.5 mr-1.5" />
                )}
                Test
              </Button>
              {existing &&
                (confirmDelete ? (
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
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Remove
                  </Button>
                ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!canSave || saving}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Policy-gated info dialog — read-only view for built-ins controlled by
// tenant and platform-agent policy instead of provider API keys.
// ---------------------------------------------------------------------------

function PolicyGatedInfoDialog({
  row,
  agentName,
  onClose,
}: {
  row: Row;
  agentName: string;
  onClose: () => void;
}) {
  const sb = row.sandbox;
  const isSandbox = row.slug === "code-sandbox";
  const isEmail = row.slug === "agent-email-send";
  const isContextEngine = row.slug === "context-engine";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            {row.name}
          </DialogTitle>
          <DialogDescription>{row.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Provider</Label>
            <div>
              <Badge variant="secondary" className="text-xs font-mono">
                {row.fixedProvider ?? "agentcore"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {isSandbox
                ? "Bedrock AgentCore Code Interpreter. One public + one internal-only interpreter are provisioned per tenant on first enrollment."
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
              <div className="flex items-center gap-2 flex-wrap">
                {!sb ? (
                  <Badge variant="secondary" className="text-xs">
                    Loading…
                  </Badge>
                ) : (
                  <>
                    <Badge
                      variant="secondary"
                      className={`text-xs ${
                        sb.sandboxEnabled && sb.hasInterpreters
                          ? "bg-green-500/15 text-green-600 dark:text-green-400"
                          : sb.sandboxEnabled
                            ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {sb.sandboxEnabled && !sb.hasInterpreters
                        ? "Provisioning"
                        : sb.sandboxEnabled
                          ? "Enabled"
                          : "Disabled"}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">
                      tier: {sb.complianceTier ?? "standard"}
                    </Badge>
                  </>
                )}
              </div>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label>Agent access</Label>
            <div className="flex items-center gap-2 flex-wrap">
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
                <Badge variant="outline" className="text-xs font-mono">
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
                <code>updateTenantPolicy</code> mutation. A first-class admin
                toggle lands once the platform-operator email allowlist is live
                on your stage.
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
