import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, Plus, FileText } from "lucide-react";
import { useQuery, useMutation } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AgentTemplatesListQuery,
  CreateAgentFromTemplateMutation,
} from "@/lib/graphql-queries";
import { AgentRuntime } from "@/gql/graphql";

export const Route = createFileRoute("/_authed/_tenant/agent-templates/")({
  component: AgentTemplatesPage,
});

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  source: string;
  runtime?: AgentRuntime | null;
  model?: string | null;
  guardrailId?: string | null;
  blockedTools?: any;
  config?: any;
  skills?: any;
  isPublished: boolean;
  createdAt: string;
}

function AgentTemplatesPage() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const navigate = useNavigate();
  useBreadcrumbs([{ label: "Templates" }]);

  const [search, setSearch] = useState("");
  const [useDialogOpen, setUseDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateRow | null>(
    null,
  );
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentSlug, setNewAgentSlug] = useState("");

  const [result] = useQuery({
    query: AgentTemplatesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const [, createFromTemplate] = useMutation(CreateAgentFromTemplateMutation);
  if (result.fetching && !result.data) return <PageSkeleton />;
  if (result.error) {
    console.error("Agent templates query error:", result.error.message);
  }

  const templates: TemplateRow[] = (result.data?.agentTemplates ??
    []) as TemplateRow[];

  // Filter by search
  const rows = search
    ? templates.filter(
        (t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.description?.toLowerCase().includes(search.toLowerCase()),
      )
    : templates;

  const getSkillCount = (skills: any): number => {
    if (!skills) return 0;
    const parsed = typeof skills === "string" ? JSON.parse(skills) : skills;
    return Array.isArray(parsed) ? parsed.length : 0;
  };

  const formatHarness = (runtime: AgentRuntime | null | undefined): string => {
    if (!runtime) return "—";
    return runtime.charAt(0) + runtime.slice(1).toLowerCase();
  };

  const formatModel = (model: string | null | undefined): string => {
    if (!model) return "—";
    const m = model.toLowerCase();
    if (m.includes("sonnet")) return "Sonnet";
    if (m.includes("haiku")) return "Haiku";
    if (m.includes("opus")) return "Opus";
    if (m.includes("kimi")) return "Kimi K2.5";
    if (m.includes("nova")) return "Nova";
    const short = model
      .replace(/^(us\.|eu\.)/, "")
      .split(":")[0]
      .split("/")
      .pop();
    return short || model;
  };

  const handleUseTemplate = async () => {
    if (!selectedTemplate || !newAgentName) return;
    const res = await createFromTemplate({
      input: {
        templateId: selectedTemplate.id,
        name: newAgentName,
        slug: newAgentSlug || newAgentName.toLowerCase().replace(/\s+/g, "-"),
      },
    });
    if (res.data?.createAgentFromTemplate?.id) {
      setUseDialogOpen(false);
      navigate({
        to: "/agents/$agentId",
        params: { agentId: res.data.createAgentFromTemplate.id },
      });
    }
  };

  const columns: ColumnDef<TemplateRow, any>[] = [
    {
      accessorKey: "name",
      header: "Name",
      size: 180,
      cell: ({ row }) => (
        <span className="font-medium whitespace-nowrap pl-3">
          {row.original.icon ? `${row.original.icon} ` : ""}
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
      id: "harness",
      header: "Harness",
      size: 110,
      cell: ({ row }) =>
        row.original.runtime ? (
          <Badge variant="outline" className="text-[10px]">
            {formatHarness(row.original.runtime)}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      id: "model",
      header: "Model",
      size: 130,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {formatModel(row.original.model)}
        </span>
      ),
    },
    {
      id: "skills",
      header: "Skills",
      size: 80,
      cell: ({ row }) => {
        const count = getSkillCount(row.original.skills);
        return (
          <span className="text-muted-foreground text-sm">
            {count > 0 ? count : "—"}
          </span>
        );
      },
    },
    {
      id: "source",
      header: "Source",
      size: 90,
      cell: ({ row }) =>
        row.original.source === "system" ? (
          <Badge variant="secondary" className="text-[10px]">
            System
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[10px] border-primary text-primary"
          >
            Custom
          </Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      size: 80,
      cell: ({ row }) => (
        <div className="pr-3">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedTemplate(row.original);
              setNewAgentName("");
              setNewAgentSlug("");
              setUseDialogOpen(true);
            }}
          >
            Use
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Templates"
            description="Define capability and security boundaries for agents"
            actions={
              <>
                <Button
                  onClick={() => navigate({ to: "/agent-templates/new" })}
                >
                  <Plus className="h-4 w-4" />
                  Create Template
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate({ to: "/agent-templates/defaults" })}
                >
                  <FileText className="h-4 w-4" />
                  Default Workspace
                </Button>
              </>
            }
          />
          <div className="flex items-center gap-4 mt-4">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </>
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        scrollable
        tableClassName="table-fixed"
        onRowClick={(row) =>
          navigate({
            to: "/agent-templates/$templateId",
            params: { templateId: row.id },
          })
        }
      />

      {/* Create Agent from Template Dialog */}
      <Dialog open={useDialogOpen} onOpenChange={setUseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Create Agent from "{selectedTemplate?.name}"
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Agent Name</Label>
              <Input
                id="agent-name"
                placeholder="My Support Agent"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-slug">Slug (optional)</Label>
              <Input
                id="agent-slug"
                placeholder="my-support-agent"
                value={newAgentSlug}
                onChange={(e) => setNewAgentSlug(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUseDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUseTemplate} disabled={!newAgentName}>
              Create Agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
