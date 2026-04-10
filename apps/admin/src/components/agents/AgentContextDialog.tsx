import { useState, useEffect, useCallback } from "react";
import { X, Plus, FileText, Wrench, BookOpen, Brain, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

// System defaults (always loaded, shown as reference)
const SYSTEM_FILES = ["SOUL.md", "IDENTITY.md", "USER.md"];

interface AgentContextDialogProps {
  agentId: string;
  tenantSlug: string;
  instanceId: string;
  contextFiles: string[] | null;
  contextSkills: string[] | null;
  contextKnowledgeBases: string[] | null;
  assignedSkills: { skillId: string; name?: string }[];
  assignedKbs: { id: string; name: string }[];
  onSave: (context: {
    contextFiles: string[] | null;
    contextSkills: string[] | null;
    contextKnowledgeBases: string[] | null;
  }) => Promise<void>;
}

export function AgentContextDialog({
  agentId,
  tenantSlug,
  instanceId,
  contextFiles,
  contextSkills,
  contextKnowledgeBases,
  assignedSkills,
  assignedKbs,
  onSave,
}: AgentContextDialogProps) {
  const [open, setOpen] = useState(false);

  // Count overrides
  const overrideCount =
    (contextFiles?.length ?? 0) +
    (contextSkills?.length ?? 0) +
    (contextKnowledgeBases?.length ?? 0);

  // Workspace file list
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);

  const fetchWorkspaceFiles = useCallback(async () => {
    if (!tenantSlug || !instanceId || !open) return;
    try {
      const res = await fetch(`${API_URL}/internal/workspace-files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
        },
        body: JSON.stringify({ action: "list", tenantSlug, instanceId }),
      });
      const data = await res.json();
      setWorkspaceFiles((data.files ?? []).filter((f: string) => f !== "manifest.json"));
    } catch {}
  }, [tenantSlug, instanceId, open]);

  useEffect(() => {
    fetchWorkspaceFiles();
  }, [fetchWorkspaceFiles]);

  // Local state
  const [files, setFiles] = useState<string[]>(contextFiles ?? []);
  const [skills, setSkills] = useState<string[]>(contextSkills ?? []);
  const [kbs, setKbs] = useState<string[]>(contextKnowledgeBases ?? []);

  useEffect(() => { setFiles(contextFiles ?? []); }, [contextFiles]);
  useEffect(() => { setSkills(contextSkills ?? []); }, [contextSkills]);
  useEffect(() => { setKbs(contextKnowledgeBases ?? []); }, [contextKnowledgeBases]);

  const handleSave = async (newFiles: string[], newSkills: string[], newKbs: string[]) => {
    await onSave({
      contextFiles: newFiles.length > 0 ? newFiles : null,
      contextSkills: newSkills.length > 0 ? newSkills : null,
      contextKnowledgeBases: newKbs.length > 0 ? newKbs : null,
    });
  };

  const addFile = async (f: string) => { const next = [...files, f]; setFiles(next); await handleSave(next, skills, kbs); };
  const removeFile = async (f: string) => { const next = files.filter((x) => x !== f); setFiles(next); await handleSave(next, skills, kbs); };
  const addSkill = async (s: string) => { const next = [...skills, s]; setSkills(next); await handleSave(files, next, kbs); };
  const removeSkill = async (s: string) => { const next = skills.filter((x) => x !== s); setSkills(next); await handleSave(files, next, kbs); };
  const addKb = async (id: string) => { const next = [...kbs, id]; setKbs(next); await handleSave(files, skills, next); };
  const removeKb = async (id: string) => { const next = kbs.filter((x) => x !== id); setKbs(next); await handleSave(files, skills, next); };

  const availableFiles = workspaceFiles.filter((f) => !files.includes(f));
  const availableSkills = assignedSkills.filter((s) => !skills.includes(s.skillId));
  const availableKbs = assignedKbs.filter((kb) => !kbs.includes(kb.id));

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        <Badge
          variant="outline"
          className={`gap-1 cursor-pointer hover:bg-accent transition-colors ${overrideCount > 0 ? "border-purple-500 text-purple-500" : "text-muted-foreground"}`}
        >
          <Brain className="h-3 w-3" />
          {overrideCount > 0 && overrideCount}
        </Badge>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={{ maxWidth: 560 }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Agent Context
            </DialogTitle>
            <DialogDescription>
              Control what this agent loads per invocation. Empty = loads all.
              Add items to narrow the context window.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* System defaults (read-only reference) */}
            <div className="bg-muted/50 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Shield className="h-3.5 w-3.5 text-blue-400" />
                <span className="text-xs font-medium text-muted-foreground">System Default</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SYSTEM_FILES.map((f) => (
                  <Badge key={f} variant="outline" className="text-[11px] text-muted-foreground">
                    {f}
                  </Badge>
                ))}
                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                  all skills
                </Badge>
                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                  all KBs
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Always loaded. Overrides below replace these defaults.
              </p>
            </div>

            {/* Workspace Files */}
            <TagSection
              icon={<FileText className="h-3.5 w-3.5" />}
              label="Workspace Files"
              emptyText="All workspace files"
              tags={files}
              availableItems={availableFiles.map((f) => ({ value: f, label: f }))}
              onAdd={addFile}
              onRemove={removeFile}
            />

            {/* Skills */}
            <TagSection
              icon={<Wrench className="h-3.5 w-3.5" />}
              label="Skills"
              emptyText="All assigned skills"
              tags={skills}
              availableItems={availableSkills.map((s) => ({ value: s.skillId, label: s.name || s.skillId }))}
              onAdd={addSkill}
              onRemove={removeSkill}
            />

            {/* Knowledge Bases */}
            <TagSection
              icon={<BookOpen className="h-3.5 w-3.5" />}
              label="Knowledge Bases"
              emptyText="All assigned KBs"
              tags={kbs}
              tagLabels={Object.fromEntries(assignedKbs.map((kb) => [kb.id, kb.name]))}
              availableItems={availableKbs.map((kb) => ({ value: kb.id, label: kb.name }))}
              onAdd={addKb}
              onRemove={removeKb}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tag section
// ---------------------------------------------------------------------------

function TagSection({
  icon,
  label,
  emptyText,
  tags,
  tagLabels,
  availableItems,
  onAdd,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  emptyText: string;
  tags: string[];
  tagLabels?: Record<string, string>;
  availableItems: { value: string; label: string }[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 min-h-[28px]">
        {tags.length === 0 ? (
          <span className="text-xs text-muted-foreground italic">{emptyText}</span>
        ) : (
          tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 text-xs pr-1">
              {tagLabels?.[tag] || tag}
              <button
                onClick={() => onRemove(tag)}
                className="ml-0.5 rounded-full hover:bg-accent p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
        {availableItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs">
                <Plus className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
              {availableItems.map((item) => (
                <DropdownMenuItem key={item.value} onClick={() => onAdd(item.value)}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
