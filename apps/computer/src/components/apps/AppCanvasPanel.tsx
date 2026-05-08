import { AlertTriangle, BarChart3, RefreshCcw } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";

interface AppCanvasPanelProps {
  manifest: DashboardArtifactManifest;
}

export function AppCanvasPanel({ manifest }: AppCanvasPanelProps) {
  const opportunities = manifest.tables.find(
    (table) => table.id === "opportunities",
  );
  const highRiskRows =
    opportunities?.rows.filter((row) => row.risk === "high").length ?? 0;

  return (
    <section className="min-h-0 overflow-auto bg-muted/20 p-4 sm:p-5">
      <div className="mx-auto grid max-w-6xl gap-4">
        <header className="flex flex-col gap-3 rounded-lg border border-border/70 bg-background p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-md">
                Pipeline risk
              </Badge>
              <Badge variant="outline" className="rounded-md">
                Read-only
              </Badge>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              {manifest.snapshot.title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {manifest.snapshot.summary}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-2">
              <RefreshCcw className="size-4" />
              Refresh
            </Button>
            <Button type="button" size="sm">
              Ask Computer
            </Button>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Sources" value={String(manifest.sources.length)} />
          <MetricCard label="Views" value={String(manifest.views.length)} />
          <MetricCard label="High-risk deals" value={String(highRiskRows)} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-lg border border-border/70 bg-background p-4">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">Dashboard views</h3>
            </div>
            <div className="grid gap-2">
              {manifest.views.map((view) => (
                <div
                  key={view.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{view.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {view.component}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded-md">
                    {view.sourceIds.length} sources
                  </Badge>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border/70 bg-background p-4">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              <h3 className="text-sm font-semibold">Source coverage</h3>
            </div>
            <div className="grid gap-2">
              {manifest.sources.map((source) => (
                <div
                  key={source.id}
                  className="rounded-md border border-border/60 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{source.provider}</p>
                    <Badge
                      variant={
                        source.status === "success" ? "secondary" : "outline"
                      }
                      className="rounded-md"
                    >
                      {source.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {source.recordCount} records as of {source.asOf.slice(0, 10)}
                  </p>
                  {"safeDisplayError" in source ? (
                    <p className="mt-2 text-xs leading-5 text-amber-500">
                      {source.safeDisplayError}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
