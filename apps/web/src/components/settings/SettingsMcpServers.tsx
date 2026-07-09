import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation } from "urql";
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import { SettingsProvisionAnalystConnectorMutation } from "@/lib/settings-queries";
import {
  createMcpServer,
  isPluginInstalledMcpServer,
  listMcpServers,
  listUserMcpServers,
  setMcpServerEnabled,
  type McpServer,
} from "@/lib/mcp-api";
import {
  SettingsTablePane,
  settingsLinkActionClassName,
} from "@/components/settings/SettingsContent";

export function SettingsMcpServers() {
  const { user } = useAuth();
  const { tenant, tenantId, userId } = useTenant();
  const navigate = useNavigate();
  const tenantSlug = tenant?.slug ?? null;
  const oauthUserId = userId ?? user?.sub ?? null;
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const pluginServers = useMemo(
    () => sortMcpServers((servers ?? []).filter(isPluginInstalledMcpServer)),
    [servers],
  );
  const pluginServerUrls = useMemo(
    () => new Set(pluginServers.map((server) => normalizeMcpServerUrl(server))),
    [pluginServers],
  );
  const individualServers = useMemo(
    () =>
      sortMcpServers(
        (servers ?? []).filter(
          (server) =>
            !isPluginInstalledMcpServer(server) &&
            !pluginServerUrls.has(normalizeMcpServerUrl(server)),
        ),
      ),
    [pluginServerUrls, servers],
  );

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    Promise.all([
      listMcpServers(tenantSlug),
      tenantId && oauthUserId
        ? listUserMcpServers(tenantId, oauthUserId)
        : Promise.resolve({ servers: [] }),
    ])
      .then(([tenantResult, userResult]) => {
        const userById = new Map(userResult.servers.map((s) => [s.id, s]));
        setServers(
          tenantResult.servers.map((server) => ({
            ...server,
            authStatus:
              userById.get(server.id)?.authStatus ?? server.authStatus,
          })),
        );
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [oauthUserId, tenantId, tenantSlug]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      if (!tenantSlug) return;
      setPending((p) => ({ ...p, [id]: true }));
      setServers(
        (prev) =>
          prev?.map((s) => (s.id === id ? { ...s, enabled } : s)) ?? prev,
      );
      try {
        await setMcpServerEnabled(tenantSlug, id, enabled);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update");
        load();
      } finally {
        setPending((p) => ({ ...p, [id]: false }));
      }
    },
    [tenantSlug, load],
  );

  const columns = useMemo<ColumnDef<McpServer>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 200,
        cell: ({ row }) => {
          const server = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{server.name}</span>
              {isPluginInstalledMcpServer(server) ? (
                <Badge variant="outline" className="shrink-0">
                  plugin
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "url",
        header: "URL",
        cell: ({ row }) => (
          <span className="block max-w-md truncate font-mono text-xs text-muted-foreground">
            {row.original.url}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ row }) => {
          const server = row.original;
          const requiresUserAuth =
            server.authType === "oauth" || server.authType === "per_user_oauth";
          const authStatus =
            server.authStatus ??
            (requiresUserAuth ? "not_connected" : undefined);
          if (authStatus) {
            return (
              <Badge
                variant={authStatus === "active" ? "outline" : "secondary"}
                className={
                  authStatus === "active"
                    ? "border-emerald-500/40 text-emerald-400"
                    : undefined
                }
              >
                {authStatus === "active"
                  ? "connected"
                  : authStatus === "expired"
                    ? "expired"
                    : "not connected"}
              </Badge>
            );
          }
          return server.status && server.status !== "approved" ? (
            <Badge variant="outline">{server.status}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "enabled",
        header: "Enabled",
        size: 90,
        cell: ({ row }) => {
          const server = row.original;
          return (
            <span
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Switch
                checked={server.enabled}
                disabled={
                  pending[server.id] || isPluginInstalledMcpServer(server)
                }
                onCheckedChange={(v) => toggle(server.id, v)}
                aria-label={`Toggle ${server.name}`}
              />
            </span>
          );
        },
      },
    ],
    [pending, toggle],
  );

  return (
    <>
      <SettingsTablePane
        title="MCP Servers"
        description="The tenant MCP server registry — register servers, configure credentials and OAuth, and manage the tools they expose. Assign a server to the agent in the Composer."
        loading={!servers && !error}
        actions={
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              className={settingsLinkActionClassName}
            >
              + Register data source
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className={settingsLinkActionClassName}
            >
              + New MCP Server
            </button>
          </div>
        }
        toolbar={
          error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <Input
              placeholder="Search servers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          )
        }
      >
        <div className="space-y-8">
          <McpServerSection
            columns={columns}
            servers={individualServers}
            search={search}
            emptyText="No individual MCP servers configured."
            onOpen={(serverId) =>
              navigate({
                to: "/settings/mcp-servers/$serverId",
                params: { serverId },
              })
            }
          />
          <McpServerSection
            title="From plugins"
            columns={columns}
            servers={pluginServers}
            search={search}
            emptyText="No MCP servers installed by plugins."
            onOpen={(serverId) =>
              navigate({
                to: "/settings/mcp-servers/$serverId",
                params: { serverId },
              })
            }
          />
        </div>
      </SettingsTablePane>
      <NewMcpServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tenantSlug={tenantSlug}
        onCreated={() => {
          setAddOpen(false);
          load();
        }}
      />
      <RegisterDataSourceDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        onProvisioned={load}
      />
    </>
  );
}

// THINK-230: analyst Postgres data-source registration. Provisions (and, when
// asked, re-approves or rotates) the read-only analyst connector chain via the
// `provisionAnalystConnector` mutation and surfaces the per-resource outcomes
// inline. Backend re-enforces tenant-admin; non-admins get a GraphQL error.
const ANALYST_PROVISION_STEPS = [
  "Approved postgres-dev connector row",
  "Broker credential secret",
  "Read-only analyst_reader RDS-IAM chain",
  "Analyst profile refresh",
  "Signed workspace connection folder for every agent",
];

type AnalystProvisionOutcome = {
  connectorId: string;
  connectorOutcome: string;
  brokerSecretOutcome: string;
  rdsIamCredentialOutcome?: string | null;
  profileRefreshed: boolean;
  foldersWritten: number;
  foldersSkipped: number;
};

function RegisterDataSourceDialog({
  open,
  onOpenChange,
  onProvisioned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvisioned: () => void;
}) {
  const [reApprove, setReApprove] = useState(false);
  const [rotateToken, setRotateToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<AnalystProvisionOutcome | null>(null);
  const [, provisionAnalystConnector] = useMutation(
    SettingsProvisionAnalystConnectorMutation,
  );

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setReApprove(false);
      setRotateToken(false);
      setErrorMsg(null);
      setResult(null);
      setSubmitting(false);
    }
  }, [open]);

  // Rotating the broker token forces a re-approval, so keep re-approve pinned
  // on (and disabled) whenever rotate is selected.
  const effectiveReApprove = rotateToken || reApprove;

  async function onConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const response = await provisionAnalystConnector({
        reApprove: effectiveReApprove,
        rotateToken,
      });
      if (response.error) {
        // Surface the GraphQL error message verbatim (e.g. the re-approval
        // instruction the backend returns when a URL/secret changed).
        setErrorMsg(
          response.error.graphQLErrors[0]?.message ??
            response.error.message.replace(/^\[[^\]]*\]\s*/, ""),
        );
        return;
      }
      const outcome = response.data?.provisionAnalystConnector;
      if (!outcome) {
        setErrorMsg("Provisioning returned no result.");
        return;
      }
      setResult(outcome);
      onProvisioned();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to provision");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register data source</DialogTitle>
          <DialogDescription>
            Provision the analyst Postgres connector so agents can query the
            warehouse with a read-only, brokered credential.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {result ? (
            <div className="space-y-3">
              <p className="text-sm text-emerald-500">
                Data source provisioned.
              </p>
              <dl className="divide-y divide-border rounded-md border border-border text-sm">
                <ProvisionResultRow
                  label="Connector"
                  value={result.connectorOutcome}
                />
                <ProvisionResultRow
                  label="Broker secret"
                  value={result.brokerSecretOutcome}
                />
                <ProvisionResultRow
                  label="RDS-IAM credential"
                  value={result.rdsIamCredentialOutcome ?? "not wired"}
                />
                <ProvisionResultRow
                  label="Analyst profile"
                  value={result.profileRefreshed ? "refreshed" : "unchanged"}
                />
                <ProvisionResultRow
                  label="Connection folders"
                  value={`${result.foldersWritten} written · ${result.foldersSkipped} skipped`}
                />
              </dl>
              <p className="font-mono text-xs text-muted-foreground">
                {result.connectorId}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  This provisions:
                </p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {ANALYST_PROVISION_STEPS.map((step) => (
                    <li key={step} className="flex gap-2">
                      <span aria-hidden className="text-muted-foreground">
                        •
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-3 rounded-md border border-border p-3">
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={effectiveReApprove}
                    disabled={rotateToken || submitting}
                    onCheckedChange={(v) => setReApprove(v === true)}
                    aria-label="Re-approve"
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      Re-approve
                    </span>
                    <span className="block text-muted-foreground">
                      Restamp the approval and re-pin the config hash.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={rotateToken}
                    disabled={submitting}
                    onCheckedChange={(v) => {
                      const next = v === true;
                      setRotateToken(next);
                      if (next) setReApprove(true);
                    }}
                    aria-label="Rotate broker token"
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      Rotate broker token
                    </span>
                    <span className="block text-muted-foreground">
                      Issue a fresh broker secret. Forces re-approval.
                    </span>
                  </span>
                </label>
              </div>
            </>
          )}
          {errorMsg ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {result ? "Close" : "Cancel"}
          </Button>
          {result ? null : (
            <Button onClick={onConfirm} disabled={submitting}>
              {submitting ? "Provisioning…" : "Provision data source"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProvisionResultRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

function McpServerSection({
  title,
  columns,
  servers,
  search,
  emptyText,
  onOpen,
}: {
  title?: string;
  columns: ColumnDef<McpServer>[];
  servers: McpServer[];
  search: string;
  emptyText: string;
  onOpen: (serverId: string) => void;
}) {
  return (
    <section>
      {title ? (
        <h2 className="mb-3 text-base font-medium text-foreground">{title}</h2>
      ) : null}
      <DataTable
        columns={columns}
        data={servers}
        filterValue={search}
        filterColumn="name"
        scrollable
        allowHorizontalScroll={false}
        pageSize={0}
        tableClassName="table-fixed"
        onRowClick={(row) => onOpen(row.id)}
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        }
      />
    </section>
  );
}

function normalizeMcpServerUrl(server: McpServer): string {
  return server.url.trim().replace(/\/+$/, "").toLowerCase();
}

function sortMcpServers(servers: McpServer[]): McpServer[] {
  return [...servers].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    return normalizeMcpServerUrl(left).localeCompare(
      normalizeMcpServerUrl(right),
      undefined,
      { numeric: true, sensitivity: "base" },
    );
  });
}

function NewMcpServerDialog({
  open,
  onOpenChange,
  tenantSlug,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string | null;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState("none");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setUrl("");
      setAuthType("none");
      setApiKey("");
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit =
    !!tenantSlug &&
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (authType !== "tenant_api_key" || apiKey.trim().length > 0) &&
    !submitting;

  async function onSubmit() {
    if (!tenantSlug || !canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createMcpServer(tenantSlug, {
        name: name.trim(),
        url: url.trim(),
        authType,
        ...(authType === "tenant_api_key" ? { apiKey: apiKey.trim() } : {}),
      });
      onCreated();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to add server");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New MCP server</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP server"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Authentication</label>
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="tenant_api_key">API key</SelectItem>
                <SelectItem value="oauth">OAuth</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType === "tenant_api_key" ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">API key</label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Secret token"
              />
            </div>
          ) : null}
          {authType === "oauth" ? (
            <p className="text-xs text-muted-foreground">
              Connect this server&apos;s OAuth from its detail page after adding
              it.
            </p>
          ) : null}
          {errorMsg ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {submitting ? "Adding…" : "Add server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
