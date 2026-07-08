import { Badge } from "@thinkwork/ui";
import {
  Bot,
  Clock,
  GitBranch,
  Globe,
  Radio,
  UserCheck,
  Wrench,
} from "lucide-react";
import { InfoCard, titleize } from "./workflow-ui";

/**
 * Read-only, typed-step rendering of a workflow's definitionSnapshot
 * (packages/agent-loops-core/src/workflow-definition.ts is the source of
 * truth for this document shape). Replaces the legacy ASL-based
 * RoutineDefinitionPanel on the Workflows canvas — this NEVER renders ASL;
 * when the snapshot doesn't match the typed-steps shape, it shows a neutral
 * placeholder instead of trying to interpret it.
 */

type StepIconKind =
  "agent" | "routine" | "tool" | "approval" | "wait" | "http" | "emit_event";

const STEP_ICONS: Record<StepIconKind, typeof Bot> = {
  agent: Bot,
  routine: GitBranch,
  tool: Wrench,
  approval: UserCheck,
  wait: Clock,
  http: Globe,
  emit_event: Radio,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stepSummary(step: Record<string, unknown>): string {
  const kind = stringField(step, "kind");
  switch (kind) {
    case "agent":
      return stringField(step, "objective") ?? "No objective set.";
    case "routine":
      return `Routine ${stringField(step, "routineId") ?? "—"}`;
    case "tool":
      return `Tool: ${stringField(step, "tool") ?? "—"}`;
    case "approval":
      return stringField(step, "prompt") ?? "No prompt set.";
    case "wait": {
      const until = stringField(step, "until");
      const duration = numberField(step, "durationSeconds");
      if (until) return `Until ${until}`;
      if (duration != null) return `${duration}s`;
      return "No wait condition set.";
    }
    case "http": {
      const method = stringField(step, "method") ?? "GET";
      const url = stringField(step, "url") ?? "—";
      return `${method} ${url}`;
    }
    case "emit_event":
      return stringField(step, "eventType") ?? "No event type set.";
    default:
      return "Unrecognized step.";
  }
}

function StepCard({
  step,
  index,
}: {
  step: Record<string, unknown>;
  index: number;
}) {
  const kind = stringField(step, "kind") as StepIconKind | null;
  const Icon = (kind && STEP_ICONS[kind]) || Wrench;
  const id = stringField(step, "id") ?? `step-${index + 1}`;
  return (
    <li className="flex gap-3 rounded-md border border-border/70 p-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate font-medium text-foreground">
            {id}
          </span>
          {kind ? (
            <Badge variant="outline" className="text-xs">
              {titleize(kind)}
            </Badge>
          ) : null}
        </div>
        <p
          className="truncate text-sm text-muted-foreground"
          title={stepSummary(step)}
        >
          {stepSummary(step)}
        </p>
      </div>
    </li>
  );
}

export function DefinitionStepsPanel({ definition }: { definition: unknown }) {
  if (!isRecord(definition) || !Array.isArray(definition.steps)) {
    return (
      <InfoCard title="Steps">
        <p className="text-sm text-muted-foreground">
          No structured step definition is available for this workflow version.
        </p>
      </InfoCard>
    );
  }

  const steps = definition.steps.filter(isRecord);
  const policy = isRecord(definition.continuationPolicy)
    ? definition.continuationPolicy
    : null;

  return (
    <InfoCard title="Steps">
      {policy ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/20 p-3">
          <Badge variant="secondary" className="gap-1 text-xs">
            Looping
          </Badge>
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {stringField(policy, "exitSignal") ?? "Exit signal not set"}
          </span>
          {numberField(policy, "maxIterations") != null ? (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              Max {numberField(policy, "maxIterations")} iterations
            </span>
          ) : null}
        </div>
      ) : null}
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This workflow definition has no steps yet.
        </p>
      ) : (
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <StepCard
              key={stringField(step, "id") ?? index}
              step={step}
              index={index}
            />
          ))}
        </ol>
      )}
    </InfoCard>
  );
}
