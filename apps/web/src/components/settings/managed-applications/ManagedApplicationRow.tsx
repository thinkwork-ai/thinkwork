import { Link } from "@tanstack/react-router";
import { Badge, Button } from "@thinkwork/ui";
import { ArrowRight, ExternalLink, Play, RotateCw, Trash2 } from "lucide-react";
import type {
  ManagedAppKey,
  ManagedApplication,
  ManagedApplicationJob,
  RuntimeDeployment,
} from "./types";

export function ManagedApplicationRow({
  app,
  runtime,
  latestJob,
  busy,
  onStartPlan,
  onOpenPlan,
}: {
  app: ManagedApplication;
  runtime?: RuntimeDeployment;
  latestJob?: ManagedApplicationJob | null;
  busy?: boolean;
  onStartPlan: (operation: "ENABLE" | "DESTROY" | "UPGRADE") => void;
  onOpenPlan: () => void;
}) {
  const key = app.key as ManagedAppKey;
  const runtimeEnabled =
    runtime?.runtimeEnabled ?? app.currentStatus === "running";
  const provisioned = runtime?.provisioned ?? runtimeEnabled;
  const status =
    latestJob && !terminalStatus(latestJob.status)
      ? latestJob.status
      : (runtime?.status ?? app.currentStatus);
  const canDeploy = !runtimeEnabled;
  const canDestroy = provisioned || runtimeEnabled;
  const hasJob = !!latestJob || !!app.lastJobId;
  // Drill-in destination for the app's dedicated detail surface.
  const detailPath =
    key === "twenty" ? "/settings/crm" : "/settings/applications/cognee";
  const detailLabel = key === "twenty" ? "Open CRM" : "Open Cognee";

  return (
    <div className="border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">
              {app.displayName}
            </h3>
            <Badge variant="outline" className={statusBadgeClassName(status)}>
              {status}
            </Badge>
            {runtime?.url && runtime.runtimeEnabled ? (
              <Button asChild type="button" variant="ghost" size="icon-sm">
                <a
                  href={runtime.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${app.displayName}`}
                  title={`Open ${app.displayName}`}
                >
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            ) : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {runtime?.message ?? managedAppDescription(key)}
          </p>
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <Fact label="Desired" value={app.desiredStatus} />
            <Fact label="Release" value={app.selectedReleaseVersion ?? "..."} />
            <Fact
              label="Endpoint"
              value={runtime?.url ?? runtime?.endpoint ?? "..."}
            />
            <Fact
              label="Last job"
              value={app.lastJobId ?? latestJob?.id ?? "..."}
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild type="button" variant="outline" size="sm">
            <Link to={detailPath} aria-label={detailLabel} title={detailLabel}>
              Open
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          {hasJob ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenPlan}
            >
              <RotateCw className="size-4" />
              View plan
            </Button>
          ) : null}
          {canDeploy ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onStartPlan("ENABLE")}
            >
              <Play className="size-4" />
              Plan deploy
            </Button>
          ) : null}
          {canDestroy ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => onStartPlan("DESTROY")}
            >
              <Trash2 className="size-4" />
              Plan destroy
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground/70">{label}: </span>
      <span className="break-all text-muted-foreground">{value}</span>
    </div>
  );
}

function managedAppDescription(key: ManagedAppKey): string {
  if (key === "twenty") {
    return "Customer-owned CRM runtime with dedicated database, cache, files, and generated secrets.";
  }
  return "Knowledge graph runtime with dedicated graph/vector storage and provider credentials.";
}

function terminalStatus(status: string): boolean {
  return ["succeeded", "failed", "rejected"].includes(status);
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
