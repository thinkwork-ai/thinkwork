import { Link } from "@tanstack/react-router";
import { Circle } from "lucide-react";
import { SidebarGroup, SidebarGroupLabel } from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import {
  formatCompactCount,
  formatRelativeDate,
  isThreadUnread,
  threadActivityAt,
  threadTitle,
  type ChatThreadSummary,
} from "./chat-sidebar-types";

interface GlobalInboxSectionProps {
  threads: ChatThreadSummary[];
  totalCount: number;
  isLoading?: boolean;
  error?: string | null;
}

export function GlobalInboxSection({
  threads,
  totalCount,
  isLoading = false,
  error,
}: GlobalInboxSectionProps) {
  return (
    <SidebarGroup className="px-3 group-data-[collapsible=icon]:hidden">
      <div className="mb-1 flex items-center justify-between gap-2">
        <SidebarGroupLabel className="h-auto px-0 text-[0.78rem] font-semibold text-sidebar-foreground">
          Inbox {totalCount > 0 ? `(${formatCompactCount(totalCount)})` : ""}
        </SidebarGroupLabel>
        {totalCount > 0 ? (
          <button
            type="button"
            className="text-xs font-medium text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground"
          >
            Mark as read
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="rounded-md border border-destructive/40 px-2 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : isLoading ? (
        <p className="px-2 py-2 text-xs text-sidebar-foreground/60">
          Loading inbox...
        </p>
      ) : threads.length === 0 ? (
        <p className="px-2 py-2 text-xs text-sidebar-foreground/55">
          No unread threads
        </p>
      ) : (
        <div className="space-y-0.5">
          {threads.map((thread) => (
            <InboxThreadRow key={thread.id} thread={thread} />
          ))}
        </div>
      )}
    </SidebarGroup>
  );
}

function InboxThreadRow({ thread }: { thread: ChatThreadSummary }) {
  const unread = isThreadUnread(thread);
  const activity = threadActivityAt(thread);
  const spaceName = thread.space?.name ?? thread.space?.slug ?? "No Space";

  const content = (
    <>
      <span
        className={cn(
          "mt-1 size-2 shrink-0 rounded-full",
          unread ? "bg-blue-500" : "bg-sidebar-foreground/20",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-5">
          {threadTitle(thread)}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-sidebar-foreground/55">
          <span className="truncate">{spaceName}</span>
          {activity ? (
            <>
              <Circle className="size-1 fill-current" />
              <span className="shrink-0">{formatRelativeDate(activity)}</span>
            </>
          ) : null}
        </span>
      </span>
    </>
  );

  if (thread.spaceId) {
    return (
      <Link
        to="/spaces/$spaceId/threads/$threadId"
        params={{ spaceId: thread.spaceId, threadId: thread.id }}
        className="flex min-w-0 items-start gap-2 rounded-md px-2 py-2 text-sidebar-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        {content}
      </Link>
    );
  }

  return (
    <Link
      to="/threads/$id"
      params={{ id: thread.id }}
      className="flex min-w-0 items-start gap-2 rounded-md px-2 py-2 text-sidebar-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      {content}
    </Link>
  );
}
