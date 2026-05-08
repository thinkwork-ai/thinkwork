import { ArrowRight, BarChart3 } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import type { AppArtifactPreview } from "@/lib/app-artifacts";

interface AppPreviewCardProps {
  artifact: AppArtifactPreview;
}

export function AppPreviewCard({ artifact }: AppPreviewCardProps) {
  return (
    <article className="overflow-hidden rounded-lg border border-border/70 bg-background/70 transition-colors hover:bg-accent/30">
      <a href={artifact.href} className="grid gap-4 p-4">
        <div className="grid aspect-[16/9] gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-md bg-background/80">
                <BarChart3 className="size-4 text-primary" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Pipeline risk
              </span>
            </div>
            <Badge variant="outline" className="rounded-md">
              App
            </Badge>
          </div>
          <div className="mt-auto grid grid-cols-3 gap-2">
            <PreviewMetric label="High risk" value={String(artifact.riskCount)} />
            <PreviewMetric label="Exposure" value={formatMoney(artifact.atRiskAmount)} />
            <PreviewMetric
              label="Sources"
              value={`${artifact.sourceStatuses.length}`}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <h2 className="truncate text-sm font-semibold">{artifact.title}</h2>
          <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
            {artifact.summary}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {artifact.sourceStatuses.map((source) => (
              <Badge key={source.provider} variant="secondary" className="rounded-md">
                {source.provider}: {source.status}
              </Badge>
            ))}
          </div>
        </div>

        <span className="inline-flex items-center gap-2 justify-self-start text-sm font-medium text-primary">
          Open app
          <ArrowRight className="size-4" />
        </span>
      </a>
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
