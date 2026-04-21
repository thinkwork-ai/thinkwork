import { useState, useEffect, useCallback } from "react";
import { X, Plus, FileText, Wrench, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listWorkspaceFiles } from "@/lib/workspace-files-api";

interface AgentContextSectionProps {
  agentId: string;
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

export function AgentContextSection({
  agentId,
  contextFiles,
  contextSkills,
  contextKnowledgeBases,
  assignedSkills,
  assignedKbs,
  onSave,
}: AgentContextSectionProps) {
  // Workspace file list (fetched from API)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);

  const fetchWorkspaceFiles = useCallback(async () => {
    try {
      const data = await listWorkspaceFiles({ agentId });
      setWorkspaceFiles(data.files.map((f) => f.path).filter((p) => p !== "manifest.json"));
    } catch {}
  }, [agentId]);

  useEffect(() => {
    fetchWorkspaceFiles();
  }, [fetchWorkspaceFiles]);

  // Local state for editing
  const [files, setFiles] = useState<string[]>(contextFiles ?? []);
  const [skills, setSkills] = useState<string[]>(contextSkills ?? []);
  const [kbs, setKbs] = useState<string[]>(contextKnowledgeBases ?? []);

  // Sync from props when they change
  useEffect(() => { setFiles(contextFiles ?? []); }, [contextFiles]);
  useEffect(() => { setSkills(contextSkills ?? []); }, [contextSkills]);
  useEffect(() => { setKbs(contextKnowledgeBases ?? []); }, [contextKnowledgeBases]);

  const handleSave = async (
    newFiles: string[],
    newSkills: string[],
    newKbs: string[],
  ) => {
    await onSave({
      contextFiles: newFiles.length > 0 ? newFiles : null,
      contextSkills: newSkills.length > 0 ? newSkills : null,
      contextKnowledgeBases: newKbs.length > 0 ? newKbs : null,
    });
  };

  const addFile = async (f: string) => {
    const next = [...files, f];
    setFiles(next);
    await handleSave(next, skills, kbs);
  };
  const removeFile = async (f: string) => {
    const next = files.filter((x) => x !== f);
    setFiles(next);
    await handleSave(next, skills, kbs);
  };

  const addSkill = async (s: string) => {
    const next = [...skills, s];
    setSkills(next);
    await handleSave(files, next, kbs);
  };
  const removeSkill = async (s: string) => {
    const next = skills.filter((x) => x !== s);
    setSkills(next);
    await handleSave(files, next, kbs);
  };

  const addKb = async (id: string) => {
    const next = [...kbs, id];
    setKbs(next);
    await handleSave(files, skills, next);
  };
  const removeKb = async (id: string) => {
    const next = kbs.filter((x) => x !== id);
    setKbs(next);
    await handleSave(files, skills, next);
  };

  // Available items (not yet selected)
  const availableFiles = workspaceFiles.filter((f) => !files.includes(f));
  const availableSkills = assignedSkills.filter((s) => !skills.includes(s.skillId));
  const availableKbs = assignedKbs.filter((kb) => !kbs.includes(kb.id));

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Context</h3>
        <span className="text-[11px] text-muted-foreground">
          Empty = loads all. Add items to filter.
        </span>
      </div>

      {/* Workspace Files */}
      <TagRow
        icon={<FileText className="h-3.5 w-3.5" />}
        label="Workspace Files"
        tags={files}
        availableItems={availableFiles.map((f) => ({ value: f, label: f }))}
        onAdd={addFile}
        onRemove={removeFile}
        emptyText="All workspace files"
      />

      {/* Skills */}
      <TagRow
        icon={<Wrench className="h-3.5 w-3.5" />}
        label="Skills"
        tags={skills}
        availableItems={availableSkills.map((s) => ({ value: s.skillId, label: s.name || s.skillId }))}
        onAdd={addSkill}
        onRemove={removeSkill}
        emptyText="All assigned skills"
      />

      {/* Knowledge Bases */}
      <TagRow
        icon={<BookOpen className="h-3.5 w-3.5" />}
        label="Knowledge Bases"
        tags={kbs}
        tagLabels={Object.fromEntries(assignedKbs.map((kb) => [kb.id, kb.name]))}
        availableItems={availableKbs.map((kb) => ({ value: kb.id, label: kb.name }))}
        onAdd={addKb}
        onRemove={removeKb}
        emptyText="All assigned KBs"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag row component
// ---------------------------------------------------------------------------

function TagRow({
  icon,
  label,
  tags,
  tagLabels,
  availableItems,
  onAdd,
  onRemove,
  emptyText,
}: {
  icon: React.ReactNode;
  label: string;
  tags: string[];
  tagLabels?: Record<string, string>;
  availableItems: { value: string; label: string }[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  emptyText: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
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
