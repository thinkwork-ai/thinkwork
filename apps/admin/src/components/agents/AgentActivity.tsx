import { useMemo, useCallback } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
  MessageSquare,
  Mail,
  MessagesSquare,
  CalendarClock,
  Bot,
  Webhook,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { cn, relativeTime } from "@/lib/utils";
import {
  type ActivityItem,
  TYPE_LABELS,
  TYPE_COLORS,
  STATUS_COLORS,
  formatCost,
} from "@/lib/activity-utils";

interface AgentActivityProps {
  items: ActivityItem[];
  onRefresh?: () => void;
  agentId?: string;
  agentName?: string;
}

export function AgentActivity({ items, onRefresh, agentId, agentName }: AgentActivityProps) {
  const navigate = useNavigate();

  const handleRowClick = useCallback((item: ActivityItem) => {
    const threadId = item.sourceType === "thread" ? item.sourceId : item.threadId;
    if (threadId) {
      navigate({
        to: "/threads/$threadId",
        params: { threadId },
        search: agentId ? { fromAgentId: agentId, fromAgentName: agentName } : {},
      });
    }
  }, [navigate, agentId, agentName]);

  const columns = useMemo((): ColumnDef<ActivityItem>[] => [
    {
      id: "type",
      size: 120,
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center pl-3">
            <Badge variant="secondary" className={cn("text-xs gap-1", TYPE_COLORS[item.type])}>
              {item.type === "chat" && <MessageSquare className="h-3 w-3" />}
              {item.type === "thread" && <MessagesSquare className="h-3 w-3" />}
              {item.type === "email" && <Mail className="h-3 w-3" />}
              {item.type === "scheduled" && <CalendarClock className="h-3 w-3" />}
              {item.type === "webhook" && <Webhook className="h-3 w-3" />}
              {(item.type === "routine" || item.type === "task") && <Bot className="h-3 w-3" />}
              {TYPE_LABELS[item.type]}
            </Badge>
          </div>
        );
      },
    },
    {
      id: "content",
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex h-10 items-center gap-2.5 pr-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
            <span className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
              <Badge
                variant="secondary"
                className={cn("text-xs capitalize", STATUS_COLORS[item.status] ?? "bg-muted text-muted-foreground")}
              >
                {item.status.replace(/_/g, " ")}
              </Badge>
              <span className="text-xs text-muted-foreground w-16 text-right tabular-nums">
                {formatCost(item.cost)}
              </span>
              <span className="text-xs text-muted-foreground w-16 text-right">
                {relativeTime(new Date(item.timestamp).toISOString())}
              </span>
            </span>
          </div>
        );
      },
    },
  ], []);

  return (
    <div className="space-y-2">
      {items.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Recent Activity</h3>
            <div className="flex items-center gap-3">
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Refresh
                </button>
              )}
              <Link to="/analytics" className="text-xs text-muted-foreground hover:text-foreground">
                View all activity
              </Link>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={items}
            hideHeader
            compact
            onRowClick={handleRowClick}
            tableClassName="table-fixed"
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground py-4">No activity yet</p>
      )}

    </div>
  );
}


