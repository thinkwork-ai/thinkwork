import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";

export type RefreshState =
  | "available"
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed";

export interface RefreshStep {
  id: string;
  label: string;
  detail: string;
}

export interface RefreshStateTimelineProps {
  state: RefreshState;
  steps?: RefreshStep[];
}

const DEFAULT_STEPS: RefreshStep[] = [
  {
    id: "source_queries",
    label: "Source queries",
    detail: "Read the applet's saved inputs",
  },
  {
    id: "transforms",
    label: "Deterministic transforms",
    detail: "Normalize, score, chart, and summarize",
  },
  {
    id: "snapshot",
    label: "Snapshot update",
    detail: "Render the refreshed data",
  },
];

export function RefreshStateTimeline({
  state,
  steps = DEFAULT_STEPS,
}: RefreshStateTimelineProps) {
  return (
    <ol className="grid gap-2" aria-label="Refresh state timeline">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="grid grid-cols-[1.75rem_1fr] gap-3 rounded-md border border-border/60 bg-muted/20 p-3"
        >
          <span className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-background">
            <StepIcon state={state} index={index} />
          </span>
          <span>
            <span className="block text-sm font-medium">{step.label}</span>
            <span className="block text-xs text-muted-foreground">
              {step.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ state, index }: { state: RefreshState; index: number }) {
  if (state === "failed") return <XCircle className="size-4 text-destructive" />;
  if (state === "running" && index === 1) {
    return <Loader2 className="size-4 animate-spin text-primary" />;
  }
  if (state === "queued" && index === 0) {
    return <CircleDashed className="size-4 text-primary" />;
  }
  if (state === "available") {
    return <CircleDashed className="size-4 text-muted-foreground" />;
  }
  return <CheckCircle2 className="size-4 text-emerald-500" />;
}
