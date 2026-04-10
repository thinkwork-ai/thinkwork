import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { typeLabel, typeIcon, defaultTypeIcon, InboxItemPayloadRenderer } from "./InboxItemPayload";
import { relativeTime } from "@/lib/utils";

function statusIcon(status: string) {
  const s = status.toLowerCase();
  if (s === "approved") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />;
  if (s === "rejected") return <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />;
  if (s === "revision_requested") return <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
  if (s === "pending") return <Clock className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />;
  return null;
}

interface InboxItemCardProps {
  item: {
    id: string;
    type: string;
    status: string;
    title?: string | null;
    config?: string | null;
    revision: number;
    requesterType?: string | null;
    requesterId?: string | null;
    reviewNotes?: string | null;
    createdAt: string;
  };
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
}

export function InboxItemCard({ item, onApprove, onReject, isPending }: InboxItemCardProps) {
  const Icon = typeIcon[item.type] ?? defaultTypeIcon;
  const label = typeLabel[item.type] ?? item.type.replace(/_/g, " ");
  const status = item.status.toLowerCase();
  const payload = item.config ? JSON.parse(item.config) : {};
  const isActionable = status === "pending" || status === "revision_requested";

  return (
    <div className="border border-border rounded-lg p-4 space-y-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{item.title || label}</span>
            {item.revision > 1 && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                v{item.revision}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusIcon(item.status)}
          <span className="text-xs text-muted-foreground capitalize">{status.replace(/_/g, " ")}</span>
          <span className="text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
        </div>
      </div>

      <InboxItemPayloadRenderer type={item.type} payload={payload} />

      {item.reviewNotes && (
        <div className="mt-3 text-xs text-muted-foreground italic border-t border-border pt-2">
          Note: {item.reviewNotes}
        </div>
      )}

      {isActionable && (
        <div className="flex gap-2 mt-4 pt-3 border-t border-border">
          <Button
            size="sm"
            className="bg-green-700 hover:bg-green-600 text-white"
            onClick={onApprove}
            disabled={isPending}
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onReject}
            disabled={isPending}
          >
            Reject
          </Button>
        </div>
      )}
      <div className="mt-3">
        <Button variant="ghost" size="sm" className="text-xs px-0" asChild>
          <Link to="/inbox/$inboxItemId" params={{ inboxItemId: item.id }}>View details</Link>
        </Button>
      </div>
    </div>
  );
}
