import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery } from "urql";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from "@thinkwork/ui";
import { SpaceAccessMode } from "@/gql/graphql";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsCreateSpaceMutation,
  SettingsSpacesListQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsTablePane,
} from "@/components/settings/SettingsContent";

type SpaceRow = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  accessMode?: string | null;
  updatedAt?: unknown;
};

function relativeTime(value: unknown): string {
  if (!value) return "—";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export function SettingsSpaces() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const [result, refetch] = useQuery({
    query: SettingsSpacesListQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const rows = useMemo<SpaceRow[]>(() => {
    const list = result.data?.spaces ?? [];
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [result.data]);

  const columns = useMemo<ColumnDef<SpaceRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Space",
        size: 200,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="block max-w-md truncate text-muted-foreground">
            {row.original.description ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "accessMode",
        header: "Access",
        size: 110,
        cell: ({ row }) => (
          <Badge variant="outline">
            {titleCase(row.original.accessMode ?? "public")}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ row }) => (
          <Badge variant="secondary">{titleCase(row.original.status)}</Badge>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        size: 130,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {relativeTime(row.original.updatedAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (result.fetching && !result.data) {
    return (
      <SettingsPane className="max-w-5xl">
        <SettingsHeader title="Spaces" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  if (result.error) {
    return (
      <SettingsPane className="max-w-5xl">
        <SettingsHeader title="Spaces" />
        <div className="flex items-center justify-between rounded-xl border border-border p-6">
          <span className="text-sm text-muted-foreground">
            Couldn’t load spaces.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch({ requestPolicy: "network-only" })}
          >
            Retry
          </Button>
        </div>
      </SettingsPane>
    );
  }

  return (
    <SettingsTablePane
      title="Spaces"
      actions={<Button onClick={() => setCreateOpen(true)}>+ New Space</Button>}
      toolbar={
        <Input
          placeholder="Search spaces…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        filterColumn="name"
        scrollable
        allowHorizontalScroll={false}
        pageSize={25}
        tableClassName="table-fixed"
        onRowClick={(row) =>
          navigate({ to: "/spaces/$spaceId", params: { spaceId: row.id } })
        }
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No spaces yet. Create one to get started.
          </div>
        }
      />
      <NewSpaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tenantId={tenantId ?? ""}
        onCreated={() => {
          refetch({ requestPolicy: "network-only" });
          setCreateOpen(false);
        }}
      />
    </SettingsTablePane>
  );
}

function NewSpaceDialog({
  open,
  onOpenChange,
  tenantId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accessMode, setAccessMode] = useState<SpaceAccessMode>(
    SpaceAccessMode.Public,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [state, createSpace] = useMutation(SettingsCreateSpaceMutation);

  async function onSubmit() {
    setErrorMsg(null);
    const result = await createSpace({
      input: { tenantId, name: name.trim(), description, accessMode },
    });
    if (result.error) {
      setErrorMsg(result.error.message);
      return;
    }
    setName("");
    setDescription("");
    setAccessMode(SpaceAccessMode.Public);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Space</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Access</label>
            <Select
              value={accessMode}
              onValueChange={(v) => setAccessMode(v as SpaceAccessMode)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SpaceAccessMode.Public}>Public</SelectItem>
                <SelectItem value={SpaceAccessMode.Private}>Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {errorMsg ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={state.fetching || !name.trim()}>
            {state.fetching ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
