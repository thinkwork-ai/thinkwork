import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import { formatDateTime } from "@/components/dashboard-artifacts/dashboard-data";

interface CrmSourceCoverageProps {
  manifest: DashboardArtifactManifest;
}

export function CrmSourceCoverage({ manifest }: CrmSourceCoverageProps) {
  return (
    <section className="rounded-lg border border-border/70 bg-background p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Source coverage</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Missing or partial inputs stay visible so the dashboard does not look
          more complete than it is.
        </p>
      </div>
      <div className="grid gap-2">
        {manifest.sources.map((source) => {
          const isSuccess = source.status === "success";
          return (
            <article
              key={source.id}
              className="rounded-md border border-border/60 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {isSuccess ? (
                    <CheckCircle2 className="size-4 text-emerald-500" />
                  ) : (
                    <AlertCircle className="size-4 text-amber-500" />
                  )}
                  <h4 className="text-sm font-medium capitalize">
                    {source.provider}
                  </h4>
                </div>
                <Badge
                  variant={isSuccess ? "secondary" : "outline"}
                  className="rounded-md"
                >
                  {source.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {source.recordCount} records as of {formatDateTime(source.asOf)}
              </p>
              {"safeDisplayError" in source ? (
                <p className="mt-2 text-xs leading-5 text-amber-500">
                  {source.safeDisplayError}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
