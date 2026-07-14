import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Database, Plus } from "lucide-react";
import { useMutation, useQuery } from "urql";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TooltipIconButton,
} from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsAnalystInternalClustersQuery,
  SettingsAnalystInternalSchemasQuery,
  SettingsProvisionAnalystConnectorMutation,
  SettingsRegisterAnalystDataSourceMutation,
  SettingsRegisterInternalAnalystDataSourceMutation,
} from "@/lib/settings-queries";
import { AnalystDataSourceTls } from "@/gql/graphql";
import {
  createMcpServer,
  isPluginInstalledMcpServer,
  listMcpServers,
  listUserMcpServers,
  setMcpServerEnabled,
  type McpServer,
} from "@/lib/mcp-api";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { SettingsConnections } from "@/components/settings/SettingsConnections";

const CONNECTIONS_ROUTE = "/settings/mcp-servers";
const MCP_SERVERS_ROUTE = "/settings/mcp-servers/servers";
const DATA_SOURCES_ROUTE = "/settings/mcp-servers/data-sources";

type ConnectionsTab = "connections" | "servers" | "data-sources";

function tabForPath(pathname: string): ConnectionsTab {
  // The merged MCP list lives at /servers; analyst data sources live at
  // /data-sources (checked first for explicit ordering — the paths don't
  // overlap). The retired /plugins path redirects at the route level. The
  // section index is the Connections tab (per-user integrations).
  if (pathname.startsWith(DATA_SOURCES_ROUTE)) return "data-sources";
  if (pathname.startsWith(MCP_SERVERS_ROUTE)) return "servers";
  return "connections";
}

// Content-fit column: shrink to the widest cell instead of sharing leftover
// width (see DataTableColumnMeta docs in @thinkwork/ui data-table).
const FIT_CONTENT_COLUMN = {
  headClassName: "w-px whitespace-nowrap",
  cellClassName: "w-px whitespace-nowrap",
};

