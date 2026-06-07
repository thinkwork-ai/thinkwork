import { Link } from "@tanstack/react-router";
import { Archive, CircleAlert, CircleCheck, Clock, Search } from "lucide-react";
import { Badge, Input } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { cn } from "@/lib/utils";
import {
  formatSpaceDate,
  formatSpaceLabel,
  sourceContextFromThreadMetadata,
  type SpaceThreadSummary,
} from "./space-types";

interface SpaceThreadListProps {
  spaceId: string;
  threads: SpaceThreadSummary[];
  selectedThreadId?: string | null;
  totalCount: number;
  search: string;
  isLoading?: boolean;
  error?: string | null;
  onSearchChange: (search: string) => void;
}

export function SpaceThreadList({
  threads,
  selectedThreadId,
  totalCount,
  search,
  isLoading = false,
  error,
  onSearchChange,
}: SpaceThreadListProps) {
  return (
    <section className="flex min-h-0 flex-col border-r bg-background">
      <div className="shrink-0 border-b p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="h-9 pl-9"
            placeholder="Search"
            aria-label="Search Space threads"
          />
        </label>
        <div className="mt-2 text-xs text-muted-foreground">
          {isLoading
            ? "Loading..."
            : `${totalCount} thread${totalCount === 1 ? "" : "s"}`}
        </div>
      </div>
      {error ? (
        <SpaceThreadListState label={error} tone="error" />
      ) : isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <LoadingShimmer />
        </div>
      ) : threads.length === 0 ? (
        <SpaceThreadListState label="No onboarding threads" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              selected={thread.id === selectedThreadId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ThreadRow({
  thread,
  selected,
}: {
  thread: SpaceThreadSummary;
  selected: boolean;
}) {
  const context = sourceContextFromThreadMetadata(thread.metadata);
  const title = thread.title?.trim() || "Untitled onboarding";
  const updated = thread.lastActivityAt ?? thread.updatedAt ?? thread.createdAt;

  return (
    <Link
      to="/threads/$id"
      params={{ id: thread.id }}
      className={cn(
        "block border-b px-3 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted",
        selected && "bg-muted",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {thread.identifier ? (
              <span className="font-mono">{thread.identifier}</span>
            ) : null}
            {context.companyName || context.customerName ? (
              <span className="truncate">
                {context.companyName ?? context.customerName}
              </span>
            ) : null}
          </div>
        </div>
        <ThreadStatusBadge
          status={thread.status}
          archived={!!thread.archivedAt}
        />
      </div>
      <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {context.salesRep
            ? `Sales: ${context.salesRep}`
            : formatSpaceLabel(thread.channel)}
        </span>
        <span className="shrink-0">{formatSpaceDate(updated)}</span>
      </div>
    </Link>
  );
}

function ThreadStatusBadge({
  status,
  archived,
}: {
  status?: string | null;
  archived: boolean;
}) {
  if (archived) {
    return (
      <Badge variant="outline" className="gap-1 rounded-full text-xs">
        <Archive className="size-3" />
        Archived
      </Badge>
    );
  }
  const normalized = String(status ?? "").toLowerCase();
  const Icon =
    normalized === "done"
      ? CircleCheck
      : normalized === "blocked"
        ? CircleAlert
        : Clock;
  return (
    <Badge variant="outline" className="gap-1 rounded-full text-xs">
      <Icon className="size-3" />
      {formatSpaceLabel(status) || "Open"}
    </Badge>
  );
}

function SpaceThreadListState({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "error";
}) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground",
        tone === "error" && "text-destructive",
      )}
    >
      {label}
    </div>
  );
}
