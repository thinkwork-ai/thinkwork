import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  GitBranch,
  Layers,
  Loader2,
  Map,
  Play,
  Square,
  Workflow,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RoutineGraphNode } from "./routineAslGraph";

export type RoutineFlowNodeData = RoutineGraphNode;

export function RoutineFlowNode({ data, selected }: NodeProps) {
  const node = data as unknown as RoutineFlowNodeData;
  const presentation = nodePresentation(node);
  const Icon = presentation.Icon;
  const compact =
    node.kind === "start" ||
    node.kind === "end" ||
    node.kind === "succeed" ||
    node.kind === "fail";

  if (node.kind === "group") {
    return (
      <div className="h-full w-full rounded-md border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">
        {node.label}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-full w-full rounded-md border bg-card text-card-foreground shadow-sm shadow-black/10 transition-colors dark:bg-zinc-900/95 dark:shadow-black/40",
        compact ? "px-3 py-2.5" : "px-3 py-3",
        selected
          ? "border-primary ring-2 ring-primary/35 shadow-md shadow-primary/10"
          : "border-border/90 dark:border-zinc-600/80",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !border-card !bg-muted-foreground dark:!border-zinc-900 dark:!bg-zinc-300"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !border-card !bg-muted-foreground dark:!border-zinc-900 dark:!bg-zinc-300"
      />
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
            presentation.iconClass,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-5">
            {node.label}
          </div>
          {node.subtitle && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {node.subtitle}
            </div>
          )}
          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
            <Badge
              variant="outline"
              className="h-5 border-border/80 bg-background/60 px-1.5 text-[10px] dark:border-zinc-600/70 dark:bg-zinc-950/60"
            >
              {presentation.label}
            </Badge>
            {node.status && (
              <Badge
                className={cn(
                  "h-5 border-transparent px-1.5 text-[10px]",
                  statusClass(node.status),
                )}
              >
                {statusLabel(node.status)}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function nodePresentation(node: RoutineGraphNode) {
  switch (node.kind) {
    case "start":
      return {
        Icon: Play,
        label: "Start",
        iconClass:
          "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      };
    case "end":
      return {
        Icon: Square,
        label: "End",
        iconClass:
          "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300",
      };
    case "choice":
      return {
        Icon: GitBranch,
        label: "Choice",
        iconClass:
          "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    case "map":
      return {
        Icon: Map,
        label: "Map",
        iconClass:
          "border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
      };
    case "parallel":
      return {
        Icon: Layers,
        label: "Parallel",
        iconClass:
          "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300",
      };
    case "fail":
      return {
        Icon: XCircle,
        label: "Fail",
        iconClass:
          "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300",
      };
    case "succeed":
      return {
        Icon: CheckCircle2,
        label: "Succeed",
        iconClass:
          "border-green-500/35 bg-green-500/10 text-green-700 dark:text-green-300",
      };
    case "pass":
      return {
        Icon: Circle,
        label: "Pass",
        iconClass:
          "border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300",
      };
    default:
      return {
        Icon: Workflow,
        label: "Task",
        iconClass: "border-primary/40 bg-primary/10 text-primary",
      };
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function statusClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "succeeded":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "bg-destructive/10 text-destructive";
    case "cancelled":
    case "timed_out":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function RoutineFlowStatusIcon({ status }: { status?: string }) {
  if (status === "running")
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (status === "succeeded") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5" />;
  return <Circle className="h-3.5 w-3.5" />;
}