export function SettingsMcpServers() {
  const { user } = useAuth();
  const { tenant, tenantId, userId } = useTenant();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeTab = tabForPath(pathname);
  const tenantSlug = tenant?.slug ?? null;
  const oauthUserId = userId ?? user?.sub ?? null;
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  // THINK-285: the Data Sources tab filters independently of the servers tab
  // so a filter typed on one tab never silently hides rows on the other.
  const [dataSourceSearch, setDataSourceSearch] = useState("");
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
  // THINK-239/THINK-285: analyst connector rows (builtin + registered
  // sources) live on their own Data Sources tab.
  const dataSourceServers = useMemo(
    () => sortMcpServers((servers ?? []).filter(isAnalystDataSourceServer)),
    [servers],
  );
  const individualServers = useMemo(
    () =>
      sortMcpServers(
        (servers ?? []).filter(
          (server) =>
            !isPluginInstalledMcpServer(server) &&
            !isAnalystDataSourceServer(server) &&
            !pluginServerUrls.has(normalizeMcpServerUrl(server)),
        ),
      ),
    [pluginServerUrls, servers],
  );
  // THINK-284: tenant-registered and plugin-managed servers render as one
  // merged table; the Type column carries the classification per row.
  const mergedServers = useMemo(
    () => sortMcpServers([...individualServers, ...pluginServers]),
    [individualServers, pluginServers],
  );
  // THINK-239: the built-in `postgres-dev` connector, if already provisioned,
  // flips the built-in path's primary action to "Refresh data source".
  const builtinAnalystExists = useMemo(
    () => (servers ?? []).some(isBuiltinAnalystServer),
    [servers],
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

  const makeColumns = useCallback(
    (kind: "servers" | "data-sources"): ColumnDef<McpServer>[] => [
      {
        accessorKey: "name",
        header: "Name",
        size: 200,
        cell: ({ row }) => (
          <span className="block truncate font-medium">
            {row.original.name}
          </span>
        ),
      },
      // Datasource MCPs: no URL column — Source / Instance / Database render
      // as separate content-fit columns instead.
      ...(kind === "data-sources"
        ? ([
            {
              id: "source",
              header: "Source",
              meta: FIT_CONTENT_COLUMN,
              cell: ({ row }) => {
                const ds = row.original.dataSource;
                return ds ? (
                  <Badge variant="outline" className="capitalize">
                    {ds.kind}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                );
              },
            },
            {
              id: "instance",
              header: "Instance",
              meta: FIT_CONTENT_COLUMN,
              cell: ({ row }) => {
                const ds = row.original.dataSource;
                return ds ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {ds.host ? ds.host.split(".")[0] : "workspace cluster"}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                );
              },
            },
            {
              id: "database",
              header: "Database",
              meta: FIT_CONTENT_COLUMN,
              cell: ({ row }) => {
                const ds = row.original.dataSource;
                return ds ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {ds.database}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                );
              },
            },
          ] satisfies ColumnDef<McpServer>[])
        : [
            // The servers table's fixed layout sizes columns from explicit
            // sizes; the w-px content-fit meta only works under table-auto.
            {
              id: "type",
              header: "Type",
              size: 90,
              cell: ({ row }) => (
                <Badge variant="outline">
                  {isPluginInstalledMcpServer(row.original)
                    ? "Plugin"
                    : "Tenant"}
                </Badge>
              ),
            } satisfies ColumnDef<McpServer>,
            {
              accessorKey: "url",
              header: "URL",
              cell: ({ row }) => (
                <span className="block max-w-md truncate font-mono text-xs text-muted-foreground">
                  {row.original.url}
                </span>
              ),
            } satisfies ColumnDef<McpServer>,
          ]),
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
  const serverColumns = useMemo(() => makeColumns("servers"), [makeColumns]);
  const dataSourceColumns = useMemo(
    () => makeColumns("data-sources"),
    [makeColumns],
  );

  usePageHeaderActions({
    title: "Connectors",
    breadcrumbs: [{ label: "Connectors" }],
    tabs: [
      { to: CONNECTIONS_ROUTE, label: "Connections" },
      { to: MCP_SERVERS_ROUTE, label: "MCP Servers" },
      { to: DATA_SOURCES_ROUTE, label: "Data Sources" },
    ],
    // THINK-285: each tab shows only the action that creates the thing it
    // lists — New MCP Server on the servers tab, Register data source on the
    // Data Sources tab, nothing on the per-user Connections tab.
    action:
      activeTab === "servers" ? (
        <TooltipIconButton
          label="New MCP Server — register an MCP server for the tenant."
          aria-label="New MCP Server"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="size-4" />
        </TooltipIconButton>
      ) : activeTab === "data-sources" ? (
        <TooltipIconButton
          label="Register data source — give the analyst a Postgres database to query with a read-only, brokered credential."
          aria-label="Register data source"
          onClick={() => setRegisterOpen(true)}
        >
          <Database className="size-4" />
        </TooltipIconButton>
      ) : undefined,
    actionKey: `mcp-servers:${activeTab}`,
  });

  if (activeTab === "connections") {
    return (
      <SettingsTablePane
        embedded
        title="Connections"
        description="Your personal integrations — connect the accounts your agent works with on your behalf. Credentials are stored per user; other members connect their own."
        loading={false}
      >
        <SettingsConnections />
      </SettingsTablePane>
    );
  }

  const openServer = (serverId: string) =>
    navigate({
      to: "/settings/mcp-servers/$serverId",
      params: { serverId },
    });

  return (
    <>
      {activeTab === "data-sources" ? (
        <SettingsTablePane
          embedded
          title="Data Sources"
          description="Postgres data sources the analyst queries with read-only, brokered credentials. Register this environment's own cluster databases or an external database."
          loading={!servers && !error}
          toolbar={
            error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <Input
                placeholder="Search data sources…"
                value={dataSourceSearch}
                onChange={(e) => setDataSourceSearch(e.target.value)}
                className="max-w-sm"
              />
            )
          }
        >
          <McpServerSection
            columns={dataSourceColumns}
            servers={dataSourceServers}
            search={dataSourceSearch}
            fitContent
            emptyText="No data sources registered."
            onOpen={openServer}
          />
        </SettingsTablePane>
      ) : (
        <SettingsTablePane
          embedded
          title="MCP Servers"
          description="The tenant MCP server registry — registered servers and plugin-installed servers. Register servers, configure credentials and OAuth, and manage the tools they expose. Assign a server to the agent in the Composer."
          loading={!servers && !error}
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
          {/* One merged table: tenant-registered and plugin-managed servers
              together, typed per row (THINK-284). Analyst data sources live
              on the Data Sources tab (THINK-285). */}
          <McpServerSection
            columns={serverColumns}
            servers={mergedServers}
            search={search}
            emptyText="No MCP servers configured."
            onOpen={openServer}
          />
        </SettingsTablePane>
      )}
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
        builtinAnalystExists={builtinAnalystExists}
      />
    </>
  );
}

