import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const statusColors: Record<string, { dot: string; badge: string }> = {
  // Agent statuses
  idle: { dot: "bg-gray-400", badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  busy: { dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  offline: { dot: "bg-red-500", badge: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
  error: { dot: "bg-red-500", badge: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },

  // Thread statuses
  backlog: { dot: "bg-gray-400", badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  todo: { dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  open: { dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  in_progress: { dot: "bg-yellow-500", badge: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300" },
  in_review: { dot: "bg-purple-500", badge: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300" },
  blocked: { dot: "bg-red-500", badge: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
  done: { dot: "bg-green-500", badge: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" },
  closed: { dot: "bg-green-500", badge: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" },
  cancelled: { dot: "bg-red-400", badge: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400" },

  // Approval statuses
  pending: { dot: "bg-yellow-500", badge: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300" },
  approved: { dot: "bg-green-500", badge: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" },
  rejected: { dot: "bg-red-500", badge: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
  revision_requested: { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },

  // Generic
  active: { dot: "bg-green-500", badge: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" },
  archived: { dot: "bg-gray-400", badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

const defaultColors = {
  dot: "bg-gray-400",
  badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  size = "md",
  showDot = true,
  className,
}: StatusBadgeProps) {
  const colors = statusColors[status] ?? defaultColors;

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent font-medium",
        colors.badge,
        size === "sm" ? "text-[10px] px-1.5 py-0" : "text-xs px-2 py-0.5",
        className,
      )}
    >
      {showDot && (
        <span
          className={cn(
            "shrink-0 rounded-full",
            size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
            colors.dot,
          )}
        />
      )}
      {statusLabel(status)}
    </Badge>
  );
}
