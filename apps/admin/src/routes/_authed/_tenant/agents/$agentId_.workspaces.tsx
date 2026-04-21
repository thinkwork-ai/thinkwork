import { useState, useEffect, useCallback } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { FolderOpen, Plus, Trash2, Loader2, Wrench, Pencil } from "lucide-react";

import { AgentDetailQuery } from "@/lib/graphql-queries";
import {
  deleteWorkspaceFile,
  getWorkspaceFile,
  listWorkspaceFiles,
  putWorkspaceFile,
  regenerateWorkspaceMap,
} from "@/lib/workspace-files-api";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageLayout } from "@/components/PageLayout";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId_/workspaces")({
  component: WorkspacesPage,
});

const MODEL_OPTIONS = [
  { value: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5" },
  { value: "us.anthropic.claude-sonnet-4-6-20250514-v1:0", label: "Claude Sonnet 4.6" },
  { value: "us.amazon.nova-micro-v1:0", label: "Nova Micro" },
  { value: "us.amazon.nova-lite-v1:0", label: "Nova Lite" },
  { value: "us.amazon.nova-pro-v1:0", label: "Nova Pro" },
];

type WorkspaceRow = {
  slug: string;
  name: string;
  purpose: string;
  model: string;
  skillCount: number;
};

type AgentSkill = {
  skillId: string;
  enabled: boolean;
  config?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Wizard state
// ---------------------------------------------------------------------------

interface SkillSelection {
  skillId: string;
  when: string;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const columns: ColumnDef<WorkspaceRow>[] = [
  {
    accessorKey: "name",
    header: "Workspace",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ row }) => {
      const model = row.original.model;
      if (!model) return <span className="text-muted-foreground">inherit parent</span>;
      const opt = MODEL_OPTIONS.find((o) => o.value === model);
      return <Badge variant="outline" className="text-[10px] font-normal">{opt?.label || model.split("-").slice(0, 3).join("-")}</Badge>;
    },
  },
  {
    accessorKey: "purpose",
    header: "Purpose",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground truncate max-w-[400px] block">
        {row.original.purpose || "---"}
      </span>
    ),
  },
  {
    accessorKey: "skillCount",
    header: "Skills",
    cell: ({ row }) => (
      <Badge variant="secondary" className="text-[10px]">
        {row.original.skillCount}
      </Badge>
    ),
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function WorkspacesPage() {
  const { agentId } = Route.useParams();
  const navigate = useNavigate();

  const [result] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });

  const agent = result.data?.agent as Record<string, any> | undefined;
  const agentSkills: AgentSkill[] = (agent?.skills ?? []) as AgentSkill[];
  const target = { agentId };

  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: agent?.name ?? "...", href: `/agents/${agentId}` },
    { label: "Workspaces" },
  ]);

  // Workspace list state
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWorkspaceFiles(target);
      const files: string[] = data.files.map((f) => f.path);

      // Find workspace folders: {slug}/CONTEXT.md
      const contextFiles = files.filter((f) => f.match(/^[^/]+\/CONTEXT\.md$/));
      const rows: WorkspaceRow[] = [];

      for (const cf of contextFiles) {
        const slug = cf.split("/")[0];
        try {
          const content = await getWorkspaceFile(target, cf);
          const text = content.content || "";
          const nameMatch = text.match(/^#\s+(.+)$/m);
          const purposeMatch = text.match(/^##\s+What This Workspace Is\s*\n([\s\S]*?)(?=\n##|\n---|$)/m);
          const modelMatch = text.match(/model:\s*(.+)/);
          // Count skills in table
          const skillsSection = text.match(/^##\s+Skills & Tools\s*\n([\s\S]*?)(?=\n##|\n---|$)/m);
          let skillCount = 0;
          if (skillsSection) {
            const tableRows = skillsSection[1].split("\n").filter((l: string) =>
              l.trim().startsWith("|") && !l.includes("---") && !l.toLowerCase().includes("skill")
            );
            skillCount = tableRows.length;
          }

          rows.push({
            slug,
            name: nameMatch ? nameMatch[1].trim() : slug,
            purpose: purposeMatch ? purposeMatch[1].trim().split("\n")[0] : "",
            model: modelMatch ? modelMatch[1].trim() : "",
            skillCount,
          });
        } catch {
          rows.push({ slug, name: slug, purpose: "", model: "", skillCount: 0 });
        }
      }

      setWorkspaces(rows);
    } catch (err) {
      console.error("Failed to load workspaces:", err);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [newModel, setNewModel] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<SkillSelection[]>([]);
  const [creating, setCreating] = useState(false);

  const resetWizard = () => {
    setWizardStep(0);
    setNewName("");
    setNewPurpose("");
    setNewModel("");
    setSelectedSkills([]);
    setCreating(false);
  };

  const handleOpenCreate = () => {
    resetWizard();
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);

    const slug = newName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    // Generate CONTEXT.md
    const lines: string[] = [];
    lines.push(`# ${newName.trim()}`);
    lines.push("");
    lines.push("## What This Workspace Is");
    lines.push(newPurpose.trim() || `Specialized workspace for ${newName.trim()}.`);
    lines.push("");

    if (newModel) {
      lines.push("## Config");
      lines.push(`- model: ${newModel}`);
      lines.push("");
    }

    if (selectedSkills.length > 0) {
      lines.push("## Skills & Tools");
      lines.push("");
      lines.push("| Skill | When | Model Override | Purpose |");
      lines.push("|-------|------|---------------|---------|");
      for (const s of selectedSkills) {
        const displayName = s.skillId.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        lines.push(`| ${displayName} | ${s.when || "As needed"} | --- | --- |`);
      }
      lines.push("");
    }

    lines.push("## Process");
    lines.push("");
    lines.push("1. Understand the user's request");
    lines.push("2. Use the appropriate tools");
    lines.push("3. Return a clear result");
    lines.push("");

    lines.push("## What NOT to Do");
    lines.push("");
    lines.push("- Don't handle tasks outside this workspace's scope");
    lines.push("");

    const contextContent = lines.join("\n");

    try {
      // Write CONTEXT.md to workspace folder.
      await putWorkspaceFile(target, `${slug}/CONTEXT.md`, contextContent);

      // Trigger workspace map regeneration — non-critical, fine to fail
      // silently (map regenerates on next skill change too).
      try {
        await regenerateWorkspaceMap(agentId);
      } catch {
        // Non-critical — map will be regenerated on next skill change.
      }

      setCreateOpen(false);
      resetWizard();
      loadWorkspaces();
    } catch (err) {
      console.error("Failed to create workspace:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (ws: WorkspaceRow) => {
    if (!confirm(`Delete workspace "${ws.name}"? This removes the folder and all its files.`)) return;
    try {
      // Delete CONTEXT.md (and ideally all files in the folder).
      await deleteWorkspaceFile(target, `${ws.slug}/CONTEXT.md`);
      loadWorkspaces();
    } catch (err) {
      console.error("Failed to delete workspace:", err);
    }
  };

  const toggleSkill = (skillId: string, checked: boolean) => {
    if (checked) {
      setSelectedSkills((prev) => [...prev, { skillId, when: "" }]);
    } else {
      setSelectedSkills((prev) => prev.filter((s) => s.skillId !== skillId));
    }
  };

  const updateSkillWhen = (skillId: string, when: string) => {
    setSelectedSkills((prev) =>
      prev.map((s) => (s.skillId === skillId ? { ...s, when } : s))
    );
  };

  if (result.fetching && !result.data) return <PageSkeleton />;

  const columnsWithActions: ColumnDef<WorkspaceRow>[] = [
    ...columns,
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={(e) => { e.stopPropagation(); handleDelete(row.original); }}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      ),
      size: 40,
    },
  ];

  return (
    <PageLayout
      header={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
              Workspaces
            </h1>
            {workspaces.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {workspaces.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link to="/agents/$agentId/workspace" params={{ agentId }} search={{ folder: undefined }}>
              <Button variant="outline" size="sm">
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Advanced Editor
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={handleOpenCreate}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Workspace
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No workspaces yet. Each workspace becomes a specialized sub-agent that {agent?.name} can delegate to.
          </p>
          <Button variant="outline" size="sm" onClick={handleOpenCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create Workspace
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columnsWithActions}
          data={workspaces}
          pageSize={0}
          onRowClick={(row) => {
            // Navigate to workspace editor with folder pre-selected
            navigate({
              to: "/agents/$agentId/workspace",
              params: { agentId },
              search: { folder: row.slug },
            });
          }}
        />
      )}

      {/* Create Workspace Wizard */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetWizard(); }}>
        <DialogContent style={{ maxWidth: 520 }}>
          <DialogHeader>
            <DialogTitle>
              {wizardStep === 0 && "New Workspace"}
              {wizardStep === 1 && "Model Selection"}
              {wizardStep === 2 && "Skills & Tools"}
              {wizardStep === 3 && "Review"}
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 0 && "Define a workspace that becomes a specialized sub-agent."}
              {wizardStep === 1 && "Choose which model this workspace uses."}
              {wizardStep === 2 && "Select skills and define when they should be used."}
              {wizardStep === 3 && "Review and create the workspace."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Step 0: Name & Purpose */}
            {wizardStep === 0 && (
              <>
                <div>
                  <Label className="text-xs">Workspace Name</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Personal Assistant, CRM Specialist, Research"
                    autoFocus
                  />
                </div>
                <div>
                  <Label className="text-xs">Purpose</Label>
                  <Textarea
                    value={newPurpose}
                    onChange={(e) => setNewPurpose(e.target.value)}
                    placeholder="What does this workspace handle? This becomes the sub-agent's role description."
                    className="h-20"
                  />
                </div>
              </>
            )}

            {/* Step 1: Model */}
            {wizardStep === 1 && (
              <div>
                <Label className="text-xs">Model</Label>
                <Select value={newModel} onValueChange={setNewModel}>
                  <SelectTrigger>
                    <SelectValue placeholder="Inherit parent model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Inherit parent model</SelectItem>
                    {MODEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Use a cheaper model (Haiku, Nova Micro) for simple tasks to reduce cost.
                </p>
              </div>
            )}

            {/* Step 2: Skills & Tools */}
            {wizardStep === 2 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Select which of {agent?.name}'s skills this workspace should use, and when.
                </p>
                {agentSkills.filter((s) => s.enabled).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No skills assigned to this agent yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {agentSkills.filter((s) => s.enabled).map((skill) => {
                      const selected = selectedSkills.find((ss) => ss.skillId === skill.skillId);
                      const displayName = skill.skillId.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                      return (
                        <div key={skill.skillId} className="border rounded-md p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={!!selected}
                              onCheckedChange={(checked) => toggleSkill(skill.skillId, !!checked)}
                            />
                            <div className="flex items-center gap-1.5">
                              <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-sm font-medium">{displayName}</span>
                            </div>
                          </div>
                          {selected && (
                            <div className="pl-6">
                              <Label className="text-[10px] text-muted-foreground">When to use</Label>
                              <Input
                                value={selected.when}
                                onChange={(e) => updateSkillWhen(skill.skillId, e.target.value)}
                                placeholder="e.g. Scheduling tasks, Research phase, Before final review"
                                className="h-8 text-xs"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Review */}
            {wizardStep === 3 && (
              <div className="space-y-3">
                <div className="border rounded-md p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium">{newName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Model</span>
                    <span>{newModel && newModel !== "inherit"
                      ? MODEL_OPTIONS.find((o) => o.value === newModel)?.label || newModel
                      : "Inherit parent"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Skills</span>
                    <span>{selectedSkills.length} selected</span>
                  </div>
                  {newPurpose && (
                    <div className="pt-1 border-t">
                      <span className="text-muted-foreground text-xs">Purpose</span>
                      <p className="text-xs mt-0.5">{newPurpose}</p>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This will create a <code className="text-[10px]">{newName.trim().toLowerCase().replace(/\s+/g, "-")}/CONTEXT.md</code> in the workspace
                  and regenerate the workspace map.
                </p>
              </div>
            )}

            {/* Navigation buttons */}
            <div className="flex justify-between pt-2">
              <div>
                {wizardStep > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setWizardStep((s) => s - 1)}>
                    Back
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setCreateOpen(false); resetWizard(); }}>
                  Cancel
                </Button>
                {wizardStep < 3 ? (
                  <Button
                    size="sm"
                    onClick={() => setWizardStep((s) => s + 1)}
                    disabled={wizardStep === 0 && !newName.trim()}
                  >
                    Next
                  </Button>
                ) : (
                  <Button size="sm" onClick={handleCreate} disabled={creating}>
                    {creating && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Create Workspace
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
