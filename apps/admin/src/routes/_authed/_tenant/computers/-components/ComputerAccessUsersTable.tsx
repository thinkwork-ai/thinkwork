import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2, Pencil, Users } from "lucide-react";
import { toast } from "sonner";
import {
  ComputerAccessUsersQuery,
  SetComputerAssignmentsMutation,
  TenantMembersListQuery,
} from "@/lib/graphql-queries";
import {
  accessSourceLabel,
  buildComputerAssignmentTargets,
} from "@/lib/computer-assignment-utils";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ComputerAssignmentAccessSource } from "@/gql/graphql";

interface ComputerAccessUsersTableProps {
  computerId: string;
  tenantId: string;
  refreshKey?: number;
  onUpdated?: () => void;
}

type AccessUserRow = {
  userId: string;
  name: string;
  email: string;
  accessSource: ComputerAssignmentAccessSource;
};

const columns: ColumnDef<AccessUserRow>[] = [
  {
    accessorKey: "name",
    header: "User",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{row.original.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {row.original.email}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "accessSource",
    header: "Access",
    cell: ({ row }) => (
      <Badge variant="outline" className="whitespace-nowrap text-xs">
        {accessSourceLabel(row.original.accessSource)}
      </Badge>
    ),
    size: 140,
  },
];

export function ComputerAccessUsersTable({
  computerId,
  tenantId,
  refreshKey = 0,
  onUpdated,
}: ComputerAccessUsersTableProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [result, reexecute] = useQuery({
    query: ComputerAccessUsersQuery,
    variables: { computerId },
    requestPolicy: "cache-and-network",
  });
  const [membersResult] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId },
    pause: !editOpen,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: saving }, setAssignments] = useMutation(
    SetComputerAssignmentsMutation,
  );

  useEffect(() => {
    if (refreshKey === 0) return;
    reexecute({ requestPolicy: "network-only" });
  }, [refreshKey, reexecute]);

  const rows: AccessUserRow[] = useMemo(
    () =>
      (result.data?.computerAccessUsers ?? []).map((access) => ({
        userId: access.userId,
        name: access.user.name ?? access.user.email ?? access.userId,
        email: access.user.email ?? "",
        accessSource: access.accessSource,
      })),
    [result.data],
  );
  const serverUserIds = useMemo(() => rows.map((row) => row.userId), [rows]);
  const users = useMemo(
    () =>
      (membersResult.data?.tenantMembers ?? [])
        .filter((member) => member.principalType.toUpperCase() === "USER")
        .filter((member) => member.user)
        .map((member) => ({
          id: member.user!.id,
          name: member.user!.name ?? member.user!.email ?? member.user!.id,
          email: member.user!.email ?? "",
        })),
    [membersResult.data],
  );
  const loadingUsers = membersResult.fetching && !membersResult.data;
  const dirty = !sameSet(selectedUserIds, serverUserIds);

  function openEditor() {
    setSelectedUserIds(serverUserIds);
    setEditOpen(true);
  }

  async function saveAssignments() {
    const result = await setAssignments({
      input: {
        computerId,
        assignments: buildComputerAssignmentTargets(selectedUserIds, []),
      },
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Computer access updated");
    setEditOpen(false);
    reexecute({ requestPolicy: "network-only" });
    onUpdated?.();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4 text-cyan-600" />
                Users With Access
              </CardTitle>
              <CardDescription>
                People who can message and use this shared Computer.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={openEditor}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {result.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {result.error.message}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              pageSize={5}
              tableClassName="table-fixed"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Users With Access</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {membersResult.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                {membersResult.error.message}
              </div>
            ) : null}
            <UserChecklist
              emptyLabel={loadingUsers ? "Loading users..." : "No users"}
              users={users}
              selectedIds={selectedUserIds}
              disabled={saving || loadingUsers}
              onToggle={(id, checked) =>
                toggleSelection(setSelectedUserIds, id, checked)
              }
            />
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveAssignments}
              disabled={!dirty || saving || loadingUsers}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserChecklist({
  emptyLabel,
  users,
  selectedIds,
  disabled,
  onToggle,
}: {
  emptyLabel: string;
  users: { id: string; name: string; email?: string }[];
  selectedIds: string[];
  disabled: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
      {users.length === 0 ? (
        <div className="px-2 py-3 text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        users.map((user) => (
          <label
            key={user.id}
            className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={selectedIds.includes(user.id)}
              disabled={disabled}
              onCheckedChange={(checked) => onToggle(user.id, checked === true)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block truncate">{user.name}</span>
              {user.email && user.email !== user.name ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              ) : null}
            </span>
          </label>
        ))
      )}
    </div>
  );
}

function toggleSelection(
  setSelected: Dispatch<SetStateAction<string[]>>,
  id: string,
  checked: boolean,
) {
  setSelected((current) => {
    if (checked) return current.includes(id) ? current : [...current, id];
    return current.filter((value) => value !== id);
  });
}

function sameSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}
