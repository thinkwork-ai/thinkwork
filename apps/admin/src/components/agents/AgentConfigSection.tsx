import { useState, useEffect, useCallback } from "react";
import {
  Pencil,
  Loader2,
  ChevronRight,
  Plus,
  Wand2,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTenant } from "@/context/TenantContext";
import {
  listCatalog,
  installSkill,
  installSkillToAgent,
  saveSkillCredentials,
  type CatalogSkill,
} from "@/lib/skills-api";

// ---------------------------------------------------------------------------
// Workspace Files Card
// ---------------------------------------------------------------------------

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

const WORKSPACE_FILE_DESCRIPTIONS: Record<string, string> = {
  "SOUL.md": "Core personality, values, and behavioral guidelines",
  "USER.md": "What the assistant knows about you",
  "IDENTITY.md": "Name, role, and persona definition",
  "AGENTS.md": "Multi-agent collaboration rules",
  "TOOLS.md": "Tool usage preferences and instructions",
};

async function workspaceApi(body: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/internal/workspace-files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Workspace API: ${res.status}`);
  return res.json();
}

export function WorkspaceFilesCard({ tenantSlug, instanceId }: { tenantSlug: string; instanceId: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [generating, setGenerating] = useState(false);

  // List workspace files from S3
  useEffect(() => {
    if (!tenantSlug || !instanceId) return;
    setLoadingFiles(true);
    workspaceApi({ action: "list", tenantSlug, instanceId })
      .then((data) => setFiles(data.files ?? []))
      .catch(console.error)
      .finally(() => setLoadingFiles(false));
  }, [tenantSlug, instanceId]);

  const handleOpen = async (fileName: string) => {
    setOpenFile(fileName);
    setEditing(false);
    if (!tenantSlug) return;
    setLoading(true);
    try {
      const data = await workspaceApi({ action: "get", tenantSlug, instanceId, path: fileName });
      setContent(data.content ?? "");
    } catch (err) {
      console.error("Failed to load workspace file:", err);
      setContent("");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = () => { setEditValue(content); setEditing(true); };

  const handleSave = async () => {
    if (!openFile || !tenantSlug) return;
    setSaving(true);
    try {
      await workspaceApi({ action: "put", tenantSlug, instanceId, path: openFile, content: editValue });
      setContent(editValue);
      setEditing(false);
    } catch (err) {
      console.error("Failed to save workspace file:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!tenantSlug) return;
    setGenerating(true);
    try {
      const defaults = ["SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md"];
      for (const name of defaults) {
        await workspaceApi({ action: "put", tenantSlug, instanceId, path: name, content: `# ${name.replace(".md", "")}\n\nEdit this file to configure your agent.\n` });
      }
      const data = await workspaceApi({ action: "list", tenantSlug, instanceId });
      setFiles(data.files ?? []);
    } catch (err) {
      console.error("Failed to generate workspace files:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Workspace</CardTitle>
          <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating || loadingFiles}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
            Generate
          </Button>
        </CardHeader>
        <CardContent className="space-y-1 p-0 pb-2">
          {loadingFiles ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : files.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-3">No files.</p>
          ) : (
            files.map((fileName) => (
              <button
                key={fileName}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent transition-colors"
                onClick={() => handleOpen(fileName)}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{fileName}</p>
                  {WORKSPACE_FILE_DESCRIPTIONS[fileName] && (
                    <p className="text-xs text-muted-foreground truncate">{WORKSPACE_FILE_DESCRIPTIONS[fileName]}</p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openFile} onOpenChange={(open) => { if (!open) { if (editing) return; setOpenFile(null); } }}>
        <DialogContent className="h-[90vh] flex flex-col" style={{ width: "90vw", maxWidth: 768 }} onPointerDownOutside={(e) => { if (editing) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (editing) e.preventDefault(); }}>
          <DialogHeader>
            <div className="flex items-center justify-between pr-8">
              <div>
                <DialogTitle>{openFile}</DialogTitle>
                {openFile && WORKSPACE_FILE_DESCRIPTIONS[openFile] && (
                  <DialogDescription>{WORKSPACE_FILE_DESCRIPTIONS[openFile]}</DialogDescription>
                )}
              </div>
              {!loading && !editing && (
                <Button variant="outline" size="sm" onClick={handleEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
              )}
              {!loading && editing && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                    Save
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : editing ? (
              <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="text-sm font-mono resize-none h-full" />
            ) : content ? (
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground font-mono bg-muted p-4 rounded-md">{content}</pre>
            ) : (
              <p className="text-sm text-muted-foreground italic py-8 text-center">No content yet. Click the edit button to add content.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Skills Panel
// ---------------------------------------------------------------------------

export function SkillsPanel({
  agentId,
  agentSlug,
  skills,
  onSave,
  onRefresh,
}: {
  agentId: string;
  agentSlug: string;
  skills: readonly { readonly id: string; readonly skillId: string; readonly enabled: boolean; readonly config?: any }[];
  onSave: (skills: { skillId: string; enabled: boolean; config?: any }[]) => Promise<void>;
  onRefresh?: () => void;
}) {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const [items, setItems] = useState(
    skills.map((s) => ({ skillId: s.skillId, enabled: s.enabled, config: s.config })),
  );
  const [catalogSkills, setCatalogSkills] = useState<CatalogSkill[]>([]);

  // Sync items when skills prop updates (e.g. after parent refresh)
  useEffect(() => {
    setItems(skills.map((s) => ({ skillId: s.skillId, enabled: s.enabled, config: s.config })));
  }, [skills]);

  // Add Skill dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addingSlug, setAddingSlug] = useState<string | null>(null);

  // Credential config state (step 2 of add flow, or edit existing)
  const [credDialogSkill, setCredDialogSkill] = useState<string | null>(null);
  const [credIsEdit, setCredIsEdit] = useState(false);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [credSaving, setCredSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // OAuth flow state
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);

  useEffect(() => {
    listCatalog().then(setCatalogSkills).catch(console.error);
  }, []);

  // Listen for OAuth popup completion
  const handleOAuthMessage = useCallback((event: MessageEvent) => {
    if (event.data?.type === "oauth_complete") {
      const { connectionId, skillId: connectedSkillId } = event.data;
      setOauthConnecting(false);
      setOauthConnected(true);

      // Optimistically update local state with connectionId
      if (connectedSkillId && connectionId) {
        setItems((prev) =>
          prev.map((s) =>
            s.skillId === connectedSkillId
              ? { ...s, config: { ...((s.config as Record<string, unknown>) || {}), connectionId } }
              : s,
          ),
        );
      }

      // Refresh parent to get full updated data from server
      onRefresh?.();

      // Close dialog after brief success display
      setTimeout(() => {
        setCredDialogSkill(null);
        setOauthConnected(false);
      }, 1500);
    }
  }, [onRefresh]);

  useEffect(() => {
    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [handleOAuthMessage]);

  const catalogMap = new Map(catalogSkills.map((s) => [s.slug, s]));
  const availableSkills = catalogSkills.filter((s) => !items.some((i) => i.skillId === s.slug));

  // Normalize config to JSON string for the mutation (AWSJSON expects string)
  const normalizeForSave = (list: typeof items) =>
    list.map((s) => ({
      skillId: s.skillId,
      enabled: s.enabled,
      config: typeof s.config === "string" ? s.config : s.config ? JSON.stringify(s.config) : undefined,
    }));

  const handleAddSkill = async (slug: string) => {
    if (!tenant?.slug) return;
    setAddingSlug(slug);
    try {
      await installSkillToAgent(tenant.slug, agentSlug, slug);
      const meta_ = catalogMap.get(slug);
      const initialConfig = meta_?.mcp_server ? JSON.stringify({ mcpServer: meta_.mcp_server, skillType: slug }) : null;
      const newItems = [...items, { skillId: slug, enabled: true, config: initialConfig }];
      setItems(newItems);
      await onSave(normalizeForSave(newItems));
      setAddDialogOpen(false);

      const meta = catalogMap.get(slug);
      if (meta?.oauth_provider) {
        // OAuth skill — open the OAuth connection dialog
        setCredIsEdit(false);
        setCredDialogSkill(slug);
      } else if (meta?.requires_env && meta.requires_env.length > 0) {
        // Manual credential skill — open credential dialog with defaults
        const defaults = meta.env_defaults || {};
        setCredValues(Object.fromEntries(meta.requires_env.map((f) => [f, defaults[f] || ""])));
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

  const oauthUrl = (() => {
    if (!credDialogSkill || !tenant?.id || !user?.sub) return null;
    const meta = catalogMap.get(credDialogSkill);
    if (!meta?.oauth_provider) return null;
    const scopes = meta.oauth_scopes?.join(",") || "";
    return `${API_URL}/api/oauth/authorize?provider=${meta.oauth_provider}&scopes=${scopes}&userId=${user.sub}&tenantId=${tenant.id}&agentId=${agentId}&skillId=${credDialogSkill}`;
  })();

  const handleStartOAuth = () => {
    if (!oauthUrl) return;
    setOauthConnecting(true);
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
      await onSave(normalizeForSave(newItems));
      setCredDialogSkill(null);
      setConfirmDelete(false);
    } catch (err) {
      console.error("Failed to delete skill:", err);
    } finally {
      setDeleting(false);
    }
  };

  const credDialogMeta = credDialogSkill ? catalogMap.get(credDialogSkill) : null;
  const isOAuthSkill = !!credDialogMeta?.oauth_provider;
  const credDialogFields = credDialogSkill && !isOAuthSkill ? (credDialogMeta?.requires_env || []) : [];
  // Check if the skill already has a connectionId (OAuth already completed)
  const skillItem = credDialogSkill ? items.find((s) => s.skillId === credDialogSkill) : null;
  const hasConnection = !!(skillItem?.config as Record<string, unknown>)?.connectionId;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Skills</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Skill
          </Button>
        </CardHeader>
        <CardContent className="space-y-1 p-0 pb-2">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground px-4 py-3">No skills assigned.</p>
          )}
          {items.map((s, i) => {
            const meta = catalogMap.get(s.skillId);
            let cfg: Record<string, unknown> = {};
            try {
              let parsed = s.config;
              while (typeof parsed === "string") parsed = JSON.parse(parsed);
              cfg = (parsed as Record<string, unknown>) || {};
            } catch { /* invalid JSON, treat as unconfigured */ }
            const needsConfig = !!(meta?.oauth_provider || meta?.requires_env?.length);
            const isConfigured = needsConfig
              ? !!(cfg.connectionId || cfg.secretRef)
              : true;
            return (
              <button
                key={i}
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent transition-colors"
                onClick={() => openCredDialog(s.skillId)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium">{meta?.name || s.skillId}</p>
                    {needsConfig && (
                      isConfigured
                        ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        : <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    )}
                  </div>
                  {meta?.description && (
                    <p className="text-xs text-muted-foreground truncate">{meta.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* Add Skill dialog — pick from catalog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Skill</DialogTitle>
            <DialogDescription>Select a skill to add to this agent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 max-h-[400px] overflow-y-auto -mx-2">
            {availableSkills.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">All available skills are already assigned.</p>
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
                    <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
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

      {/* Credential / OAuth config dialog */}
      <Dialog open={!!credDialogSkill} onOpenChange={(open) => { if (!open) { setCredDialogSkill(null); setConfirmDelete(false); setOauthConnecting(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isOAuthSkill ? "Connect Account" : "Configure Credentials"}</DialogTitle>
            <DialogDescription>
              {isOAuthSkill
                ? `Connect your ${credDialogMeta?.name || credDialogSkill} account to enable this skill.`
                : `Enter the environment variables required by ${credDialogMeta?.name || credDialogSkill}.`
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {isOAuthSkill ? (
              /* OAuth flow — show connect button */
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
                        handleStartOAuth();
                        window.open(oauthUrl, "oauth_popup", "width=600,height=700,left=200,top=100");
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
              /* Manual credential flow */
              credDialogFields.map((field) => (
                <div key={field} className="space-y-1">
                  <Label htmlFor={field} className="text-xs font-mono">{field}</Label>
                  <Input
                    id={field}
                    type={field.toLowerCase().includes("password") || field.toLowerCase().includes("secret") ? "password" : "text"}
                    value={credValues[field] || ""}
                    onChange={(e) => setCredValues((prev) => ({ ...prev, [field]: e.target.value }))}
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
                      <Button variant="destructive" size="sm" onClick={handleDeleteSkill} disabled={deleting}>
                        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                      Remove Skill
                    </Button>
                  )}
                </div>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="ghost" size="sm" onClick={() => setCredDialogSkill(null)} disabled={credSaving}>
                  {isOAuthSkill ? "Close" : "Cancel"}
                </Button>
                {!isOAuthSkill && (
                  <Button size="sm" onClick={handleSaveCreds} disabled={credSaving || credDialogFields.some((f) => !credValues[f])}>
                    {credSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Credentials"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
