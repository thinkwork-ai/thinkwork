import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Shield, ShieldAlert, ShieldCheck, Lock, FileWarning, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/context/TenantContext";
import { AgentTemplatesListQuery } from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { MetricCard } from "@/components/MetricCard";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type GuardrailStats,
  type GuardrailBlock,
  type Guardrail,
  type GuardrailConfig,
  type FilterStrength,
  getGuardrailStats,
  listGuardrails,
  createGuardrail,
  deleteGuardrail,
  toggleDefault,
  assignTemplates,
} from "@/lib/guardrails-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authed/_tenant/security/")({
  component: SecurityCenterPage,
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function SecurityCenterPage() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id || "";
  useBreadcrumbs([{ label: "Security Center" }]);

  const [tab, setTab] = useState("dashboard");
  const [stats, setStats] = useState<GuardrailStats | null>(null);
  const [guardrailsList, setGuardrailsList] = useState<Guardrail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateGuardrail, setShowCreateGuardrail] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    Promise.all([
      getGuardrailStats(tenantId),
      listGuardrails(tenantId),
    ])
      .then(([s, g]) => {
        setStats(s);
        setGuardrailsList(g);
      })
      .catch((err) => {
        console.error("Failed to load security data:", err);
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

  const loadData = () => {
    if (!tenantId) return;
    setLoading(true);
    Promise.all([
      getGuardrailStats(tenantId),
      listGuardrails(tenantId),
    ])
      .then(([s, g]) => {
        setStats(s);
        setGuardrailsList(g);
      })
      .catch((err) => {
        console.error("Failed to load security data:", err);
      })
      .finally(() => setLoading(false));
  };

  if (loading) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <PageHeader
          title="Security Center"
          description="Manage content guardrails, access policies, and security monitoring"
        />
      }
    >
      <div className="flex items-center justify-between">
        <ToggleGroup type="single" value={tab} onValueChange={(v) => v && setTab(v)} variant="outline">
          <ToggleGroupItem value="dashboard" className="px-4">Dashboard</ToggleGroupItem>
          <ToggleGroupItem value="guardrails" className="px-4">Guardrails</ToggleGroupItem>
          <ToggleGroupItem value="policies" className="px-4">Policies</ToggleGroupItem>
          <ToggleGroupItem value="approvals" className="px-4">Approvals</ToggleGroupItem>
          <ToggleGroupItem value="audit" className="px-4">Audit</ToggleGroupItem>
        </ToggleGroup>

        {tab === "guardrails" && (
          <Button size="sm" onClick={() => setShowCreateGuardrail(true)}>
            Create Guardrail
          </Button>
        )}
      </div>

      <div className="mt-4">
        {tab === "dashboard" && <DashboardTab stats={stats} />}
        {tab === "guardrails" && (
          <GuardrailsTab
            tenantId={tenantId}
            guardrails={guardrailsList}
            onRefresh={loadData}
            showCreate={showCreateGuardrail}
            onShowCreateChange={setShowCreateGuardrail}
          />
        )}
        {tab === "policies" && (
          <PoliciesTab tenantId={tenantId} guardrails={guardrailsList} />
        )}
        {tab === "approvals" && (
          <ComingSoonTab
            icon={ShieldAlert}
            title="Tool Approvals"
            description="Per-tool approval workflows with real-time notifications will be available in Phase 3."
          />
        )}
        {tab === "audit" && (
          <ComingSoonTab
            icon={FileWarning}
            title="Security Audit Log"
            description="Security-focused audit log with advanced filtering and CSV export will be available in Phase 2."
          />
        )}
      </div>
    </PageLayout>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Tab
// ---------------------------------------------------------------------------

function DashboardTab({ stats }: { stats: GuardrailStats | null }) {
  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Active Guardrails"
          value={stats.guardrails_count}
        />
        <MetricCard
          label="Templates with Guardrails"
          value={stats.templates_with_guardrails}
        />
        <MetricCard
          label="Blocks (24h)"
          value={stats.blocks_24h}
        />
        <MetricCard
          label="Blocks (7d)"
          value={stats.blocks_7d}
        />
      </div>

      {stats.blocks_by_type.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Blocks by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              {stats.blocks_by_type.map((b) => (
                <div key={b.type} className="flex items-center gap-2">
                  <Badge variant={b.type === "INPUT" ? "destructive" : "secondary"}>
                    {b.type}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{b.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {stats.recent_blocks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent Blocks</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Message Preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recent_blocks.slice(0, 10).map((block) => (
                  <TableRow key={block.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(block.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={block.block_type === "INPUT" ? "destructive" : "secondary"} className="text-[10px]">
                        {block.block_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{block.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {block.user_message || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {stats.blocks_24h === 0 && stats.guardrails_count === 0 && (
        <EmptyState
          icon={Shield}
          title="No guardrails configured"
          description="Create a guardrail to start protecting your agents with Bedrock content filters and topic policies."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guardrails Tab
// ---------------------------------------------------------------------------

const STRENGTH_OPTIONS = ["NONE", "LOW", "MEDIUM", "HIGH"] as const;

function GuardrailsTab({
  tenantId,
  guardrails: items,
  onRefresh,
  showCreate,
  onShowCreateChange,
}: {
  tenantId: string;
  guardrails: Guardrail[];
  onRefresh: () => void;
  showCreate: boolean;
  onShowCreateChange: (open: boolean) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<Guardrail | null>(null);
  const [assignTarget, setAssignTarget] = useState<Guardrail | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteGuardrail(tenantId, deleteTarget.id);
      toast.success("Guardrail deleted");
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete guardrail");
    }
    setDeleteTarget(null);
  };

  const handleToggleDefault = async (guardrail: Guardrail) => {
    try {
      await toggleDefault(tenantId, guardrail.id, !guardrail.is_default);
      toast.success(guardrail.is_default ? "Default removed" : "Set as default");
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to update default");
    }
  };

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No guardrails"
          description="Create your first guardrail to enforce content filtering and topic policies on agent responses."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Default</TableHead>
              <TableHead>Assigned Templates</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  <div>
                    <span className="font-medium text-sm">{g.name}</span>
                    {g.description && (
                      <p className="text-xs text-muted-foreground">{g.description}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={g.status === "active" ? "default" : "secondary"} className="text-[10px]">
                    {g.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={g.is_default}
                    onCheckedChange={() => handleToggleDefault(g)}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-sm text-muted-foreground"
                    onClick={() => setAssignTarget(g)}
                  >
                    {g.assigned_templates_count || 0}
                  </Button>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(g.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setDeleteTarget(g)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateGuardrailDialog
        tenantId={tenantId}
        open={showCreate}
        onOpenChange={onShowCreateChange}
        onCreated={onRefresh}
      />

      {assignTarget && (
        <AssignTemplatesDialog
          tenantId={tenantId}
          guardrail={assignTarget}
          open={!!assignTarget}
          onOpenChange={(open) => { if (!open) setAssignTarget(null); }}
          onAssigned={onRefresh}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete guardrail</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete &quot;{deleteTarget?.name}&quot; from Bedrock and unassign all templates. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign Templates Dialog
// ---------------------------------------------------------------------------

function AssignTemplatesDialog({
  tenantId,
  guardrail,
  open,
  onOpenChange,
  onAssigned,
}: {
  tenantId: string;
  guardrail: Guardrail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}) {
  const [templatesResult] = useQuery({
    query: AgentTemplatesListQuery,
    variables: { tenantId },
    pause: !tenantId,
  });
  const templates: Array<{ id: string; name: string }> =
    (templatesResult.data as any)?.agentTemplates ?? [];

  const assignedIds = new Set(
    (guardrail.assigned_templates ?? []).map((c) => c.id),
  );
  const [selected, setSelected] = useState<Set<string>>(assignedIds);
  const [saving, setSaving] = useState(false);

  // Reset selection when guardrail changes
  useEffect(() => {
    setSelected(new Set((guardrail.assigned_templates ?? []).map((c) => c.id)));
  }, [guardrail]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await assignTemplates(tenantId, guardrail.id, Array.from(selected));
      toast.success("Templates assigned");
      onOpenChange(false);
      onAssigned();
    } catch (err: any) {
      toast.error(err.message || "Failed to assign templates");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign Templates to &quot;{guardrail.name}&quot;</DialogTitle>
          <DialogDescription>
            Select agent templates that should use this guardrail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {templatesResult.fetching && <p className="text-sm text-muted-foreground">Loading templates...</p>}
          {templates.length === 0 && !templatesResult.fetching && (
            <p className="text-sm text-muted-foreground">No agent templates found.</p>
          )}
          {templates.map((c) => (
            <label key={c.id} className="flex items-center gap-2 cursor-pointer py-1">
              <Checkbox
                checked={selected.has(c.id)}
                onCheckedChange={() => toggle(c.id)}
              />
              <span className="text-sm">{c.name}</span>
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create Guardrail Dialog
// ---------------------------------------------------------------------------

function CreateGuardrailDialog({
  tenantId,
  open,
  onOpenChange,
  onCreated,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [hate, setHate] = useState<FilterStrength>({ inputStrength: "MEDIUM", outputStrength: "MEDIUM" });
  const [insults, setInsults] = useState<FilterStrength>({ inputStrength: "MEDIUM", outputStrength: "MEDIUM" });
  const [sexual, setSexual] = useState<FilterStrength>({ inputStrength: "HIGH", outputStrength: "HIGH" });
  const [violence, setViolence] = useState<FilterStrength>({ inputStrength: "MEDIUM", outputStrength: "MEDIUM" });
  const [deniedTopics, setDeniedTopics] = useState<Array<{ name: string; definition: string }>>([]);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicDef, setNewTopicDef] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createGuardrail(tenantId, {
        name: name.trim(),
        description: description.trim() || undefined,
        config: {
          contentFilters: { hate, insults, sexual, violence },
          deniedTopics: deniedTopics.length > 0 ? deniedTopics : undefined,
        },
      });
      toast.success("Guardrail created");
      onOpenChange(false);
      setName("");
      setDescription("");
      setDeniedTopics([]);
      onCreated();
    } catch (err: any) {
      toast.error(err.message || "Failed to create guardrail");
    } finally {
      setCreating(false);
    }
  };

  const addTopic = () => {
    if (!newTopicName.trim() || !newTopicDef.trim()) return;
    setDeniedTopics([...deniedTopics, { name: newTopicName.trim(), definition: newTopicDef.trim() }]);
    setNewTopicName("");
    setNewTopicDef("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Guardrail</DialogTitle>
          <DialogDescription>
            Configure Bedrock content filters and topic policies.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Standard Content Policy"
            />
          </div>

          <div>
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Content Filters</Label>
            <FilterRow label="Hate" value={hate} onChange={setHate} />
            <FilterRow label="Insults" value={insults} onChange={setInsults} />
            <FilterRow label="Sexual" value={sexual} onChange={setSexual} />
            <FilterRow label="Violence" value={violence} onChange={setViolence} />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Denied Topics</Label>
            {deniedTopics.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{t.name}</Badge>
                <span className="text-muted-foreground text-xs truncate">{t.definition}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive h-6 px-2"
                  onClick={() => setDeniedTopics(deniedTopics.filter((_, idx) => idx !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                placeholder="Topic name"
                value={newTopicName}
                onChange={(e) => setNewTopicName(e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Definition"
                value={newTopicDef}
                onChange={(e) => setNewTopicDef(e.target.value)}
                className="flex-[2]"
              />
              <Button variant="outline" size="sm" onClick={addTopic}>
                Add
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Filter Row
// ---------------------------------------------------------------------------

function FilterRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FilterStrength;
  onChange: (v: FilterStrength) => void;
}) {
  return (
    <div className="grid grid-cols-[100px_1fr_1fr] gap-2 items-center">
      <span className="text-sm">{label}</span>
      <Select
        value={value.inputStrength}
        onValueChange={(v) => onChange({ ...value, inputStrength: v as FilterStrength["inputStrength"] })}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STRENGTH_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.outputStrength}
        onValueChange={(v) => onChange({ ...value, outputStrength: v as FilterStrength["outputStrength"] })}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STRENGTH_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policies Tab (read-only overview of agent template policies)
// ---------------------------------------------------------------------------

function PoliciesTab({ tenantId, guardrails }: { tenantId: string; guardrails: Guardrail[] }) {
  const navigate = useNavigate();
  const [templatesResult] = useQuery({
    query: AgentTemplatesListQuery,
    variables: { tenantId },
    pause: !tenantId,
  });

  const templates: Array<{
    id: string;
    name: string;
    model: string | null;
    blockedTools: string[] | null;
    guardrailId: string | null;
  }> = (templatesResult.data as any)?.agentTemplates ?? [];

  const guardrailMap = new Map(guardrails.map((g) => [g.id, g.name]));

  if (templatesResult.fetching) return <PageSkeleton />;

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={Lock}
        title="No agent templates"
        description="Create an agent template to configure security policies such as model access, blocked tools, and guardrails."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Security policies are managed per agent template. Click a template name to edit its policies.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Template Name</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Blocked Tools</TableHead>
            <TableHead>Guardrail</TableHead>
            <TableHead>Agent Count</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Button
                  variant="link"
                  className="p-0 h-auto font-medium text-sm"
                  onClick={() => navigate({ to: `/agent-templates/${c.id}` })}
                >
                  {c.name}
                </Button>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {c.model || "Default"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {c.blockedTools && c.blockedTools.length > 0
                  ? c.blockedTools.join(", ")
                  : "None"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {c.guardrailId ? guardrailMap.get(c.guardrailId) || "Unknown" : "None"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                —
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coming Soon Placeholder
// ---------------------------------------------------------------------------

function ComingSoonTab({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <EmptyState
      icon={Icon}
      title={title}
      description={description}
    />
  );
}
