import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge, Button } from "@thinkwork/ui";
import { GeneratedAppArtifactShell } from "@/components/apps/GeneratedAppArtifactShell";
import { InlineAppletEmbed } from "@/components/apps/InlineAppletEmbed";
import { resolveGeneratedAppRuntimeMode } from "@/lib/app-artifacts";

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

  if (isAppArtifact) {
    return (
      <GeneratedAppArtifactShell
        title={artifact.title}
        label="App"
        runtimeMode={resolveGeneratedAppRuntimeMode(artifact.metadata)}
        className="border-border/70 bg-background shadow-none"
        headerClassName="border-0 bg-transparent px-1 py-0"
        contentClassName="overflow-visible p-0"
        actions={
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
        }
      >
        <InlineAppletEmbed appId={artifact.id} />
      </GeneratedAppArtifactShell>
    );
  }

  return (
    <article className="grid gap-3 rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="flex items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">
              {artifact.title}
            </h3>
            <Badge variant="outline" className="rounded-md">
              {artifact.type ?? "Artifact"}
            </Badge>
          </div>
          {artifact.summary ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {artifact.summary}
            </p>
          ) : null}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        className="justify-self-start"
      >
        Preview unavailable
      </Button>
    </article>
  );
}
