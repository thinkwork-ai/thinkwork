import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, DataTable, Input } from "@thinkwork/ui";
import { RefreshCw, Search } from "lucide-react";
import type { SettingsKnowledgeGraphThreadCandidatesQuery } from "@/gql/graphql";

type Candidate =
  SettingsKnowledgeGraphThreadCandidatesQuery["knowledgeGraphThreadCandidates"][number];
type IngestRun = NonNullable<Candidate["lastIngestRun"]>;

export function KnowledgeGraphIngestControls({
  query,
  candidates,
  fetching,
  error,
  ingesting,
  onQueryChange,
  onSelectThread,
  onIngestThread,
  onOpenRun,
}: {
  query: string;
  candidates: Candidate[];
  selectedThreadId: string | null;
  fetching: boolean;
  error?: string | null;
  ingesting: boolean;
  onQueryChange: (value: string) => void;
  onSelectThread: (thread: Candidate) => void;
  onIngestThread: (thread: Candidate) => void;
  onOpenRun: (run: IngestRun, thread: Candidate) => void;
}) {
  const columns: ColumnDef<Candidate>[] = [
    {
      accessorKey: "title",
      header: "Thread",
      cell: ({ row }) => (
        <span className="block min-w-0 px-2">
          <span className="block truncate text-sm font-medium">
            #{row.original.number} {row.original.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {row.original.requesterName ?? "Unknown requester"}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "messageCount",
      header: "Messages",
      size: 86,
      cell: ({ row }) => (
        <span className="block px-2 text-sm text-muted-foreground">
          {row.original.messageCount}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      size: 128,
      cell: ({ row }) => {
        const run = row.original.lastIngestRun;
        if (!run) {
          return (
            <span className="px-2">
              <Badge variant="secondary" className="font-normal">
                Not ingested
              </Badge>
            </span>
          );
        }
        return (
          <span className="px-2">
            <button
              type="button"
              className="rounded-full"
              onClick={(event) => {
                event.stopPropagation();
                onOpenRun(run, row.original);
              }}
              aria-label={`Open ingest ${formatStatus(run.status)}`}
            >
              <Badge
                variant={statusVariant(run.status)}
                className="font-normal"
              >
                {formatStatus(run.status)}
              </Badge>
            </button>
          </span>
        );
      },
    },
    {
      id: "action",
      header: "",
      size: 88,
      cell: ({ row }) => (
        <span className="flex justify-end px-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={ingesting}
            onClick={(event) => {
              event.stopPropagation();
              onIngestThread(row.original);
            }}
          >
            <RefreshCw className="size-3.5" />
            Ingest
          </Button>
        </span>
      ),
    },
  ];

  const emptyState = fetching
    ? "Loading threads..."
    : error
      ? error
      : "No threads found.";

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search threads..."
          className="pl-9"
          aria-label="Search threads"
        />
      </div>
      <DataTable
        columns={columns}
        data={candidates}
        onRowClick={onSelectThread}
        pageSize={8}
        allowHorizontalScroll={false}
        tableClassName="table-fixed"
        emptyState={
          <span className={error ? "text-destructive" : undefined}>
            {emptyState}
          </span>
        }
      />
    </div>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replace(/_/g, " ");
}

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" {
  if (status === "FAILED") return "destructive";
  if (status === "SUCCEEDED") return "default";
  return "secondary";
}
