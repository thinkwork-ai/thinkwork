import { Badge } from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import {
  type WorkItemStatusCategory,
  type WorkItemSummary,
  workItemStatusCategory,
  workItemStatusCategoryLabel,
  workItemStatusLabel,
  workItemStatusTone,
} from "./work-item-display";

interface WorkItemStatusBadgeProps {
  item?: WorkItemSummary;
  category?: WorkItemStatusCategory | string | null;
  label?: string;
  className?: string;
}

export function WorkItemStatusBadge({
  item,
  category,
  label,
  className,
}: WorkItemStatusBadgeProps) {
  const resolvedCategory = item ? workItemStatusCategory(item) : category;
  const resolvedLabel =
    label ?? (item ? workItemStatusLabel(item) : workItemStatusCategoryLabel(category));

  return (
    <Badge
      variant="secondary"
      className={cn(
        "max-w-full rounded-full text-xs font-medium",
        workItemStatusTone(resolvedCategory),
        className,
      )}
    >
      <span className="truncate">{resolvedLabel}</span>
    </Badge>
  );
}
