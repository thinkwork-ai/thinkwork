import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RemoveSpaceMemberMutation,
  SpaceMembersQuery,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";
import { AddSpaceMemberDialog } from "@/components/spaces/AddSpaceMemberDialog";

interface SpaceMembersPanelProps {
  spaceId: string;
  tenantId: string;
}

type MemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string | null;
};

const ROLE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  OWNER: "default",
  ADMIN: "secondary",
  MEMBER: "outline",
  VIEWER: "outline",
};

export function SpaceMembersPanel({
  spaceId,
  tenantId,
}: SpaceMembersPanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [removingUserIds, setRemovingUserIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [{ data, fetching, error }, reexecute] = useQuery({
    query: SpaceMembersQuery,
    variables: { id: spaceId },
    requestPolicy: "cache-and-network",
  });
  const [, removeMember] = useMutation(RemoveSpaceMemberMutation);

  const space = data?.space;
  const rows: MemberRow[] = useMemo(
    () =>
      (space?.members ?? []).map((member) => ({
        id: member.id,
        userId: member.userId,
        name: member.user?.name ?? member.user?.email ?? member.userId,
        email: member.user?.email ?? "",
        role: member.role,
        joinedAt: member.createdAt ?? null,
      })),
    [space?.members],
  );
  const existingUserIds = useMemo(() => rows.map((row) => row.userId), [rows]);

  const handleRemove = useCallback(
    async (userId: string) => {
      setRemovingUserIds((current) => {
        if (current.has(userId)) return current;
        const next = new Set(current);
        next.add(userId);
        return next;
      });
      try {
        const result = await removeMember({ spaceId, userId });
        if (result.error) {
          toast.error(result.error.message);
          return;
        }
        toast.success("Member removed.");
        reexecute({ requestPolicy: "network-only" });
      } finally {
        setRemovingUserIds((current) => {
          if (!current.has(userId)) return current;
          const next = new Set(current);
          next.delete(userId);
          return next;
        });
      }
    },
    [reexecute, removeMember, spaceId],
  );

  const columns: ColumnDef<MemberRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "User",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {row.original.name}
            </div>
            {row.original.email && row.original.email !== row.original.name ? (
              <div className="truncate text-xs text-muted-foreground">
                {row.original.email}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <Badge
            variant={ROLE_VARIANTS[row.original.role] ?? "outline"}
            className="whitespace-nowrap text-xs"
          >
            {row.original.role.charAt(0) +
              row.original.role.slice(1).toLowerCase()}
          </Badge>
        ),
        size: 120,
      },
      {
        accessorKey: "joinedAt",
        header: "Joined",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.joinedAt ? relativeTime(row.original.joinedAt) : "—"}
          </span>
        ),
        size: 120,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const isRemoving = removingUserIds.has(row.original.userId);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Member actions for ${row.original.name}`}
                  disabled={isRemoving}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={isRemoving}
                  onSelect={() => handleRemove(row.original.userId)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        size: 60,
      },
    ],
    [handleRemove, removingUserIds],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Members</h2>
          <p className="text-sm text-muted-foreground">
            People who can access this private Space.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" />
          Add member
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error.message}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          pageSize={10}
          tableClassName="table-fixed"
        />
      )}
      {fetching && !data ? (
        <div className="text-xs text-muted-foreground">Loading members…</div>
      ) : null}

      <AddSpaceMemberDialog
        spaceId={spaceId}
        tenantId={tenantId}
        existingUserIds={existingUserIds}
        open={addOpen}
        onOpenChange={setAddOpen}
        onMemberAdded={() => reexecute({ requestPolicy: "network-only" })}
      />
    </div>
  );
}
