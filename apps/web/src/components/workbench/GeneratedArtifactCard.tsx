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
  onOpenArtifact?: (artifactId: string) => void;
}

export function GeneratedArtifactCard({
  artifact,
  onOpenArtifact,
}: GeneratedArtifactCardProps) {
  const appArtifact = isAppArtifact(artifact);
  const label = appArtifact ? "App" : (artifact.type ?? "Artifact");
  const description =
    artifact.summary?.trim() ||
    (appArtifact ? "Open in side panel" : "Open artifact");
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{artifact.title}</h3>
          <p className="mt-1 truncate text-sm text-[#b4bdcc]">{description}</p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 rounded-md border-white/10 bg-white/5 text-xs text-[#aeb7c6]"
        >
          {label}
        </Badge>
      </div>
    </>
  );

  // Promoted GenUI snapshots always deep-link to the full artifact page —
  // the intermediate side panel has no inline preview to offer, so the
  // extra hop is pure friction. Other DATA_VIEWs (e.g. research_dashboard)
  // keep the panel flow. The Canvas surface will supersede this entirely.
  const isGenUiSnapshot =
    artifact.type === "DATA_VIEW" &&
    artifact.metadata?.kind === "json_render_snapshot";
  if (onOpenArtifact && !isGenUiSnapshot) {
    return (
      <button
        type="button"
        className="mt-3 block w-full cursor-pointer rounded-xl bg-[#2c3444] px-5 py-4 text-left text-[#eef2f7] transition-colors hover:bg-[#252d3b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpenArtifact(artifact.id)}
        aria-label={`Open artifact ${artifact.title}`}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      to="/artifacts/$id"
      params={{ id: artifact.id }}
      className="mt-3 block w-full cursor-pointer rounded-xl bg-[#2c3444] px-5 py-4 text-left text-[#eef2f7] transition-colors hover:bg-[#252d3b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open artifact ${artifact.title}`}
    >
      {content}
    </Link>
  );
}

export function GeneratedArtifactPreview({
  artifact,
  bare = false,
}: {
  artifact: GeneratedArtifact;
  bare?: boolean;
}) {
  const appArtifact = isAppArtifact(artifact);

  if (appArtifact) {
    if (bare) {
      return <InlineAppletEmbed appId={artifact.id} />;
    }

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
            <h3 className="truncate text-sm font-semibold">{artifact.title}</h3>
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
      {artifact.type === "DATA_VIEW" ? (
        // Promoted GenUI snapshots render on the artifact page (the preview
        // card carries no content payload to render inline).
        <Button
          asChild
          variant="outline"
          size="sm"
          className="justify-self-start"
        >
          <Link to="/artifacts/$id" params={{ id: artifact.id }}>
            Open data view
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

export function isAppArtifact(artifact: GeneratedArtifact) {
  // NOT type === "DATA_VIEW": promoted GenUI snapshots (metadata.kind
  // "json_render_snapshot") are DATA_VIEW but are NOT applets — routing them
  // through the applet embed fails with "Artifact is not an applet artifact"
  // (observed live, THINK-116). They render via /artifacts/$id. App-like
  // DATA_VIEWs are still matched through their metadata kinds below.
  return (
    artifact.type === "APPLET" ||
    artifact.metadata?.kind === "computer_applet" ||
    artifact.metadata?.kind === "research_dashboard" ||
    artifact.metadata?.uiSurface === "app"
  );
}
