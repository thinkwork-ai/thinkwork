import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { FolderKanban, Plus } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { FilterBarSearch } from "@/components/ui/data-table-filter-bar";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { SpaceStatus } from "@/gql/graphql";
import { CreateSpaceMutation, SpacesListQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/spaces/")({
  component: SpacesPage,
});

type SpaceRow = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  memberCount: number;
  agentCount: number;
  checklistItemCount: number;
  integrationCount: number;
  updatedAt: string;
};

const columns: ColumnDef<SpaceRow>[] = [
  {
    accessorKey: "name",
    header: "Space",
    cell: ({ row }) => (
      <span className="block min-w-0 truncate font-medium">
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "kind",
    header: "Kind",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs whitespace-nowrap">
        {formatLabel(row.original.kind)}
      </Badge>
    ),
    size: 170,
  },
  {
    accessorKey: "agentCount",
    header: "Agents",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.agentCount}</span>
    ),
    size: 90,
  },
  {
    accessorKey: "checklistItemCount",
    header: "Checklist",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.checklistItemCount}
      </span>
    ),
    size: 100,
  },
  {
    accessorKey: "memberCount",
    header: "Members",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.memberCount}</span>
    ),
    size: 100,
  },
  {
    accessorKey: "integrationCount",
    header: "Integrations",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.integrationCount}
      </span>
    ),
    size: 110,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.status === SpaceStatus.Active ? "default" : "outline"
        }
        className="text-xs whitespace-nowrap"
      >
        {formatLabel(row.original.status)}
      </Badge>
    ),
    size: 110,
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {relativeTime(row.original.updatedAt)}
      </span>
    ),
    size: 130,
  },
];

function SpacesPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  useBreadcrumbs([{ label: "Spaces" }]);

  const [result, reexecuteSpaces] = useQuery({
    query: SpacesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const rows = useMemo<SpaceRow[]>(() => {
    return (result.data?.spaces ?? []).map((space) => ({
      id: space.id,
      name: space.name,
      slug: space.slug,
      kind: space.kind,
      status: space.status,
      memberCount: space.members.length,
      agentCount: space.agentAssignments.filter(
        (assignment) => assignment.status === "ACTIVE",
      ).length,
      checklistItemCount: space.checklistTemplates.reduce(
        (count, template) => count + template.items.length,
        0,
      ),
      integrationCount: space.integrations.length,
      updatedAt: space.updatedAt,
    }));
  }, [result.data?.spaces]);

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Spaces"
            description="Configure collaborative workspaces, assigned agents, checklists, members, and integration policy."
            actions={
              <Button size="sm" onClick={() => setNewSpaceOpen(true)}>
                <Plus className="h-4 w-4" />
                New Space
              </Button>
            }
          />
          <div className="mt-4 flex items-center gap-2">
            <FilterBarSearch
              value={search}
              onChange={setSearch}
              placeholder="Search spaces..."
              className="w-56"
            />
          </div>
        </>
      }
    >
      {result.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {result.error.message}
        </div>
      ) : rows.length === 0 && !isLoading ? (
        <EmptyState
          icon={FolderKanban}
          title="No Spaces yet"
          description="Spaces will appear here as tenant workspace configuration is seeded."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          filterValue={search}
          pageSize={20}
          scrollable
          onRowClick={(row) =>
            navigate({ to: "/spaces/$spaceId", params: { spaceId: row.id } })
          }
        />
      )}
      <NewSpaceDialog
        tenantId={tenantId}
        open={newSpaceOpen}
        onOpenChange={setNewSpaceOpen}
        onCreated={(spaceId) => {
          reexecuteSpaces({ requestPolicy: "network-only" });
          void navigate({ to: "/spaces/$spaceId", params: { spaceId } });
        }}
      />
    </PageLayout>
  );
}

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function NewSpaceDialog({
  tenantId,
  open,
  onOpenChange,
  onCreated,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (spaceId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [{ fetching }, createSpace] = useMutation(CreateSpaceMutation);
  const canSubmit = name.trim().length > 0 && !fetching;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const response = await createSpace({
      input: {
        tenantId,
        name: name.trim(),
        description: description.trim() || null,
      },
    });

    if (response.error) {
      toast.error(`Could not create Space: ${response.error.message}`);
      return;
    }

    const spaceId = response.data?.createSpace.id;
    if (!spaceId) {
      toast.error("Could not create Space.");
      return;
    }

    toast.success("Space created.");
    setName("");
    setDescription("");
    onOpenChange(false);
    onCreated(spaceId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Space</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="space-name">Name</Label>
              <Input
                id="space-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Implementation"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="space-description">Description</Label>
              <Textarea
                id="space-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={fetching}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Create Space
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
