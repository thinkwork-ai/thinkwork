import { AlertTriangle, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

const priorityConfig: Record<
  string,
  { icon: typeof ArrowUp; color: string; label: string }
> = {
  critical: {
    icon: AlertTriangle,
    color: "text-red-600",
    label: "Critical",
  },
  urgent: {
    icon: AlertTriangle,
    color: "text-red-500",
    label: "Urgent",
  },
  high: {
    icon: ArrowUp,
    color: "text-orange-500",
    label: "High",
  },
  medium: {
    icon: Minus,
    color: "text-yellow-500",
    label: "Medium",
  },
  low: {
    icon: ArrowDown,
    color: "text-blue-500",
    label: "Low",
  },
};

const defaultConfig = priorityConfig.medium!;

interface PriorityIconProps {
  priority: string;
  showLabel?: boolean;
  size?: number;
  className?: string;
}

export function PriorityIcon({
  priority,
  showLabel = false,
  size = 14,
  className,
}: PriorityIconProps) {
  const config = priorityConfig[priority] ?? defaultConfig;
  const Icon = config.icon;

  const icon = (
    <span
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        config.color,
        className,
      )}
    >
      <Icon style={{ width: size, height: size }} />
    </span>
  );

  if (!showLabel) return icon;

  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      <span className="text-sm">{config.label}</span>
    </span>
  );
}
