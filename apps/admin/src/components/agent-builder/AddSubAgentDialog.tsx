import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { validateSubAgentSlug } from "@/lib/workspace-tree-actions";

interface SubAgentTemplate {
  id: string;
  name: string;
  description: string;
  render: (slug: string) => string;
}

const SUB_AGENT_TEMPLATES: SubAgentTemplate[] = [
  {
    id: "minimal",
    name: "Minimal",
    description: "A concise folder-scope CONTEXT.md.",
    render: (slug) =>
      `# ${titleizeSlug(slug)}\n\nDescribe the work this sub-agent owns.\n`,
  },
  {
    id: "support",
    name: "Support triage",
    description: "Starter context for customer or teammate support routing.",
    render: (slug) =>
      `# ${titleizeSlug(slug)}\n\nHandle support triage, collect the relevant context, and hand back anything outside this scope.\n`,
  },
  {
    id: "operations",
    name: "Operations",
    description: "Starter context for operational follow-up work.",
    render: (slug) =>
      `# ${titleizeSlug(slug)}\n\nTrack operational follow-up, document decisions, and escalate blocked work to the parent agent.\n`,
  },
];

export interface AddSubAgentDialogProps {
  open: boolean;
  files: string[];
  creating: boolean;
  serverError?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { slug: string; contextContent: string }) => void;
}

export function AddSubAgentDialog({
  open,
  files,
  creating,
  serverError,
  onOpenChange,
  onSubmit,
}: AddSubAgentDialogProps) {
  const [slugInput, setSlugInput] = useState("");
  const [templateId, setTemplateId] = useState("minimal");
  const validation = useMemo(
    () => validateSubAgentSlug(slugInput, files),
    [files, slugInput],
  );
  const template =
    SUB_AGENT_TEMPLATES.find((candidate) => candidate.id === templateId) ??
    SUB_AGENT_TEMPLATES[0]!;

  const submit = () => {
    if (!validation.valid) return;
    onSubmit({
      slug: validation.slug,
      contextContent: renderSubAgentContext(validation.slug, templateId),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 460 }}>
        <DialogHeader>
          <DialogTitle>Add Sub-agent</DialogTitle>
          <DialogDescription>
            Create a routed top-level specialist folder.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Slug</Label>
            <Input
              value={slugInput}
              onChange={(event) => setSlugInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && submit()}
              placeholder="support"
            />
            {(slugInput || serverError) && (
              <p className="text-xs text-destructive">
                {validation.error ?? serverError}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Snippet</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUB_AGENT_TEMPLATES.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {template.description}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={!validation.valid || creating}
            >
              {creating && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Create Sub-agent
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function renderSubAgentContext(
  slug: string,
  templateId: string,
): string {
  const template =
    SUB_AGENT_TEMPLATES.find((candidate) => candidate.id === templateId) ??
    SUB_AGENT_TEMPLATES[0]!;
  return template.render(slug);
}

function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
