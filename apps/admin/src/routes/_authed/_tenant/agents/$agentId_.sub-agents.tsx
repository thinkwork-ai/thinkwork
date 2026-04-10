import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { BotMessageSquare, Plus, Trash2 } from "lucide-react";
import { gql } from "@urql/core";
import { AgentDetailQuery } from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageLayout } from "@/components/PageLayout";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId_/sub-agents")({
  component: SubAgentsPage,
});

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

const MODEL_OPTIONS = [
  { value: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5" },
  { value: "us.anthropic.claude-sonnet-4-6-20250514-v1:0", label: "Claude Sonnet 4.6" },
  { value: "us.amazon.nova-micro-v1:0", label: "Nova Micro" },
  { value: "us.amazon.nova-lite-v1:0", label: "Nova Lite" },
  { value: "us.amazon.nova-pro-v1:0", label: "Nova Pro" },
];

type SubAgent = {
  id: string;
  name: string;
  slug: string;
  role: string | null;
  model: string | null;
  status: string;
};

const columns: ColumnDef<SubAgent>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link
        to="/agents/$agentId"
        params={{ agentId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ row }) => {
      const model = row.original.model;
      if (!model) return <span className="text-muted-foreground">—</span>;
      const short = model.replace(/^(us\.)/, "").split("-").slice(0, 3).join("-");
      return <Badge variant="outline" className="text-[10px] font-normal">{short}</Badge>;
    },
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground truncate max-w-[400px] block">
        {row.original.role || "—"}
      </span>
    ),
  },
];

function SubAgentsPage() {
  const { agentId } = Route.useParams();
  const { tenant, tenantId } = useTenant();

  const [result, reexecute] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });

  const agent = result.data?.agent;
  const subAgents: SubAgent[] = ((agent as any)?.subAgents ?? []) as SubAgent[];

  const [, createAgent] = useMutation(CreateSubAgentMutation);
  const [, deleteAgent] = useMutation(DeleteAgentMutation);

  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: agent?.name ?? "...", href: `/agents/${agentId}` },
    { label: "Sub-Agents" },
  ]);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newModel, setNewModel] = useState("us.anthropic.claude-haiku-4-5-20251001-v1:0");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim() || !tenantId) return;
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
      reexecute({ requestPolicy: "network-only" });
    } catch (err) {
      console.error("Failed to create sub-agent:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (sub: SubAgent) => {
    if (!confirm(`Delete sub-agent "${sub.name}"?`)) return;
    await deleteAgent({ id: sub.id });
    reexecute({ requestPolicy: "network-only" });
  };

  if (result.fetching && !result.data) return <PageSkeleton />;

  // Add delete action column
  const columnsWithActions: ColumnDef<SubAgent>[] = [
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
            <BotMessageSquare className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
              Sub-Agents
            </h1>
            {subAgents.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {subAgents.length}
              </Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Sub-Agent
          </Button>
        </div>
      }
    >
      {subAgents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <BotMessageSquare className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No sub-agents yet. Sub-agents are specialized tools that run inside {agent?.name}'s process.
          </p>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create Sub-Agent
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columnsWithActions}
          data={subAgents}
          onRowClick={(row) => window.location.href = `/agents/${row.id}`}
          pageSize={0}
        />
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent style={{ maxWidth: 480 }}>
          <DialogHeader>
            <DialogTitle>New Sub-Agent</DialogTitle>
            <DialogDescription>
              Create a specialized sub-agent that runs inside {agent?.name}'s process as a tool.
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
                placeholder="Describe what this sub-agent specializes in. This becomes the tool description."
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
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Use a cheaper/faster model for simple tasks.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || creating}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
