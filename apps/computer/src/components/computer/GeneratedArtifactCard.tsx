import { ExternalLink, LayoutDashboard } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge, Button } from "@thinkwork/ui";

export interface GeneratedArtifact {
  id: string;
  title: string;
  type?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface GeneratedArtifactCardProps {
  artifact: GeneratedArtifact;
}

export function GeneratedArtifactCard({ artifact }: GeneratedArtifactCardProps) {
  const isAppArtifact =
    artifact.type === "DATA_VIEW" ||
    artifact.metadata?.kind === "research_dashboard" ||
    artifact.metadata?.uiSurface === "app";

  return (
    <article className="grid gap-3 rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border/70">
          <LayoutDashboard className="size-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{artifact.title}</h3>
            <Badge variant="outline" className="rounded-md">
              {isAppArtifact ? "App" : artifact.type ?? "Artifact"}
            </Badge>
          </div>
          {artifact.summary ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {artifact.summary}
            </p>
          ) : null}
        </div>
      </div>
      {isAppArtifact ? (
        <Button
          asChild
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 justify-self-start"
        >
          <Link to="/apps/$id" params={{ id: artifact.id }}>
            Open app
            <ExternalLink className="size-4" />
          </Link>
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          className="justify-self-start"
        >
          Preview unavailable
        </Button>
      )}
    </article>
  );
}
