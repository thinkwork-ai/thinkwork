import { useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import { AgentDetailQuery, AgentKnowledgeBasesQuery, SetAgentKnowledgeBasesMutation } from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageLayout } from "@/components/PageLayout";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KnowledgeBasesPanel } from "@/components/agents/KnowledgeBasesPanel";

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId_/knowledge")({
  component: AgentKnowledgePage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KbRow = {
  knowledgeBaseId: string;
  name: string;
  description: string;
  status: string;
  enabled: boolean;
};

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const kbColumns: ColumnDef<KbRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{row.original.name}</span>
        {row.original.description && (
          <span className="text-xs text-muted-foreground line-clamp-1">{row.original.description}</span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status?.toLowerCase() ?? "unknown";
      const isActive = status === "active" || status === "ready";
      return (
        <Badge
          variant="secondary"
          className={`text-xs ${isActive ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
        >
          {isActive ? "Active" : status}
        </Badge>
      );
    },
    size: 110,
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AgentKnowledgePage() {
  const { agentId } = Route.useParams();

  const [agentResult] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });

  const [kbResult, reexecuteKbs] = useQuery({
    query: AgentKnowledgeBasesQuery,
    variables: { id: agentId },
  });

  const agent = agentResult.data?.agent;
  const knowledgeBases = ((kbResult.data as any)?.agent?.knowledgeBases ?? []) as any[];

  const refresh = useCallback(() => {
    reexecuteKbs({ requestPolicy: "network-only" });
  }, [reexecuteKbs]);

  const tableData: KbRow[] = knowledgeBases.map((kb: any) => ({
    knowledgeBaseId: kb.knowledgeBaseId,
    name: kb.knowledgeBase?.name ?? kb.knowledgeBaseId,
    description: kb.knowledgeBase?.description ?? "",
    status: kb.knowledgeBase?.status ?? "unknown",
    enabled: kb.enabled,
  }));

  const [showPanel, setShowPanel] = useState(false);

  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: agent?.name ?? "...", href: `/agents/${agentId}` },
    { label: "Knowledge" },
  ]);

  if (agentResult.fetching && !agentResult.data) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <div className="flex items-center justify-between w-full">
          <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
            Knowledge Bases
          </h1>
          <Button variant="outline" size="sm" onClick={() => setShowPanel(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Manage KBs
          </Button>
        </div>
      }
    >
      {tableData.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No knowledge bases assigned to this agent.</p>
      ) : (
        <DataTable columns={kbColumns} data={tableData} pageSize={0} />
      )}

      {/* Full KnowledgeBasesPanel in dialog for add/remove flows */}
      {showPanel && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center" onClick={() => setShowPanel(false)}>
          <div className="bg-card border rounded-lg shadow-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Manage Knowledge Bases</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowPanel(false)}>Close</Button>
            </div>
            <KnowledgeBasesPanel
              agentId={agentId}
              knowledgeBases={knowledgeBases}
              onSave={() => { refresh(); setShowPanel(false); }}
            />
          </div>
        </div>
      )}
    </PageLayout>
  );
}
