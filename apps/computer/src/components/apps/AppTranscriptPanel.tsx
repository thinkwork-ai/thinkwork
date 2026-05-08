import { CheckCircle2, CircleDashed, FileText, Sparkles } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import type { ReactNode } from "react";

interface AppTranscriptPanelProps {
  manifest: DashboardArtifactManifest;
}

export function AppTranscriptPanel({ manifest }: AppTranscriptPanelProps) {
  const generatedAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(manifest.snapshot.generatedAt));

  return (
    <aside className="flex min-h-0 flex-col border-b border-border/70 bg-background lg:border-b-0 lg:border-r">
      <div className="grid gap-4 border-b border-border/70 p-4">
        <div className="grid gap-2">
          <Badge variant="outline" className="w-fit rounded-md">
            Generated app
          </Badge>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {manifest.snapshot.title}
            </h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {manifest.snapshot.summary}
            </p>
          </div>
        </div>
        <div className="grid gap-2 text-sm">
          <MetadataRow label="Generated" value={generatedAt} />
          <MetadataRow label="Artifact" value={manifest.snapshot.artifactId} />
          <MetadataRow label="Thread" value={manifest.snapshot.threadId} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <section className="grid gap-3" aria-label="Computer provenance">
          <TranscriptStep
            icon={<Sparkles className="size-4" />}
            title="Original request"
            detail="Find CRM pipeline risk for LastMile opportunities and produce an app-like dashboard."
            state="done"
          />
          {manifest.recipe.steps.map((step) => (
            <TranscriptStep
              key={step.id}
              icon={<CircleDashed className="size-4" />}
              title={formatStepTitle(step.type)}
              detail={step.id}
              state="done"
            />
          ))}
          <TranscriptStep
            icon={<FileText className="size-4" />}
            title="Dashboard artifact saved"
            detail={`${manifest.views.length} views, ${manifest.sources.length} sources, ${manifest.tables.length} table`}
            state="done"
          />
        </section>
      </div>
    </aside>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium">{value}</span>
    </div>
  );
}

function TranscriptStep({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  state: "done";
}) {
  return (
    <article className="grid grid-cols-[1.75rem_1fr] gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <span className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-background text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </article>
  );
}

function formatStepTitle(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
