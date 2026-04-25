import { useState, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  XCircle,
  Plus,
  ChevronRight,
  Loader2,
  ExternalLink,
  Shield,
} from "lucide-react";
import {
  AgentDetailQuery,
  SetAgentCapabilitiesMutation,
  SetAgentSkillsMutation,
} from "@/lib/graphql-queries";
import { useAuth } from "@/context/AuthContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageLayout } from "@/components/PageLayout";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  listCatalog,
  getCatalogSkill,
  installSkillToAgent,
  saveSkillCredentials,
  type CatalogSkill,
} from "@/lib/skills-api";
import {
  PermissionsEditor,
  resolveAgentSaveValue,
  type SkillOperation,
} from "@/components/skills/PermissionsEditor";

type SkillManifestMeta = {
  permissions_model?: "operations";
  scripts?: Array<{
    name: string;
    path: string;
    description?: string;
    default_enabled?: boolean;
  }>;
};

export const Route = createFileRoute(
  "/_authed/_tenant/agents/$agentId_/skills",
)({
  component: AgentSkillsPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SkillRow = {
  skillId: string;
  enabled: boolean;
  name: string;
  description: string;
  configured: boolean;
  needsConfig: boolean;
};

type AgentCapabilityRow = {
  capability: string;
  enabled: boolean;
  config?: unknown;
};

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const skillColumns: ColumnDef<SkillRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    size: 200,
    cell: ({ row }) => (
      <span className="font-medium whitespace-nowrap pl-3">
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => (
      <div className="text-muted-foreground text-sm truncate overflow-hidden">
        {row.original.description}
      </div>
    ),
  },
  {
    accessorKey: "enabled",
    header: () => <div className="text-center">Status</div>,
    cell: ({ row }) => (
      <div className="flex justify-center">
        <Badge
          variant="secondary"
          className={`text-xs gap-1 ${row.original.enabled ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
        >
          {row.original.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>
    ),
    size: 110,
  },
  {
    accessorKey: "configured",
    header: () => <div className="text-center">Config</div>,
    cell: ({ row }) => (
      <div className="flex justify-center">
        {!row.original.needsConfig ? null : row.original.configured ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    ),
    size: 80,
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const API_URL = import.meta.env.VITE_API_URL || "";

function AgentSkillsPage() {
  const { agentId } = Route.useParams();
  const { tenant } = useTenant();
  const { user } = useAuth();

  const [result, reexecute] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });

  const [, setSkillsMut] = useMutation(SetAgentSkillsMutation);
  const [, setCapabilitiesMut] = useMutation(SetAgentCapabilitiesMutation);
  const agent = result.data?.agent;
  const skills = (agent?.skills ?? []) as readonly {
    id: string;
    skillId: string;
    enabled: boolean;
    config?: any;
    permissions?: any;
  }[];

  const refresh = useCallback(() => {
    reexecute({ requestPolicy: "network-only" });
  }, [reexecute]);

  // R11 round-trip fix: thread `permissions` through every load + save
  // touchpoint so saving an unrelated change (toggling enabled,
  // editing config) doesn't drop the jsonb on the wire. Paired with
  // the defensive `undefined` guard in setAgentSkills (Phase 2a) to
  // make mobile's deferred SetAgentSkills fix safe in the meantime.
  const [items, setItems] = useState(
    skills.map((s) => ({
      skillId: s.skillId,
      enabled: s.enabled,
      config: s.config,
      permissions: s.permissions,
    })),
  );

  useEffect(() => {
    setItems(
      skills.map((s) => ({
        skillId: s.skillId,
        enabled: s.enabled,
        config: s.config,
        permissions: s.permissions,
      })),
    );
  }, [skills]);

  const normalizeForSave = (list: typeof items) =>
    list.map((s) => ({
      skillId: s.skillId,
      enabled: s.enabled,
      config:
        typeof s.config === "string"
          ? s.config
          : s.config
            ? JSON.stringify(s.config)
            : undefined,
      // AWSJSON round-trip — stringify on save, parse on load. Omit
      // entirely when the row has no permissions so the resolver's
      // defensive guard preserves the existing jsonb.
      permissions:
        s.permissions === null || s.permissions === undefined
          ? undefined
          : typeof s.permissions === "string"
            ? s.permissions
            : JSON.stringify(s.permissions),
    }));

  const handleSaveSkills = useCallback(
    async (
      s: {
        skillId: string;
        enabled: boolean;
        config?: any;
        permissions?: any;
      }[],
    ) => {
      const res = await setSkillsMut({
        agentId,
        skills: s.map((sk) => ({
          skillId: sk.skillId,
          enabled: sk.enabled,
          config:
            typeof sk.config === "string"
              ? sk.config
              : sk.config
                ? JSON.stringify(sk.config)
                : undefined,
          permissions:
            sk.permissions === null || sk.permissions === undefined
              ? undefined
              : typeof sk.permissions === "string"
                ? sk.permissions
                : JSON.stringify(sk.permissions),
        })),
      });
      if (!res.error) refresh();
    },
    [agentId, setSkillsMut, refresh],
  );

  // Catalog
  // Phase 4 / Unit 9: per-skill manifest metadata for permissions UI.
  const [manifestMetaCache, setManifestMetaCache] = useState<
    Record<string, SkillManifestMeta>
  >({});
  const [permissionsDialogSlug, setPermissionsDialogSlug] = useState<
    string | null
  >(null);

  // Template skills blob for the ceiling. AgentDetailQuery's agentTemplate
  // now includes `skills` (per Phase 3 / Unit 7 plumbing). Parse once.
  const templateSkills: Array<Record<string, unknown>> = (() => {
    const raw = (agent?.agentTemplate as { skills?: unknown })?.skills;
    if (!raw) return [];
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const templateBrowserEnabled = (() => {
    const raw = (agent?.agentTemplate as { browser?: unknown })?.browser;
    if (!raw) return false;
    try {
      const browser = typeof raw === "string" ? JSON.parse(raw) : raw;
      return !!(
        browser &&
        typeof browser === "object" &&
        !Array.isArray(browser) &&
        (browser as { enabled?: unknown }).enabled === true
      );
    } catch {
      return false;
    }
  })();
  const agentCapabilities = (agent?.capabilities ?? []) as AgentCapabilityRow[];
  const browserCapability = agentCapabilities.find(
    (c) => c.capability === "browser_automation",
  );
  const browserOverrideEnabled = browserCapability?.enabled ?? null;
  const effectiveBrowserEnabled =
    browserOverrideEnabled === null
      ? templateBrowserEnabled
      : browserOverrideEnabled;

  const saveBrowserOverride = useCallback(
    async (enabled: boolean | null) => {
      const existing = agentCapabilities
        .filter((c) => c.capability !== "browser_automation")
        .map((c) => ({
          capability: c.capability,
          enabled: c.enabled,
          config:
            c.config === null || c.config === undefined
              ? undefined
              : typeof c.config === "string"
                ? c.config
                : JSON.stringify(c.config),
        }));
      const capabilities =
        enabled === null
          ? existing
          : [
              ...existing,
              {
                capability: "browser_automation",
                enabled,
                config: undefined,
              },
            ];
      const res = await setCapabilitiesMut({ agentId, capabilities });
      if (!res.error) refresh();
    },
    [agent?.capabilities, agentId, refresh, setCapabilitiesMut],
  );

  // Lazily fetch manifest details for any assigned skill we haven't cached.
  useEffect(() => {
    const missing = items
      .map((i) => i.skillId)
      .filter((slug) => !(slug in manifestMetaCache));
    if (missing.length === 0) return;
    let canceled = false;
    Promise.all(
      missing.map((slug) =>
        getCatalogSkill(slug)
          .then((p) => ({
            slug,
            meta: {
              permissions_model: (p as any).permissions_model,
              scripts: (p as any).scripts,
            } as SkillManifestMeta,
          }))
          .catch(() => ({ slug, meta: {} as SkillManifestMeta })),
      ),
    ).then((entries) => {
      if (canceled) return;
      setManifestMetaCache((prev) => {
        const next = { ...prev };
        for (const { slug, meta } of entries) next[slug] = meta;
        return next;
      });
    });
    return () => {
      canceled = true;
    };
  }, [items, manifestMetaCache]);

  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  useEffect(() => {
    listCatalog().then(setCatalog).catch(console.error);
  }, []);
  const catalogMap = new Map(catalog.map((s) => [s.slug, s]));
  const availableSkills = catalog.filter(
    (s) => !items.some((i) => i.skillId === s.slug),
  );

  // Add Skill dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addingSlug, setAddingSlug] = useState<string | null>(null);

  // Edit / Credential dialog
  const [credDialogSkill, setCredDialogSkill] = useState<string | null>(null);
  const [credIsEdit, setCredIsEdit] = useState(false);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [credSaving, setCredSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // OAuth
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "oauth_complete") {
        const { connectionId, skillId: connectedSkillId } = event.data;
        setOauthConnecting(false);
        setOauthConnected(true);
        if (connectedSkillId && connectionId) {
          setItems((prev) =>
            prev.map((s) =>
              s.skillId === connectedSkillId
                ? {
                    ...s,
                    config: {
                      ...((s.config as Record<string, unknown>) || {}),
                      connectionId,
                    },
                  }
                : s,
            ),
          );
        }
        refresh();
        setTimeout(() => {
          setCredDialogSkill(null);
          setOauthConnected(false);
        }, 1500);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [refresh]);

  // ---- Handlers ----

  const handleAddSkill = async (slug: string) => {
    if (!tenant?.slug) return;
    setAddingSlug(slug);
    try {
      await installSkillToAgent(tenant.slug, agent?.slug ?? "", slug);
      const meta_ = catalogMap.get(slug);
      const initialConfig = meta_?.mcp_server
        ? JSON.stringify({ mcpServer: meta_.mcp_server, skillType: slug })
        : null;
      // Permissions intentionally omitted on add — agent starts inheriting
      // from the template. The Phase 4 UI is where operators author an
      // agent-level override; until then, null permissions means "use
      // whatever the template has for this skill." Resolver's defensive
      // guard in setAgentSkills preserves any existing jsonb on write.
      const newItems = [
        ...items,
        {
          skillId: slug,
          enabled: true,
          config: initialConfig,
          permissions: undefined,
        },
      ];
      setItems(newItems);
      await handleSaveSkills(normalizeForSave(newItems));
      setAddDialogOpen(false);

      const meta = catalogMap.get(slug);
      if (meta?.oauth_provider) {
        setCredIsEdit(false);
        setCredDialogSkill(slug);
      } else if (meta?.requires_env && meta.requires_env.length > 0) {
        const defaults = meta.env_defaults || {};
        setCredValues(
          Object.fromEntries(
            meta.requires_env.map((f) => [f, defaults[f] || ""]),
          ),
        );
        setCredIsEdit(false);
        setCredDialogSkill(slug);
      }
    } catch (err) {
      console.error("Failed to add skill:", err);
    } finally {
      setAddingSlug(null);
    }
  };

  const openCredDialog = (skillId: string) => {
    const meta = catalogMap.get(skillId);
    if (!meta?.oauth_provider) {
      const fields = meta?.requires_env || [];
      const defaults = meta?.env_defaults || {};
      setCredValues(
        Object.fromEntries(fields.map((f) => [f, defaults[f] || ""])),
      );
    }
    setOauthConnecting(false);
    setOauthConnected(false);
    setCredIsEdit(true);
    setConfirmDelete(false);
    setCredDialogSkill(skillId);
  };

  const handleSaveCreds = async () => {
    if (!credDialogSkill) return;
    setCredSaving(true);
    try {
      await saveSkillCredentials(agentId, credDialogSkill, credValues);
      setCredDialogSkill(null);
    } catch (err) {
      console.error("Failed to save credentials:", err);
    } finally {
      setCredSaving(false);
    }
  };

  const handleDeleteSkill = async () => {
    if (!credDialogSkill) return;
    setDeleting(true);
    try {
      const newItems = items.filter((s) => s.skillId !== credDialogSkill);
      setItems(newItems);
      await handleSaveSkills(normalizeForSave(newItems));
      setCredDialogSkill(null);
      setConfirmDelete(false);
    } catch (err) {
      console.error("Failed to delete skill:", err);
    } finally {
      setDeleting(false);
    }
  };

  // Derived dialog state
  const credDialogMeta = credDialogSkill
    ? catalogMap.get(credDialogSkill)
    : null;
  const isOAuthSkill = !!credDialogMeta?.oauth_provider;
  const credDialogFields =
    credDialogSkill && !isOAuthSkill ? credDialogMeta?.requires_env || [] : [];
  const skillItem = credDialogSkill
    ? items.find((s) => s.skillId === credDialogSkill)
    : null;
  const hasConnection = !!(skillItem?.config as Record<string, unknown>)
    ?.connectionId;

  const oauthUrl = (() => {
    if (!credDialogSkill || !tenant?.id || !user?.sub) return null;
    const meta = catalogMap.get(credDialogSkill);
    if (!meta?.oauth_provider) return null;
    const scopes = meta.oauth_scopes?.join(",") || "";
    return `${API_URL}/api/oauth/authorize?provider=${meta.oauth_provider}&scopes=${scopes}&userId=${user.sub}&tenantId=${tenant.id}&agentId=${agentId}&skillId=${credDialogSkill}`;
  })();

  // Table data
  const tableData: SkillRow[] = items.map((s) => {
    const meta = catalogMap.get(s.skillId);
    let cfg: Record<string, unknown> = {};
    try {
      let parsed = s.config;
      while (typeof parsed === "string") parsed = JSON.parse(parsed);
      cfg = (parsed as Record<string, unknown>) || {};
    } catch {
      /* invalid JSON */
    }
    const needsConfig = !!(meta?.oauth_provider || meta?.requires_env?.length);
    const isConfigured = needsConfig
      ? !!(cfg.connectionId || cfg.secretRef)
      : true;
    return {
      skillId: s.skillId,
      enabled: s.enabled,
      name: meta?.name ?? s.skillId,
      description: meta?.description ?? "",
      configured: isConfigured,
      needsConfig,
    };
  });

  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: agent?.name ?? "...", href: `/agents/${agentId}` },
    { label: "Skills" },
  ]);

  if (result.fetching && !result.data) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <div className="flex items-center justify-between w-full">
          <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
            Skills
          </h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Skill
          </Button>
        </div>
      }
    >
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">Browser Automation</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={`text-xs ${
                  effectiveBrowserEnabled
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {effectiveBrowserEnabled ? "Enabled" : "Disabled"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {browserOverrideEnabled === null
                  ? "Template default"
                  : "Agent override"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              AgentCore Browser + Nova Act for dynamic website workflows. The
              template default can be overridden for this agent.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {browserOverrideEnabled !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void saveBrowserOverride(null)}
              >
                Inherit
              </Button>
            ) : null}
            <Switch
              id="browser-agent-override"
              checked={effectiveBrowserEnabled}
              onCheckedChange={(checked) => void saveBrowserOverride(checked)}
            />
          </div>
        </CardContent>
      </Card>

      {tableData.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No skills assigned to this agent.
        </p>
      ) : (
        <DataTable
          columns={skillColumns}
          data={tableData}
          pageSize={0}
          tableClassName="table-fixed"
          onRowClick={(row) => openCredDialog(row.skillId)}
        />
      )}

      {/* Operation permissions — per Unit 9 of the permissions UI plan.
          Shows only for assigned skills whose manifest declares
          permissions_model: operations. Each row surfaces the effective
          state (inheriting / explicit count) and opens the PermissionsEditor
          dialog on edit. Ceiling is sourced from agentTemplate.skills. */}
      <AgentPermissionsSection
        items={items}
        catalogMap={catalogMap}
        manifestMetaCache={manifestMetaCache}
        templateSkills={templateSkills}
        onRequestEdit={(slug) => setPermissionsDialogSlug(slug)}
      />
      <AgentPermissionsDialog
        slug={permissionsDialogSlug}
        meta={
          permissionsDialogSlug
            ? manifestMetaCache[permissionsDialogSlug]
            : undefined
        }
        ceiling={
          permissionsDialogSlug
            ? resolveTemplatePermissions(templateSkills, permissionsDialogSlug)
            : null
        }
        initialValue={
          permissionsDialogSlug
            ? parseAgentPermissions(
                items.find((i) => i.skillId === permissionsDialogSlug)
                  ?.permissions,
              )
            : null
        }
        onClose={() => setPermissionsDialogSlug(null)}
        onSave={(next) => {
          if (!permissionsDialogSlug) return;
          const newItems = items.map((i) =>
            i.skillId !== permissionsDialogSlug
              ? i
              : {
                  ...i,
                  permissions: next === null ? undefined : { operations: next },
                },
          );
          setItems(newItems);
          handleSaveSkills(newItems);
          setPermissionsDialogSlug(null);
        }}
      />

      {/* Add Skill dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Skill</DialogTitle>
            <DialogDescription>
              Select a skill to add to this agent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 max-h-[400px] overflow-y-auto -mx-2">
            {availableSkills.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                All available skills are already assigned.
              </p>
            ) : (
              availableSkills.map((skill) => (
                <button
                  key={skill.slug}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent rounded-md transition-colors disabled:opacity-50"
                  onClick={() => handleAddSkill(skill.slug)}
                  disabled={addingSlug === skill.slug}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{skill.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {skill.description}
                    </p>
                  </div>
                  {addingSlug === skill.slug ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0 ml-3" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground ml-3" />
                  )}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit / Credential / OAuth dialog */}
      <Dialog
        open={!!credDialogSkill}
        onOpenChange={(open) => {
          if (!open) {
            setCredDialogSkill(null);
            setConfirmDelete(false);
            setOauthConnecting(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isOAuthSkill ? "Connect Account" : "Configure Credentials"}
            </DialogTitle>
            <DialogDescription>
              {isOAuthSkill
                ? `Connect your ${credDialogMeta?.name || credDialogSkill} account to enable this skill.`
                : `Enter the environment variables required by ${credDialogMeta?.name || credDialogSkill}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {isOAuthSkill ? (
              <div className="flex flex-col items-center gap-4 py-4">
                {hasConnection ? (
                  <div className="flex items-center gap-2 text-green-500">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium">
                      Account connected
                    </span>
                  </div>
                ) : oauthConnected ? (
                  <div className="flex items-center gap-2 text-green-500">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium">
                      Successfully connected!
                    </span>
                  </div>
                ) : oauthConnecting ? (
                  <Button disabled size="lg">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Waiting for authorization...
                  </Button>
                ) : (
                  <a
                    href={oauthUrl || "#"}
                    target="oauth_popup"
                    rel="noopener"
                    onClick={(e) => {
                      e.preventDefault();
                      if (!oauthUrl) return;
                      setOauthConnecting(true);
                      window.open(
                        oauthUrl,
                        "oauth_popup",
                        "width=600,height=700,left=200,top=100",
                      );
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {`Sign in with ${credDialogMeta?.oauth_provider === "google_productivity" ? "Google" : credDialogMeta?.oauth_provider === "microsoft_365" ? "Microsoft" : credDialogMeta?.oauth_provider === "lastmile" ? "LastMile" : "Provider"}`}
                  </a>
                )}
                {oauthConnecting && (
                  <p className="text-xs text-muted-foreground text-center">
                    Complete the sign-in in the popup window.
                  </p>
                )}
              </div>
            ) : (
              credDialogFields.map((field) => (
                <div key={field} className="space-y-1">
                  <Label htmlFor={field} className="text-xs font-mono">
                    {field}
                  </Label>
                  <Input
                    id={field}
                    type={
                      field.toLowerCase().includes("password") ||
                      field.toLowerCase().includes("secret")
                        ? "password"
                        : "text"
                    }
                    value={credValues[field] || ""}
                    onChange={(e) =>
                      setCredValues((prev) => ({
                        ...prev,
                        [field]: e.target.value,
                      }))
                    }
                    placeholder={field}
                  />
                </div>
              ))
            )}
            <div className="flex items-center pt-2">
              {credIsEdit && (
                <div className="flex-1">
                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        Remove skill?
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteSkill}
                        disabled={deleting}
                      >
                        {deleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Confirm"
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
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
                      Remove Skill
                    </Button>
                  )}
                </div>
              )}
              <div className="flex gap-2 ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCredDialogSkill(null)}
                  disabled={credSaving}
                >
                  {isOAuthSkill ? "Close" : "Cancel"}
                </Button>
                {!isOAuthSkill && (
                  <Button
                    size="sm"
                    onClick={handleSaveCreds}
                    disabled={
                      credSaving || credDialogFields.some((f) => !credValues[f])
                    }
                  >
                    {credSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Save Credentials"
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

// ---------------------------------------------------------------------------
// Unit 9 — Permissions section + dialog
// ---------------------------------------------------------------------------

function AgentPermissionsSection({
  items,
  catalogMap,
  manifestMetaCache,
  templateSkills,
  onRequestEdit,
}: {
  items: Array<{ skillId: string; permissions?: unknown }>;
  catalogMap: Map<string, CatalogSkill>;
  manifestMetaCache: Record<string, SkillManifestMeta>;
  templateSkills: Array<Record<string, unknown>>;
  onRequestEdit: (slug: string) => void;
}) {
  const opsSkills = items.filter((i) => {
    const meta = manifestMetaCache[i.skillId];
    return meta?.permissions_model === "operations";
  });
  if (opsSkills.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Operation permissions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {opsSkills.map((i) => {
          const meta = catalogMap.get(i.skillId);
          const explicit = parseAgentPermissions(i.permissions);
          const ceiling = resolveTemplatePermissions(templateSkills, i.skillId);
          const isInheriting = explicit === null;
          const effectiveCount = isInheriting
            ? (ceiling?.length ?? 0)
            : explicit.length;
          return (
            <div
              key={i.skillId}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{meta?.name ?? i.skillId}</div>
                <div className="text-xs text-muted-foreground">
                  {effectiveCount} op{effectiveCount === 1 ? "" : "s"} enabled
                  {isInheriting && " (inherited)"}
                  {effectiveCount === 0 && (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">
                      — agent cannot use this skill
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRequestEdit(i.skillId)}
              >
                <Shield className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AgentPermissionsDialog({
  slug,
  meta,
  ceiling,
  initialValue,
  onClose,
  onSave,
}: {
  slug: string | null;
  meta?: SkillManifestMeta;
  ceiling: string[] | null;
  initialValue: string[] | null;
  onClose: () => void;
  onSave: (next: string[] | null) => void;
}) {
  const open = slug !== null;
  const [workingValue, setWorkingValue] = useState<string[] | null>(
    initialValue,
  );
  useEffect(() => {
    setWorkingValue(initialValue);
  }, [initialValue, slug]);

  const scripts = meta?.scripts ?? [];
  const ops: SkillOperation[] = scripts.map((s) => ({
    name: s.name,
    path: s.path,
    description: s.description,
    default_enabled: s.default_enabled,
  }));

  const handleSave = () => {
    // Dirty-diff: collapse explicit-equal-to-ceiling back to null so the
    // agent stays inheriting and picks up future template widenings.
    const toSave = resolveAgentSaveValue({
      loaded: initialValue,
      current: workingValue,
      ceiling,
    });
    onSave(toSave);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agent permissions — {slug}</DialogTitle>
          <DialogDescription>
            Narrow which operations this agent may call. Ops outside the
            template's ceiling are disabled. Click Reset to return the agent to
            inheriting the template's full list.
          </DialogDescription>
        </DialogHeader>

        {ceiling === null ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            This skill is not authorized at the template level — contact your
            template administrator to author permissions there first.
          </div>
        ) : ops.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">
            No operations available for this skill.
          </div>
        ) : (
          <PermissionsEditor
            mode="agent"
            ops={ops}
            ceiling={ceiling}
            value={workingValue}
            onChange={setWorkingValue}
          />
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={ceiling === null}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Read the template's permissions.operations for a given skill_id from
 * the template's skills jsonb array. Returns null when the template has
 * no entry OR the entry lacks explicit permissions — in either case the
 * agent has no ceiling and cannot author an override.
 */
function resolveTemplatePermissions(
  templateSkills: Array<Record<string, unknown>>,
  skillId: string,
): string[] | null {
  const entry = templateSkills.find((s) => s?.skill_id === skillId);
  if (!entry) return null;
  const perms = entry.permissions;
  if (!perms || typeof perms !== "object" || Array.isArray(perms)) return null;
  const ops = (perms as Record<string, unknown>).operations;
  if (!Array.isArray(ops)) return null;
  return ops.filter((o): o is string => typeof o === "string");
}

/**
 * Parse the agent's stored permissions.operations — returns `null` when
 * the agent is inheriting (no explicit jsonb or missing `operations` key)
 * and an explicit array otherwise.
 */
function parseAgentPermissions(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null;
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ops = (value as Record<string, unknown>).operations;
  if (!Array.isArray(ops)) return null;
  return ops.filter((o): o is string => typeof o === "string");
}