// THINK-230 / THINK-239: analyst Postgres data-source registration. Two tabs
// live side by side in one dialog:
//   • "Internal" browses the environment's OWN RDS clusters → pick a database →
//     register with ZERO credential entry (`registerInternalAnalystDataSource`
//     auto-provisions a hardened read-only role). Picking the `thinkwork`
//     workspace database routes to the built-in `provisionAnalystConnector`
//     chain instead (BuiltinDataSourceForm). Re-approve / rotate-broker-token
//     actions are NOT here; they live on the existing server's detail surface.
//   • "External" drives `registerAnalystDataSource` — an arbitrary external
//     Postgres registered as a first-party analyst connector through the sourced
//     broker route (POST /mcp/analyst/<slug>).
// Backend re-enforces tenant-admin on all paths; non-admins get a GraphQL error.
const ANALYST_PROVISION_STEPS = [
  "Approved postgres-dev connector row",
  "Broker credential secret",
  "Read-only analyst_reader RDS-IAM chain",
  "Analyst profile refresh",
  "Signed workspace connection folder for every agent",
];

const RESERVED_ANALYST_SLUG = "postgres-dev";
// Client-side mirror of the backend slug rule (^[a-z0-9][a-z0-9-]{0,38}$).
const ANALYST_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}$/;
// The app database is registered through the built-in connector path, never as
// a normal internal source (mirrors the backend's hard reject).
const WORKSPACE_DATABASE = "thinkwork";

type AnalystInternalDatabase = { name: string; alreadyRegistered: boolean };
type AnalystInternalCluster = {
  clusterId: string;
  endpoint: string;
  port: number;
  databases: AnalystInternalDatabase[];
};

// THINK-283: one selectable schema of an internal database.
type AnalystInternalSchema = {
  name: string;
  eligibleTableCount: number;
  alreadyRegistered: boolean;
};

type AnalystProvisionOutcome = {
  connectorId: string;
  connectorOutcome: string;
  brokerSecretOutcome: string;
  rdsIamCredentialOutcome?: string | null;
  profileRefreshed: boolean;
  foldersWritten: number;
  foldersSkipped: number;
};

type AnalystRegisterOutcome = {
  serverId: string;
  slug: string;
  tables: number;
  foldersWritten: number;
  foldersSkipped: number;
};

// Derive a kebab-case slug suggestion from a display name.
function suggestAnalystSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);
}

function graphqlErrorMessage(error: {
  graphQLErrors: readonly { message: string }[];
  message: string;
}): string {
  return (
    error.graphQLErrors[0]?.message ??
    error.message.replace(/^\[[^\]]*\]\s*/, "")
  );
}

