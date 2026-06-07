import { Link } from "@tanstack/react-router";
import { Badge, Button } from "@thinkwork/ui";
import { ExternalLink } from "lucide-react";
import type {
  ManagedAppKey,
  ManagedApplication,
  RuntimeDeployment,
} from "./types";

/**
 * A managed application as a clickable card: name + right-aligned status, with a
 * short description. Lifecycle actions (deploy/destroy) live on the app's
 * dedicated detail page, reached by clicking the card.
 */
export function ManagedApplicationRow({
  app,
  runtime,
}: {
  app: ManagedApplication;
  runtime?: RuntimeDeployment;
}) {
  const key = app.key as ManagedAppKey;
  const runtimeEnabled =
    runtime?.runtimeEnabled ?? app.currentStatus === "running";
  const status = runtime?.status ?? app.currentStatus;
  const detailPath =
    key === "twenty" ? "/settings/crm" : "/settings/applications/cognee";

  return (
    <Link
      to={detailPath}
      aria-label={`Open ${app.displayName}`}
      className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/30"
    >
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-foreground">
          {app.displayName}
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {runtime?.message ?? managedAppDescription(key)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="outline" className={statusBadgeClassName(status)}>
          {status}
        </Badge>
        {runtime?.url && runtimeEnabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Open ${app.displayName} in a new tab`}
            title={`Open ${app.displayName} in a new tab`}
            onClick={(event) => {
              // Don't trigger the card's drill-in navigation.
              event.preventDefault();
              event.stopPropagation();
              window.open(runtime.url!, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink className="size-4" />
          </Button>
        ) : null}
      </div>
    </Link>
  );
}

function managedAppDescription(key: ManagedAppKey): string {
  if (key === "twenty") {
    return "Customer-owned CRM runtime with dedicated database, cache, files, and generated secrets.";
  }
  return "Knowledge graph runtime with dedicated graph/vector storage and provider credentials.";
}

function statusBadgeClassName(status: string) {
  if (status === "running" || status === "succeeded") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (
    status === "planning" ||
    status === "awaiting_approval" ||
    status === "applying"
  ) {
    return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  }
  if (status === "parked") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  }
  if (status === "failed" || status === "rejected") {
    return "border-destructive/40 bg-destructive/10 text-destructive";
  }
  return "border-border bg-muted/30 text-muted-foreground";
}
