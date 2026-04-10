import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { PriorityIcon } from "@/components/PriorityIcon";
import { StatusIcon } from "./StatusIcon";
import { Badge } from "@/components/ui/badge";

const boardStatuses = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
];

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface KanbanThread {
  id: string;
  number: number;
  identifier?: string | null;
  title: string;
  status: string;
  priority: string;
  type: string;
  agent?: { id: string; name: string } | null;
  checkoutRunId?: string | null;
}

interface KanbanBoardProps {
  threads: readonly KanbanThread[];
  onUpdateThread?: (id: string, data: Record<string, unknown>) => void;
}

function KanbanColumn({
  status,
  threads,
}: {
  status: string;
  threads: readonly KanbanThread[];
}) {
  return (
    <div className="flex flex-col min-w-[260px] w-[260px] shrink-0">
      <div className="flex items-center gap-2 px-2 py-2 mb-1">
        <StatusIcon status={status} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {statusLabel(status)}
        </span>
        <span className="text-xs text-muted-foreground/60 ml-auto tabular-nums">
          {threads.length}
        </span>
      </div>
      <div className="flex-1 min-h-[120px] rounded-md p-1 space-y-1 bg-muted/20">
        {threads.map((thread) => (
          <KanbanCard key={thread.id} thread={thread} />
        ))}
      </div>
    </div>
  );
}

function KanbanCard({ thread }: { thread: KanbanThread }) {
  const identifier = thread.identifier ?? `#${thread.number}`;

  return (
    <Link
      to="/threads/$threadId"
      params={{ threadId: thread.id }}
      className="block rounded-md border bg-card p-2.5 no-underline text-inherit transition-shadow hover:shadow-sm"
    >
      <div className="flex items-start gap-1.5 mb-1.5">
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          {identifier}
        </span>
      </div>
      <p className="text-sm leading-snug line-clamp-2 mb-2">{thread.title}</p>
      <div className="flex items-center gap-2">
        <PriorityIcon priority={thread.priority} />
        {thread.agent && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {thread.agent.name}
          </Badge>
        )}
      </div>
    </Link>
  );
}

export function KanbanBoard({ threads }: KanbanBoardProps) {
  const columnThreads = useMemo(() => {
    const grouped: Record<string, KanbanThread[]> = {};
    for (const status of boardStatuses) {
      grouped[status] = [];
    }
    for (const item of threads) {
      const key = item.status.toLowerCase();
      if (grouped[key]) {
        grouped[key].push(item);
      }
    }
    return grouped;
  }, [threads]);

  return (
    <div className="min-w-0 overflow-hidden">
      <div className="flex gap-3 overflow-x-auto pb-4 px-2">
        {boardStatuses.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            threads={columnThreads[status] ?? []}
          />
        ))}
      </div>
    </div>
  );
}
