import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Input } from "@thinkwork/ui";
import {
  CheckCircle2,
  Clock3,
  Search,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { SettingsKnowledgeGraphThreadCandidatesQuery } from "@/gql/graphql";

type Candidate =
  SettingsKnowledgeGraphThreadCandidatesQuery["knowledgeGraphThreadCandidates"][number];
type IngestRun = NonNullable<Candidate["lastIngestRun"]>;

export function KnowledgeGraphIngestControls({
  query,
  candidates,
  fetching,
  error,
  onQueryChange,
  onSelectThread,
}: {
  query: string;
  candidates: Candidate[];
  fetching: boolean;
  error?: string | null;
  onQueryChange: (value: string) => void;
  onSelectThread: (thread: Candidate) => void;
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
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      size: 48,
      cell: ({ row }) => {
        const run = row.original.lastIngestRun;
        return <StatusIcon run={run ?? null} />;
      },
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
        pageSize={0}
        hideHeader
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

function StatusIcon({ run }: { run: IngestRun | null }) {
  const status = run?.status ?? "NOT_INGESTED";
  const { Icon, className, label } = statusIcon(status);
  return (
    <span className="flex h-10 items-center justify-center px-2">
      <Icon className={`size-4 ${className}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function statusIcon(status: string): {
  Icon: LucideIcon;
  className: string;
  label: string;
} {
  if (status === "SUCCEEDED") {
    return {
      Icon: CheckCircle2,
      className: "text-emerald-500",
      label: "Ingest succeeded",
    };
  }
  if (status === "FAILED") {
    return {
      Icon: XCircle,
      className: "text-destructive",
      label: "Ingest failed",
    };
  }
  return {
    Icon: Clock3,
    className: "text-muted-foreground",
    label: status === "NOT_INGESTED" ? "Not ingested" : "Ingest pending",
  };
}
