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
  const displayName = key === "cognee" ? "ThinkWork Brain" : app.displayName;
  const runtimeEnabled =
    runtime?.runtimeEnabled ?? app.currentStatus === "running";
  const status = runtime?.status ?? app.currentStatus;
  const detailPath =
    key === "twenty" ? "/settings/crm" : "/settings/plugins/$pluginKey";
  const detailParams =
    key === "twenty"
      ? undefined
      : { pluginKey: key === "cognee" ? "company-brain" : key };

  return (
    <Link
      to={detailPath}
      params={detailParams}
      aria-label={`Open ${displayName}`}
      className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/30"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-medium text-foreground">{displayName}</h3>
          {runtime?.url && runtimeEnabled ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 text-muted-foreground"
              aria-label={`Open ${displayName} in a new tab`}
              title={`Open ${displayName} in a new tab`}
              onClick={(event) => {
                // Don't trigger the card's drill-in navigation.
                event.preventDefault();
                event.stopPropagation();
                window.open(runtime.url!, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {runtime?.message ?? managedAppDescription(key)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="outline" className={statusBadgeClassName(status)}>
          {status}
        </Badge>
      </div>
    </Link>
  );
}

function managedAppDescription(key: ManagedAppKey): string {
  if (key === "twenty") {
    return "Customer-owned CRM runtime with dedicated database, cache, files, and generated secrets.";
  }
  if (key === "n8n") {
    return "Self-hosted workflow automation runtime with queue workers, retained workflow data, and native MCP integration.";
  }
  return "ThinkWork Brain knowledge graph substrate with dedicated graph/vector storage and provider credentials.";
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
