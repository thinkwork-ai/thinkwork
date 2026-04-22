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
} from "lucide-react";
import { AgentDetailQuery, SetAgentSkillsMutation } from "@/lib/graphql-queries";
import { useAuth } from "@/context/AuthContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageLayout } from "@/components/PageLayout";
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
  listCatalog,
  installSkillToAgent,
  saveSkillCredentials,
  type CatalogSkill,
} from "@/lib/skills-api";

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId_/skills")({
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

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const skillColumns: ColumnDef<SkillRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    size: 200,
    cell: ({ row }) => (
      <span className="font-medium whitespace-nowrap pl-3">{row.original.name}</span>
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
    async (s: {
      skillId: string;
      enabled: boolean;
      config?: any;
      permissions?: any;
    }[]) => {
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
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  useEffect(() => {
    listCatalog().then(setCatalog).catch(console.error);
  }, []);
  const catalogMap = new Map(catalog.map((s) => [s.slug, s]));
  const availableSkills = catalog.filter((s) => !items.some((i) => i.skillId === s.slug));

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
      const newItems = [...items, { skillId: slug, enabled: true, config: initialConfig, permissions: undefined }];
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
          Object.fromEntries(meta.requires_env.map((f) => [f, defaults[f] || ""])),
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
      setCredValues(Object.fromEntries(fields.map((f) => [f, defaults[f] || ""])));
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
  const credDialogMeta = credDialogSkill ? catalogMap.get(credDialogSkill) : null;
  const isOAuthSkill = !!credDialogMeta?.oauth_provider;
  const credDialogFields =
    credDialogSkill && !isOAuthSkill ? credDialogMeta?.requires_env || [] : [];
  const skillItem = credDialogSkill
    ? items.find((s) => s.skillId === credDialogSkill)
    : null;
  const hasConnection = !!(skillItem?.config as Record<string, unknown>)?.connectionId;

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
          <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Skill
          </Button>
        </div>
      }
    >
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
                    <span className="text-sm font-medium">Account connected</span>
                  </div>
                ) : oauthConnected ? (
                  <div className="flex items-center gap-2 text-green-500">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium">Successfully connected!</span>
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
                      setCredValues((prev) => ({ ...prev, [field]: e.target.value }))
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
                      <span className="text-sm text-muted-foreground">Remove skill?</span>
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
