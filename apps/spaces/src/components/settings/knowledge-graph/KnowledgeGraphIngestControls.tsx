import { Badge, Button, Input } from "@thinkwork/ui";
import { RefreshCw, Search } from "lucide-react";
import type { SettingsKnowledgeGraphThreadCandidatesQuery } from "@/gql/graphql";

type Candidate =
  SettingsKnowledgeGraphThreadCandidatesQuery["knowledgeGraphThreadCandidates"][number];

export function KnowledgeGraphIngestControls({
  query,
  candidates,
  selectedThreadId,
  fetching,
  error,
  ingesting,
  onQueryChange,
  onSelectThread,
  onIngest,
}: {
  query: string;
  candidates: Candidate[];
  selectedThreadId: string | null;
  fetching: boolean;
  error?: string | null;
  ingesting: boolean;
  onQueryChange: (value: string) => void;
  onSelectThread: (thread: Candidate) => void;
  onIngest: () => void;
}) {
  const selected = candidates.find(
    (candidate) => candidate.threadId === selectedThreadId,
  );

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
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
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {fetching ? (
              <span className="text-sm text-muted-foreground">
                Loading threads...
              </span>
            ) : error ? (
              <span className="text-sm text-destructive">{error}</span>
            ) : candidates.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                No threads found.
              </span>
            ) : (
              candidates.slice(0, 8).map((candidate) => (
                <button
                  key={candidate.threadId}
                  type="button"
                  className={`min-w-[220px] rounded-md border px-3 py-2 text-left transition-colors ${
                    candidate.threadId === selectedThreadId
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/60"
                  }`}
                  onClick={() => onSelectThread(candidate)}
                >
                  <p className="truncate text-sm font-medium">
                    #{candidate.number} {candidate.title}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {candidate.requesterName ?? "Unknown requester"} ·{" "}
                    {candidate.messageCount} messages
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 lg:w-48">
          <Button
            type="button"
            disabled={!selectedThreadId || ingesting}
            onClick={onIngest}
          >
            <RefreshCw className="size-4" />
            Ingest now
          </Button>
          {selected?.lastIngestRun ? (
            <Badge variant="outline" className="w-fit font-normal">
              Last {selected.lastIngestRun.status.toLowerCase()}
            </Badge>
          ) : selected ? (
            <Badge variant="secondary" className="w-fit font-normal">
              Not ingested
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}
