import { ArrowRight, Boxes, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@thinkwork/ui";
import type { AppArtifactPreview } from "@/lib/app-artifacts";

interface AppPreviewCardProps {
  artifact: AppArtifactPreview;
}

export function AppPreviewCard({ artifact }: AppPreviewCardProps) {
  const sourceStatuses = artifact.sourceStatuses ?? [];
  return (
    <article className="overflow-hidden rounded-lg border border-border/70 bg-background/70 transition-colors hover:bg-accent/30">
      <Link
        to="/apps/$id"
        params={{ id: artifact.id }}
        className="grid gap-4 p-4"
      >
        <div className="grid aspect-[16/9] gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-md bg-background/80">
                <Boxes className="size-4 text-primary" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {artifact.kind === "applet" ? "Applet" : "Pipeline risk"}
              </span>
            </div>
            <Badge variant="outline" className="rounded-md">
              {artifact.version ? `v${artifact.version}` : "App"}
            </Badge>
          </div>
          <div className="mt-auto grid grid-cols-3 gap-2">
            <PreviewMetric
              label={artifact.kind === "applet" ? "Generated" : "High risk"}
              value={
                artifact.kind === "applet"
                  ? formatDate(artifact.generatedAt)
                  : String(artifact.riskCount ?? 0)
              }
            />
            <PreviewMetric
              label={artifact.kind === "applet" ? "Model" : "Exposure"}
              value={
                artifact.kind === "applet"
                  ? shortModel(artifact.modelId)
                  : formatMoney(artifact.atRiskAmount ?? 0)
              }
            />
            <PreviewMetric
              label={artifact.kind === "applet" ? "Stdlib" : "Sources"}
              value={
                artifact.kind === "applet"
                  ? artifact.stdlibVersionAtGeneration || "-"
                  : `${sourceStatuses.length}`
              }
            />
          </div>
        </div>

        <div className="grid gap-2">
          <h2 className="truncate text-sm font-semibold">{artifact.title}</h2>
          <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
            {artifact.summary}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sourceStatuses.length ? (
              sourceStatuses.map((source) => (
                <Badge
                  key={source.provider}
                  variant="secondary"
                  className="rounded-md"
                >
                  {source.provider}: {source.status}
                </Badge>
              ))
            ) : (
              <Badge variant="secondary" className="rounded-md">
                <Sparkles className="mr-1 size-3" />
                Private artifact
              </Badge>
            )}
          </div>
        </div>

        <span className="inline-flex items-center gap-2 justify-self-start text-sm font-medium text-primary">
          Open app
          <ArrowRight className="size-4" />
        </span>
      </Link>
    </article>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/80 p-2">
      <p className="truncate text-[0.68rem] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function formatMoney(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function shortModel(value?: string | null) {
  if (!value) return "-";
  const parts = value.split(/[/:.]/).filter(Boolean);
  return parts.at(-1) ?? value;
}