function RegisterDataSourceDialog({
  open,
  onOpenChange,
  onProvisioned,
  builtinAnalystExists,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvisioned: () => void;
  builtinAnalystExists: boolean;
}) {
  const [tab, setTab] = useState<"builtin" | "external">("builtin");

  // Reset the tab each time the dialog opens.
  useEffect(() => {
    if (open) setTab("builtin");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register data source</DialogTitle>
          <DialogDescription>
            Give the analyst a Postgres data source to query with a read-only,
            brokered credential.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "builtin" | "external")}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="builtin">Internal</TabsTrigger>
            <TabsTrigger value="external">External</TabsTrigger>
          </TabsList>
          <TabsContent value="builtin">
            <InternalDataSourceForm
              onOpenChange={onOpenChange}
              onProvisioned={onProvisioned}
              builtinAnalystExists={builtinAnalystExists}
              active={tab === "builtin"}
              dialogOpen={open}
            />
          </TabsContent>
          <TabsContent value="external">
            <ExternalDataSourceForm
              onOpenChange={onOpenChange}
              onProvisioned={onProvisioned}
              active={tab === "external"}
              dialogOpen={open}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// THINK-239: the "Internal" tab. Browses the environment's own RDS clusters →
// pick a database → register with zero credential entry. Picking the
// `thinkwork` workspace database renders the built-in provisioning form.
function InternalDataSourceForm({
  onOpenChange,
  onProvisioned,
  builtinAnalystExists,
  active,
  dialogOpen,
}: {
  onOpenChange: (open: boolean) => void;
  onProvisioned: () => void;
  builtinAnalystExists: boolean;
  active: boolean;
  dialogOpen: boolean;
}) {
  const [clusterId, setClusterId] = useState("");
  const [database, setDatabase] = useState("");
  const [schema, setSchema] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<AnalystRegisterOutcome | null>(null);
  const [, registerInternal] = useMutation(
    SettingsRegisterInternalAnalystDataSourceMutation,
  );

  // Only query the clusters while the dialog is open on this tab.
  const [{ data, fetching, error }, refetchClusters] = useQuery({
    query: SettingsAnalystInternalClustersQuery,
    pause: !dialogOpen || !active,
    // Registration coverage changes between opens — never trust a cached list.
    requestPolicy: "cache-and-network",
  });
  const clusters: AnalystInternalCluster[] = useMemo(
    () => (data?.analystInternalClusters as AnalystInternalCluster[]) ?? [],
    [data],
  );

  // THINK-283: schemas load only AFTER a non-workspace database is selected —
  // never during cluster listing.
  const [
    { data: schemasData, fetching: schemasFetching, error: schemasError },
    refetchSchemas,
  ] = useQuery({
    query: SettingsAnalystInternalSchemasQuery,
    variables: { clusterId, database },
    pause:
      !dialogOpen ||
      !active ||
      !clusterId ||
      !database ||
      database === WORKSPACE_DATABASE,
    // `alreadyRegistered` flips as sources are registered — a cached schema
    // list would show a just-registered schema as still available.
    requestPolicy: "cache-and-network",
  });
  const schemas: AnalystInternalSchema[] = useMemo(
    () =>
      (schemasData?.analystInternalSchemas as AnalystInternalSchema[]) ?? [],
    [schemasData],
  );
  const selectedSchema = useMemo(
    () => schemas.find((s) => s.name === schema) ?? null,
    [schemas, schema],
  );

  // Preselect `public` only when it is actually suitable (has eligible
  // tables and is not already registered); an empty/registered `public`
  // forces an explicit non-public choice.
  useEffect(() => {
    if (schema || schemas.length === 0) return;
    const publicSchema = schemas.find((s) => s.name === "public");
    if (
      publicSchema &&
      publicSchema.eligibleTableCount > 0 &&
      !publicSchema.alreadyRegistered
    ) {
      setSchema("public");
    }
  }, [schemas, schema]);

  // Reset when the dialog reopens or the caller switches to this tab.
  useEffect(() => {
    if (dialogOpen && active) {
      setClusterId("");
      setDatabase("");
      setSchema("");
      setName("");
      setSlug("");
      setSlugEdited(false);
      setErrorMsg(null);
      setResult(null);
      setSubmitting(false);
    }
  }, [dialogOpen, active]);

  // Auto-select when exactly one cluster is available.
  useEffect(() => {
    if (!clusterId && clusters.length === 1) {
      setClusterId(clusters[0]!.clusterId);
    }
  }, [clusters, clusterId]);

  const selectedCluster = useMemo(
    () => clusters.find((c) => c.clusterId === clusterId) ?? null,
    [clusters, clusterId],
  );
  const isWorkspaceDatabase = database === WORKSPACE_DATABASE;

  const trimmedSlug = slug.trim();
  const slugFormatValid = ANALYST_SLUG_PATTERN.test(trimmedSlug);
  const slugReserved = trimmedSlug === RESERVED_ANALYST_SLUG;
  const slugError = !trimmedSlug
    ? null
    : slugReserved
      ? `"${RESERVED_ANALYST_SLUG}" is reserved for the built-in data source — choose another.`
      : !slugFormatValid
        ? "Use 1–39 chars: lowercase letters, digits and hyphens, starting with a letter or digit."
        : null;

  const canSubmit =
    !!selectedCluster &&
    !!database &&
    !isWorkspaceDatabase &&
    // THINK-283: an explicit, currently eligible, unregistered schema is
    // required — empty/loading/error schema results cannot submit.
    !!selectedSchema &&
    selectedSchema.eligibleTableCount > 0 &&
    !selectedSchema.alreadyRegistered &&
    name.trim().length > 0 &&
    trimmedSlug.length > 0 &&
    slugFormatValid &&
    !slugReserved &&
    !submitting;

  function onClusterChange(value: string) {
    setClusterId(value);
    setDatabase("");
    setSchema("");
    setName("");
    setSlug("");
    setSlugEdited(false);
    setErrorMsg(null);
  }

  // Suggest name + slug from the database AND the selected schema — sources
  // are schema-scoped (THINK-283), so two schemas of the same database must
  // not default to the same slug. `public` keeps the database-only suggestion.
  function applySuggestion(db: string, schemaName: string) {
    const base =
      schemaName && schemaName !== "public" ? `${db} ${schemaName}` : db;
    setName(prettifyDatabaseName(base));
    if (!slugEdited) setSlug(suggestAnalystSlug(base));
  }

  function onDatabaseChange(value: string) {
    setDatabase(value);
    // A stale schema from the previous database must never survive.
    setSchema("");
    setErrorMsg(null);
    if (value && value !== WORKSPACE_DATABASE) {
      applySuggestion(value, "");
    } else {
      setName("");
      setSlug("");
      setSlugEdited(false);
    }
  }

  async function onSubmit() {
    if (!canSubmit || !selectedCluster) return;
    setSubmitting(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const response = await registerInternal({
        input: {
          clusterId: selectedCluster.clusterId,
          database,
          schema,
          name: name.trim(),
          slug: trimmedSlug,
        },
      });
      if (response.error) {
        setErrorMsg(graphqlErrorMessage(response.error));
        return;
      }
      const outcome = response.data?.registerInternalAnalystDataSource;
      if (!outcome) {
        setErrorMsg("Registration returned no result.");
        return;
      }
      setResult(outcome);
      onProvisioned();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to register");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4 py-2">
        <p className="text-sm text-emerald-500">Data source registered.</p>
        <dl className="divide-y divide-border rounded-md border border-border text-sm">
          <ProvisionResultRow label="Slug" value={result.slug} />
          <ProvisionResultRow label="Tables" value={`${result.tables}`} />
          <ProvisionResultRow
            label="Connection folders"
            value={`${result.foldersWritten} written · ${result.foldersSkipped} skipped`}
          />
        </dl>
        <p className="font-mono text-xs text-muted-foreground">
          {result.serverId}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground">
        Browse this environment&apos;s own database clusters and register a
        database. No credential is entered — a hardened read-only role is
        provisioned automatically.
      </p>

      {fetching ? (
        <p className="text-sm text-muted-foreground">Loading clusters…</p>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            Failed to load clusters:{" "}
            {error.message.replace(/^\[[^\]]*\]\s*/, "")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchClusters({ requestPolicy: "network-only" })}
          >
            Retry
          </Button>
        </div>
      ) : clusters.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No internal database clusters were found in this environment.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="int-cluster">Cluster</Label>
            <Select
              value={clusterId}
              onValueChange={onClusterChange}
              aria-label="Cluster"
            >
              <SelectTrigger id="int-cluster">
                <SelectValue placeholder="Select a cluster" />
              </SelectTrigger>
              <SelectContent>
                {clusters.map((cluster) => (
                  <SelectItem
                    key={cluster.clusterId}
                    value={cluster.clusterId}
                    disabled={cluster.databases.length === 0}
                  >
                    {cluster.clusterId}
                    {cluster.databases.length === 0
                      ? " (no admin credential)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCluster && selectedCluster.databases.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No admin credential is available for this cluster — its
                databases can&apos;t be listed.
              </p>
            ) : null}
          </div>

          {selectedCluster && selectedCluster.databases.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="int-database">Database</Label>
              <Select
                value={database}
                onValueChange={onDatabaseChange}
                aria-label="Database"
              >
                <SelectTrigger id="int-database">
                  <SelectValue placeholder="Select a database" />
                </SelectTrigger>
                <SelectContent>
                  {selectedCluster.databases.map((db) =>
                    db.name === WORKSPACE_DATABASE ? (
                      <SelectItem key={db.name} value={db.name}>
                        Workspace database (built-in)
                      </SelectItem>
                    ) : (
                      // THINK-283: registration coverage is per-SCHEMA now,
                      // so a database with one registered schema stays
                      // selectable — the schema list below marks the exact
                      // registered entries.
                      <SelectItem key={db.name} value={db.name}>
                        {db.name}
                        {db.alreadyRegistered ? " (has registered source)" : ""}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* THINK-283: exactly ONE schema per source, selected explicitly. */}
          {selectedCluster && database && !isWorkspaceDatabase ? (
            <div className="space-y-1.5">
              <Label htmlFor="int-schema">Schema</Label>
              {schemasFetching ? (
                <p
                  className="text-sm text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  Loading schemas…
                </p>
              ) : schemasError ? (
                <div className="space-y-2">
                  <p className="text-sm text-destructive" role="alert">
                    Failed to load schemas:{" "}
                    {schemasError.message.replace(/^\[[^\]]*\]\s*/, "")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      refetchSchemas({ requestPolicy: "network-only" })
                    }
                  >
                    Retry
                  </Button>
                </div>
              ) : schemas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No schemas were found in this database.
                </p>
              ) : (
                <>
                  <Select
                    value={schema}
                    onValueChange={(value) => {
                      setSchema(value);
                      applySuggestion(database, value);
                      setErrorMsg(null);
                    }}
                    aria-label="Schema"
                  >
                    <SelectTrigger id="int-schema">
                      <SelectValue placeholder="Select a schema" />
                    </SelectTrigger>
                    <SelectContent>
                      {schemas.map((s) => (
                        <SelectItem
                          key={s.name}
                          value={s.name}
                          disabled={
                            s.alreadyRegistered || s.eligibleTableCount === 0
                          }
                        >
                          {s.name}
                          {s.alreadyRegistered
                            ? " (registered)"
                            : s.eligibleTableCount === 0
                              ? " (no eligible tables)"
                              : ` — ${s.eligibleTableCount} table${s.eligibleTableCount === 1 ? "" : "s"}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    The source is scoped to exactly this schema&apos;s current
                    tables. Tables created later stay unavailable until you
                    refresh the source.
                  </p>
                </>
              )}
            </div>
          ) : null}

          {isWorkspaceDatabase ? (
            <BuiltinDataSourceForm
              onOpenChange={onOpenChange}
              onProvisioned={onProvisioned}
              builtinAnalystExists={builtinAnalystExists}
              active={active}
              dialogOpen={dialogOpen}
            />
          ) : database ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="int-name">Display name</Label>
                <Input
                  id="int-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sales Postgres"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="int-slug">Slug</Label>
                <Input
                  id="int-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value);
                  }}
                  placeholder="sales-postgres"
                  aria-invalid={slugError ? true : undefined}
                />
                {slugError ? (
                  <p className="text-xs text-destructive">{slugError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Broker route segment:{" "}
                    <code className="font-mono">
                      /mcp/analyst/{trimmedSlug || "…"}
                    </code>
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {errorMsg ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : null}

          {!isWorkspaceDatabase ? (
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={onSubmit} disabled={!canSubmit}>
                {submitting ? "Registering…" : "Register data source"}
              </Button>
            </DialogFooter>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Prettify a raw database name into a display name (e.g. sales_prod → Sales Prod).
function prettifyDatabaseName(dbName: string): string {
  return dbName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function BuiltinDataSourceForm({
  onOpenChange,
  onProvisioned,
  builtinAnalystExists,
  active,
  dialogOpen,
}: {
  onOpenChange: (open: boolean) => void;
  onProvisioned: () => void;
  builtinAnalystExists: boolean;
  active: boolean;
  dialogOpen: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<AnalystProvisionOutcome | null>(null);
  const [, provisionAnalystConnector] = useMutation(
    SettingsProvisionAnalystConnectorMutation,
  );

  // Reset when the dialog reopens or the caller switches back to this tab.
  useEffect(() => {
    if (dialogOpen && active) {
      setErrorMsg(null);
      setResult(null);
      setSubmitting(false);
    }
  }, [dialogOpen, active]);

  const primaryLabel = builtinAnalystExists
    ? "Refresh data source"
    : "Provision data source";

  async function onConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const response = await provisionAnalystConnector({
        reApprove: false,
        rotateToken: false,
      });
      if (response.error) {
        setErrorMsg(graphqlErrorMessage(response.error));
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
    <div className="space-y-4 py-2">
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-500">Data source provisioned.</p>
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
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            The built-in <code className="font-mono">postgres-dev</code>{" "}
            cluster. This provisions:
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
          {builtinAnalystExists ? (
            <p className="text-xs text-muted-foreground">
              Already provisioned — refreshing re-runs provisioning
              idempotently. Re-approve and broker-token rotation live on the
              connector&apos;s detail page.
            </p>
          ) : null}
        </div>
      )}
      {errorMsg ? <p className="text-sm text-destructive">{errorMsg}</p> : null}
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {result ? "Close" : "Cancel"}
        </Button>
        {result ? null : (
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? "Provisioning…" : primaryLabel}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

function ExternalDataSourceForm({
  onOpenChange,
  onProvisioned,
  active,
  dialogOpen,
}: {
  onOpenChange: (open: boolean) => void;
  onProvisioned: () => void;
  active: boolean;
  dialogOpen: boolean;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  // THINK-283: exactly one schema per source; `public` is the legacy default.
  const [schema, setSchema] = useState("public");
  const [dbUser, setDbUser] = useState("");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState<AnalystDataSourceTls>(
    AnalystDataSourceTls.VerifyFull,
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<AnalystRegisterOutcome | null>(null);
  const [, registerAnalystDataSource] = useMutation(
    SettingsRegisterAnalystDataSourceMutation,
  );

  // Reset the form when the dialog reopens or the caller switches to this tab.
  useEffect(() => {
    if (dialogOpen && active) {
      setName("");
      setSlug("");
      setSlugEdited(false);
      setHost("");
      setPort("5432");
      setDatabase("");
      setSchema("public");
      setDbUser("");
      setPassword("");
      setTls(AnalystDataSourceTls.VerifyFull);
      setErrorMsg(null);
      setResult(null);
      setSubmitting(false);
    }
  }, [dialogOpen, active]);

  const trimmedSlug = slug.trim();
  const slugFormatValid = ANALYST_SLUG_PATTERN.test(trimmedSlug);
  const slugReserved = trimmedSlug === RESERVED_ANALYST_SLUG;
  const slugError = !trimmedSlug
    ? null
    : slugReserved
      ? `"${RESERVED_ANALYST_SLUG}" is reserved for the built-in data source — choose another.`
      : !slugFormatValid
        ? "Use 1–39 chars: lowercase letters, digits and hyphens, starting with a letter or digit."
        : null;

  const portNumber = Number.parseInt(port, 10);
  const portValid = Number.isInteger(portNumber) && portNumber > 0;

  const canSubmit =
    name.trim().length > 0 &&
    trimmedSlug.length > 0 &&
    slugFormatValid &&
    !slugReserved &&
    host.trim().length > 0 &&
    portValid &&
    database.trim().length > 0 &&
    schema.trim().length > 0 &&
    dbUser.trim().length > 0 &&
    password.length > 0 &&
    !submitting;

  function onNameChange(value: string) {
    setName(value);
    if (!slugEdited) setSlug(suggestAnalystSlug(value));
  }

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const response = await registerAnalystDataSource({
        input: {
          name: name.trim(),
          slug: trimmedSlug,
          host: host.trim(),
          port: portNumber,
          database: database.trim(),
          schema: schema.trim(),
          dbUser: dbUser.trim(),
          password,
          tls,
        },
      });
      if (response.error) {
        setErrorMsg(graphqlErrorMessage(response.error));
        return;
      }
      const outcome = response.data?.registerAnalystDataSource;
      if (!outcome) {
        setErrorMsg("Registration returned no result.");
        return;
      }
      // Drop the password from state as soon as the request succeeds — the
      // backend never echoes it back and we never re-render it.
      setPassword("");
      setResult(outcome);
      onProvisioned();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to register");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4 py-2">
        <p className="text-sm text-emerald-500">Data source registered.</p>
        <dl className="divide-y divide-border rounded-md border border-border text-sm">
          <ProvisionResultRow label="Slug" value={result.slug} />
          <ProvisionResultRow label="Tables" value={`${result.tables}`} />
          <ProvisionResultRow
            label="Connection folders"
            value={`${result.foldersWritten} written · ${result.foldersSkipped} skipped`}
          />
        </dl>
        <p className="font-mono text-xs text-muted-foreground">
          {result.serverId}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground">
        Register an external PostgreSQL database. The credential must be a
        read-only (SELECT-only) role provisioned by your DBA — registration
        connects with it, verifies the posture, and introspects the granted
        tables.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ext-name">Display name</Label>
          <Input
            id="ext-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Sales Postgres"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ext-slug">Slug</Label>
          <Input
            id="ext-slug"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
            placeholder="sales-postgres"
            aria-invalid={slugError ? true : undefined}
          />
          {slugError ? (
            <p className="text-xs text-destructive">{slugError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Broker route segment:{" "}
              <code className="font-mono">
                /mcp/analyst/{trimmedSlug || "…"}
              </code>
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ext-host">Host</Label>
          <Input
            id="ext-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="db.internal.example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ext-port">Port</Label>
          <Input
            id="ext-port"
            value={port}
            inputMode="numeric"
            onChange={(e) => setPort(e.target.value)}
            placeholder="5432"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ext-database">Database</Label>
          <Input
            id="ext-database"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="sales"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ext-schema">Schema</Label>
          <Input
            id="ext-schema"
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            placeholder="public"
          />
          <p className="text-xs text-muted-foreground">
            The source is scoped to exactly this schema&apos;s current tables
            (exact case). The credential is validated against it on
            registration.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ext-dbuser">DB user</Label>
          <Input
            id="ext-dbuser"
            value={dbUser}
            onChange={(e) => setDbUser(e.target.value)}
            placeholder="analyst_reader"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ext-password">Password</Label>
          <Input
            id="ext-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ext-tls">TLS mode</Label>
          <Select
            value={tls}
            onValueChange={(v) => setTls(v as AnalystDataSourceTls)}
          >
            <SelectTrigger id="ext-tls">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AnalystDataSourceTls.VerifyFull}>
                Verify full
              </SelectItem>
              <SelectItem value={AnalystDataSourceTls.Required}>
                Required
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {errorMsg ? <p className="text-sm text-destructive">{errorMsg}</p> : null}
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={!canSubmit}>
          {submitting ? "Registering…" : "Register data source"}
        </Button>
      </DialogFooter>
    </div>
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

// THINK-239: the built-in analyst connector is the `postgres-dev` slug (or a URL
// whose path ends exactly in `/mcp/analyst`). External sources register under
// `/mcp/analyst/<slug>` and are ordinary rows, so they must NOT match here.
function isBuiltinAnalystServer(server: McpServer): boolean {
  if (server.slug === RESERVED_ANALYST_SLUG) return true;
  try {
    const pathname = new URL(server.url).pathname.replace(/\/+$/, "");
    return pathname.endsWith("/mcp/analyst");
  } catch {
    return server.url.replace(/\/+$/, "").endsWith("/mcp/analyst");
  }
}

// THINK-239: an analyst connector row — the builtin workspace connector or a
// registered source. The server list stamps `dataSource` on these; the URL
// check keeps stale rows (pre-dataSource caches) classified correctly.
function isAnalystDataSourceServer(server: McpServer): boolean {
  if (server.dataSource) return true;
  if (isBuiltinAnalystServer(server)) return true;
  try {
    const pathname = new URL(server.url).pathname.replace(/\/+$/, "");
    return /\/mcp\/analyst\/[^/]+$/.test(pathname);
  } catch {
    return /\/mcp\/analyst\/[^/]+\/?$/.test(server.url);
  }
}

function McpServerSection({
  title,
  columns,
  servers,
  search,
  emptyText,
  onOpen,
  fitContent,
}: {
  title?: string;
  columns: ColumnDef<McpServer>[];
  servers: McpServer[];
  search: string;
  emptyText: string;
  onOpen: (serverId: string) => void;
  /** Auto table layout so w-px/whitespace-nowrap columns hug their content
   *  (fixed layout would collapse them to 1px). */
  fitContent?: boolean;
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
        tableClassName={fitContent ? "table-auto" : "table-fixed"}
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
