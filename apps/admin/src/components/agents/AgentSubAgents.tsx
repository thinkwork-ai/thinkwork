import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "urql";
import { Bot, Plus, Trash2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { gql } from "@urql/core";

const CreateSubAgentMutation = gql`
  mutation CreateSubAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
      id
      name
      slug
    }
  }
`;

const DeleteAgentMutation = gql`
  mutation DeleteSubAgent($id: ID!) {
    deleteAgent(id: $id)
  }
`;

interface SubAgent {
  id: string;
  name: string;
  slug: string;
  role: string | null;
  model: string | null;
  status: string;
}

interface AgentSubAgentsProps {
  agentId: string;
  agentName: string;
  tenantId: string;
  subAgents: SubAgent[];
  onRefresh: () => void;
}

const MODEL_OPTIONS = [
  { value: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5 (fast, cheap)" },
  { value: "us.anthropic.claude-sonnet-4-6-20250514-v1:0", label: "Claude Sonnet 4.6 (balanced)" },
  { value: "us.amazon.nova-micro-v1:0", label: "Nova Micro (fastest)" },
  { value: "us.amazon.nova-lite-v1:0", label: "Nova Lite" },
  { value: "us.amazon.nova-pro-v1:0", label: "Nova Pro" },
];

export function AgentSubAgents({ agentId, agentName, tenantId, subAgents, onRefresh }: AgentSubAgentsProps) {
  const [, createAgent] = useMutation(CreateSubAgentMutation);
  const [, deleteAgent] = useMutation(DeleteAgentMutation);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newModel, setNewModel] = useState("us.anthropic.claude-haiku-4-5-20251001-v1:0");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createAgent({
        input: {
          tenantId,
          name: newName.trim(),
          role: newRole.trim() || `Sub-agent specialized in ${newName.trim()}`,
          type: "AGENT",
          model: newModel,
          adapterType: "strands",
          parentAgentId: agentId,
        },
      });
      setCreateOpen(false);
      setNewName("");
      setNewRole("");
      onRefresh();
    } catch (err) {
      console.error("Failed to create sub-agent:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete sub-agent "${name}"?`)) return;
    await deleteAgent({ id });
    onRefresh();
  };

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Sub-Agents</h3>
          {subAgents.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {subAgents.length}
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>

      {subAgents.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No sub-agents. Sub-agents are specialized tools that run inside {agentName}'s process.
        </p>
      ) : (
        <div className="space-y-2">
          {subAgents.map((sub) => (
            <div key={sub.id} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{sub.name}</span>
                  {sub.model && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                      {sub.model.split("-").slice(0, 2).join("-")}
                    </Badge>
                  )}
                </div>
                {sub.role && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub.role}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <Link to={`/agents/${sub.id}`}>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDelete(sub.id, sub.name)}>
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Sub-Agent Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent style={{ maxWidth: 480 }}>
          <DialogHeader>
            <DialogTitle>New Sub-Agent</DialogTitle>
            <DialogDescription>
              Create a specialized sub-agent that runs inside {agentName}'s process as a tool.
              Give it a focused role and optionally a different model.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Research Assistant, CRM Specialist"
              />
            </div>
            <div>
              <Label className="text-xs">Role / Description</Label>
              <Textarea
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                placeholder="Describe what this sub-agent specializes in. This becomes the tool description the parent agent sees."
                className="h-20"
              />
            </div>
            <div>
              <Label className="text-xs">Model</Label>
              <Select value={newModel} onValueChange={setNewModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Use a cheaper/faster model for simple tasks.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || creating}>
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
