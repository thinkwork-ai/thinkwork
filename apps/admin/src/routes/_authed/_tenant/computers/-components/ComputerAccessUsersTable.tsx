import { useEffect, useMemo } from "react";
import { useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";
import { ComputerAccessUsersQuery } from "@/lib/graphql-queries";
import { accessSourceLabel } from "@/lib/computer-assignment-utils";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ComputerAssignmentAccessSource } from "@/gql/graphql";

interface ComputerAccessUsersTableProps {
  computerId: string;
  refreshKey?: number;
}

type AccessUserRow = {
  userId: string;
  name: string;
  email: string;
  accessSource: ComputerAssignmentAccessSource;
  teams: string[];
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
  {
    accessorKey: "teams",
    header: "Teams",
    cell: ({ row }) =>
      row.original.teams.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.original.teams.map((team) => (
            <Badge key={team} variant="secondary" className="text-xs">
              {team}
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
];

export function ComputerAccessUsersTable({
  computerId,
  refreshKey = 0,
}: ComputerAccessUsersTableProps) {
  const [result, reexecute] = useQuery({
    query: ComputerAccessUsersQuery,
    variables: { computerId },
    requestPolicy: "cache-and-network",
  });

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
        teams: access.teams.map((team) => team.name),
      })),
    [result.data],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-cyan-600" />
          Users With Access
        </CardTitle>
        <CardDescription>
          Effective access from direct assignments and Team membership.
        </CardDescription>
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
  );
}
