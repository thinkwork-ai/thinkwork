import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge, Button } from "@thinkwork/ui";
import { InlineAppletEmbed } from "@/components/apps/InlineAppletEmbed";

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

export function GeneratedArtifactCard({
  artifact,
}: GeneratedArtifactCardProps) {
  const isAppArtifact =
    artifact.type === "APPLET" ||
    artifact.type === "DATA_VIEW" ||
    artifact.metadata?.kind === "computer_applet" ||
    artifact.metadata?.kind === "research_dashboard" ||
    artifact.metadata?.uiSurface === "app";
  const articleClassName = isAppArtifact
    ? "grid gap-2 bg-transparent"
    : "grid gap-3 rounded-lg border border-border/70 bg-background/70 p-4";
  const titleClassName = isAppArtifact
    ? "truncate text-sm font-medium text-muted-foreground"
    : "truncate text-sm font-semibold";
  const badgeClassName = isAppArtifact
    ? "rounded-md border-border/50 bg-transparent text-muted-foreground"
    : "rounded-md";

  return (
    <article className={articleClassName}>
      <div className="flex items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={titleClassName}>{artifact.title}</h3>
            <Badge variant="outline" className={badgeClassName}>
              {isAppArtifact ? "App" : (artifact.type ?? "Artifact")}
            </Badge>
          </div>
          {!isAppArtifact && artifact.summary ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {artifact.summary}
            </p>
          ) : null}
        </div>
        {isAppArtifact ? (
          <Button
            asChild
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground hover:text-foreground"
            aria-label="Open artifact full screen"
          >
            <Link to="/artifacts/$id" params={{ id: artifact.id }}>
              <ExternalLink className="size-4" />
              <span className="hidden sm:inline">Open full</span>
            </Link>
          </Button>
        ) : null}
      </div>
      {isAppArtifact ? (
        <InlineAppletEmbed appId={artifact.id} />
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
