import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Boxes, Plus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  description: string | null;
  accessMode: string;
  status: string;
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
    size: 200,
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
    accessorKey: "accessMode",
    header: "Access",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs whitespace-nowrap">
        {formatLabel(row.original.accessMode)}
      </Badge>
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
    return (result.data?.spaces ?? [])
      .map((space) => ({
        id: space.id,
        name: space.name,
        description: space.description ?? null,
        accessMode: space.accessMode,
        status: space.status,
        updatedAt: space.updatedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [result.data?.spaces]);

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Spaces"
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
          icon={Boxes}
          title="No Spaces yet"
          description="Spaces will appear here as contextual workrooms are seeded."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          filterValue={search}
          pageSize={20}
          scrollable
          onRowClick={(row) =>
            navigate({
              to: "/spaces/$spaceId/workspace",
              params: { spaceId: row.id },
            })
          }
        />
      )}
      <NewSpaceDialog
        tenantId={tenantId}
        open={newSpaceOpen}
        onOpenChange={setNewSpaceOpen}
        onCreated={(spaceId) => {
          reexecuteSpaces({ requestPolicy: "network-only" });
          void navigate({
            to: "/spaces/$spaceId/workspace",
            params: { spaceId },
          });
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
  const [accessMode, setAccessMode] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
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
        accessMode,
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
    setAccessMode("PUBLIC");
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
            <div className="space-y-1.5">
              <Label htmlFor="space-access">Access</Label>
              <Select
                value={accessMode}
                onValueChange={(value) =>
                  setAccessMode(value as "PUBLIC" | "PRIVATE")
                }
              >
                <SelectTrigger id="space-access">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">Public</SelectItem>
                  <SelectItem value="PRIVATE">Private</SelectItem>
                </SelectContent>
              </Select>
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
