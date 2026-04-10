import {
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/utils";

const actionIcons: Record<string, LucideIcon> = {
  created: Plus,
  updated: Pencil,
  deleted: Trash2,
  approved: CheckCircle2,
  rejected: XCircle,
  started: Play,
  paused: Pause,
  error: AlertCircle,
  completed: CheckCircle2,
};

interface ActivityRowProps {
  action: string;
  actorName: string;
  description: string;
  timestamp: Date | string;
  entityType?: string;
  className?: string;
}

export function ActivityRow({
  action,
  actorName,
  description,
  timestamp,
  entityType,
  className,
}: ActivityRowProps) {
  const Icon = actionIcons[action] ?? AlertCircle;

  return (
    <div className={cn("flex items-start gap-3 px-4 py-2 text-sm", className)}>
      <span className="mt-0.5 shrink-0 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="truncate">
          <span className="font-medium">{actorName}</span>
          <span className="text-muted-foreground ml-1">{description}</span>
        </p>
        {entityType && (
          <span className="text-xs text-muted-foreground capitalize">
            {entityType}
          </span>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0 pt-0.5">
        {relativeTime(timestamp)}
      </span>
    </div>
  );
}
