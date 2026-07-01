import type { ReactNode } from "react";
import { Badge, Card, CardContent, cn } from "@thinkwork/ui";
import { StatusBadge } from "@/components/StatusBadge";

export type JsonRecord = Record<string, unknown>;

export type WorkflowBinding = {
  id: string;
  bindingType: string;
  bindingStatus?: string | null;
  readinessState?: string | null;
  readinessReasons?: unknown;
  externalWorkflowId?: string | null;
  externalWorkflowName?: string | null;
  routineId?: string | null;
};

export type WorkflowRunSummary = {
  id: string;
  status: string;
  triggerFamily: string;
  triggerSource?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastEventAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export function titleize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDateTime(value: unknown): string {
  if (!value) return "—";
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function formatShortDate(value: unknown): string {
  if (!value) return "Never";
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleDateString();
}

export function formatDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

export function primaryBinding(
  bindings: WorkflowBinding[] | null | undefined,
): WorkflowBinding | null {
  return bindings?.[0] ?? null;
}

export function sourceLabel(binding?: WorkflowBinding | null): string {
  switch (binding?.bindingType) {
    case "step_functions_routine":
      return "AWS Step";
    case "n8n_bridge":
      return "n8n bridge";
    case "n8n_import":
      return "n8n";
    case "twenty_crm":
      return "Twenty CRM";
    case "connected_app":
      return "Connected app";
    case "native":
      return "ThinkWork";
    default:
      return "Unknown";
  }
}

export function readinessReasonText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  return value
    .map((reason) => {
      if (typeof reason === "string") return reason;
      if (reason && typeof reason === "object") {
        const record = reason as JsonRecord;
        return (
          stringValue(record.message) ??
          stringValue(record.reason) ??
          stringValue(record.code) ??
          JSON.stringify(record)
        );
      }
      return String(reason);
    })
    .filter(Boolean)
    .join("; ");
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function nestedString(value: unknown, ...path: string[]): string | null {
  let next: unknown = value;
  for (const key of path) {
    next = jsonRecord(next)[key];
  }
  return stringValue(next);
}

export function WorkflowReadinessBadge({
  state,
  reasons,
  showReason = true,
}: {
  state: string;
  reasons?: unknown;
  showReason?: boolean;
}) {
  const reason = readinessReasonText(reasons);
  const status =
    state === "ready" ? "active" : state === "disabled" ? "archived" : state;
  return (
    <span className="inline-flex min-w-0 flex-col gap-0.5">
      <StatusBadge status={status} size="sm" />
      {showReason && reason ? (
        <span className="max-w-[18rem] truncate text-xs text-muted-foreground">
          {reason}
        </span>
      ) : null}
    </span>
  );
}

export function SourceBadge({ binding }: { binding?: WorkflowBinding | null }) {
  return (
    <Badge variant="secondary" className="max-w-full truncate text-xs">
      {sourceLabel(binding)}
    </Badge>
  );
}

export function InfoCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-md", className)}>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {children}
      </CardContent>
    </Card>
  );
}

export function DefinitionList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid gap-2 text-sm">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 justify-between gap-4">
          <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 truncate text-right">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function JsonPreview({ value }: { value: unknown }) {
  const text =
    value == null
      ? "None"
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border/70 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
      {text}
    </pre>
  );
}
