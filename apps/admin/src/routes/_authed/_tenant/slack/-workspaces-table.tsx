import { type ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { relativeTime } from "@/lib/utils";

export type SlackWorkspaceRow = {
  id: string;
  slackTeamId: string;
  slackTeamName: string | null;
  botUserId: string;
  appId: string;
  status: string;
  installedAt: string;
  updatedAt: string;
};

interface WorkspacesTableProps {
  rows: SlackWorkspaceRow[];
  uninstallingId: string | null;
  onUninstall: (row: SlackWorkspaceRow) => void;
}

export function WorkspacesTable({
  rows,
  uninstallingId,
  onUninstall,
}: WorkspacesTableProps) {
  const columns: ColumnDef<SlackWorkspaceRow>[] = [
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={
            row.original.status === "active"
              ? "bg-green-500/15 text-green-700 dark:text-green-400"
              : "bg-muted text-muted-foreground"
          }
        >
          {row.original.status}
        </Badge>
      ),
      size: 110,
    },
    {
      accessorKey: "slackTeamName",
      header: "Workspace",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-medium">
            {row.original.slackTeamName || row.original.slackTeamId}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {row.original.slackTeamId}
          </div>
        </div>
      ),
      size: 260,
    },
    {
      accessorKey: "botUserId",
      header: "Bot User",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.botUserId}
        </span>
      ),
      size: 140,
    },
    {
      accessorKey: "installedAt",
      header: "Installed",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.installedAt)}
        </span>
      ),
      size: 130,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={
              row.original.status !== "active" ||
              uninstallingId === row.original.id
            }
            onClick={(event) => {
              event.stopPropagation();
              onUninstall(row.original);
            }}
            aria-label={`Uninstall ${row.original.slackTeamName || row.original.slackTeamId}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
      size: 70,
    },
  ];

  return (
    <DataTable columns={columns} data={rows} tableClassName="table-fixed" />
  );
}
