import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, Search, Workflow } from "lucide-react";
import { useState, useMemo } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ImportN8nRoutineMutation,
  RoutinesListQuery,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/automations/routines/")({
  component: RoutinesPage,
});

type RoutineRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  lastRunAt: string | null;
  createdAt: string;
};

const columns: ColumnDef<RoutineRow>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
    ),
    size: 90,
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium whitespace-nowrap">{row.original.name}</span>
    ),
    size: 240,
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => (
      <div className="text-muted-foreground text-sm truncate overflow-hidden">
        {row.original.description ?? "—"}
      </div>
    ),
  },
  {
    accessorKey: "lastRunAt",
    header: "Last Execution",
    cell: ({ row }) =>
      row.original.lastRunAt ? (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.lastRunAt)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Never</span>
      ),
    size: 130,
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {relativeTime(row.original.createdAt)}
      </span>
    ),
    size: 90,
  },
];

function RoutinesPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [workflowUrl, setWorkflowUrl] = useState(
    "https://n8n.lastmile-tei.com/workflow/_JUTpWjHOd4jtUSQ66sYr",
  );
  const [routineName, setRoutineName] = useState("PDI Fuel Order");
  const [n8nCredentialSlug, setN8nCredentialSlug] = useState("n8n-api");
  const [pdiCredentialSlug, setPdiCredentialSlug] = useState("pdi-soap");
  const [importError, setImportError] = useState<string | null>(null);
  useBreadcrumbs([{ label: "Routines" }]);

  const [result] = useQuery({
    query: RoutinesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [importState, executeImport] = useMutation(ImportN8nRoutineMutation);

  const routines = result.data?.routines ?? [];

  const rows: RoutineRow[] = useMemo(
    () =>
      routines
        // Phase E U15: hide legacy Python routines. Phase A introduced
        // the engine partition so the operator-facing list stays focused
        // on the Step Functions substrate; legacy_python rows are
        // archived in migration 0057 and not actionable from this UI.
        .filter((r: any) => r.engine !== "legacy_python")
        .map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? null,
          status: r.status,
          lastRunAt: r.lastRunAt ?? null,
          createdAt: r.createdAt,
        })),
    [routines],
  );

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  const handleImport = async () => {
    if (!tenantId || importState.fetching) return;
    setImportError(null);
    const result = await executeImport({
      input: {
        tenantId,
        workflowUrl: workflowUrl.trim(),
        name: routineName.trim() || undefined,
        n8nCredentialSlug: n8nCredentialSlug.trim() || undefined,
        pdiCredentialSlug: pdiCredentialSlug.trim() || undefined,
      },
    });
    if (result.error) {
      setImportError(cleanError(result.error.message));
      return;
    }

    const routineId = result.data?.importN8nRoutine?.id;
    if (routineId) {
      setImportOpen(false);
      navigate({
        to: "/automations/routines/$routineId",
        params: { routineId },
      });
    }
  };

  return (
    <PageLayout header={<PageHeader title="Routines" />}>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search routines..."
            className="pl-7 text-sm"
          />
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <Workflow className="h-4 w-4 mr-1" />
          Import n8n
        </Button>
        <Button size="sm" asChild>
          <Link to="/automations/routines/new">
            <Plus className="h-4 w-4 mr-1" />
            New Routine
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        tableClassName="table-fixed"
        onRowClick={(row) =>
          navigate({
            to: "/automations/routines/$routineId",
            params: { routineId: row.id },
          })
        }
      />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import n8n workflow</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="n8n-workflow-url">Workflow URL</Label>
              <Input
                id="n8n-workflow-url"
                value={workflowUrl}
                onChange={(event) => setWorkflowUrl(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="n8n-routine-name">Routine name</Label>
              <Input
                id="n8n-routine-name"
                value={routineName}
                onChange={(event) => setRoutineName(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="n8n-credential-slug">n8n credential slug</Label>
                <Input
                  id="n8n-credential-slug"
                  value={n8nCredentialSlug}
                  onChange={(event) => setN8nCredentialSlug(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pdi-credential-slug">PDI credential slug</Label>
                <Input
                  id="pdi-credential-slug"
                  value={pdiCredentialSlug}
                  onChange={(event) => setPdiCredentialSlug(event.target.value)}
                />
              </div>
            </div>
            {importError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {importError}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={importState.fetching || !workflowUrl.trim()}
            >
              {importState.fetching ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

function cleanError(message: string): string {
  return message.replace(/\[GraphQL\]\s*/g, "").trim();
}
