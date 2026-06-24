import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import {
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemStatusCategory,
  workItemStatusCategoryLabel,
  workItemStatusLabel,
} from "./work-item-display";

interface WorkItemStatusSelectProps {
  item: WorkItemSummary;
  statuses: WorkItemStatusSummary[];
  disabled?: boolean;
  onChange: (status: WorkItemStatusSummary) => void;
}

export function WorkItemStatusSelect({
  item,
  statuses,
  disabled,
  onChange,
}: WorkItemStatusSelectProps) {
  const currentValue =
    item.status?.id && statuses.some((status) => status.id === item.status?.id)
      ? item.status.id
      : workItemStatusCategory(item);

  return (
    <Select
      value={currentValue}
      disabled={disabled || statuses.length === 0}
      onValueChange={(value) => {
        const next = statuses.find((status) => status.id === value);
        if (next) onChange(next);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Change status for ${item.title}`}
        className="h-7 max-w-40 rounded-md border-border/70 text-xs"
      >
        <SelectValue placeholder={workItemStatusLabel(item)} />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((status) => (
          <SelectItem key={status.id} value={status.id}>
            {status.name || workItemStatusCategoryLabel(status.category)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
