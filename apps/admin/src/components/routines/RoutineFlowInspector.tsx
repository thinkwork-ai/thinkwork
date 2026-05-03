import { AlertCircle, Info, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RoutineStepConfigEditor,
  type RoutineConfigStep,
} from "./RoutineStepConfigEditor";
import type { StepEventLite } from "./ExecutionGraph";

interface RoutineFlowInspectorProps {
  mode: "authoring" | "execution";
  selectedNodeId?: string | null;
  steps?: RoutineConfigStep[];
  fieldValues?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  onFieldChange?: (key: string, value: string) => void;
  onLabelChange?: (nodeId: string, value: string) => void;
  onRemoveStep?: (nodeId: string) => void;
  stepEvents?: StepEventLite[];
  executionOutput?: unknown;
}

export function RoutineFlowInspector({
  mode,
  selectedNodeId,
  steps = [],
  fieldValues = {},
  fieldErrors = {},
  onFieldChange,
  onLabelChange,
  onRemoveStep,
  stepEvents = [],
  executionOutput,
}: RoutineFlowInspectorProps) {
  if (!selectedNodeId) {
    return (
      <aside className="rounded-md border border-border/70 bg-card/50 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Info className="h-4 w-4 text-muted-foreground" />
          Select a node
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Node details, configuration, and run output appear here.
        </p>
      </aside>
    );
  }

  if (mode === "execution") {
    const events = stepEvents.filter(
      (event) => event.nodeId === selectedNodeId,
    );
    const latest = events[events.length - 1];
    return (
      <aside className="rounded-md border border-border/70 bg-card/50 p-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{selectedNodeId}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Run detail</p>
          </div>
          {latest && <Badge variant="outline">{latest.status}</Badge>}
        </div>
        {events.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
            No step event has been recorded for this node.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {events.map((event) => (
              <div
                key={event.id}
                className="rounded-md border border-border/70 p-3"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{event.status}</span>
                  <span className="text-xs text-muted-foreground">
                    {event.retryCount
                      ? `${event.retryCount} retries`
                      : "first attempt"}
                  </span>
                </div>
                {event.startedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Started {event.startedAt}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {executionOutput != null && (
          <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-muted/60 p-3 text-xs">
            {JSON.stringify(
              outputForNode(executionOutput, selectedNodeId),
              null,
              2,
            )}
          </pre>
        )}
      </aside>
    );
  }

  const step = steps.find((candidate) => candidate.nodeId === selectedNodeId);
  if (!step) {
    return (
      <aside className="rounded-md border border-border/70 bg-card/50 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
          Unsupported node
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          This node is rendered from ASL and is not editable in this pass.
        </p>
      </aside>
    );
  }

  return (
    <aside className="rounded-md border border-border/70 bg-card/50">
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border/70 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{step.label}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {step.recipeName}
          </p>
        </div>
        {onRemoveStep && (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={`Remove ${step.label}`}
            onClick={() => onRemoveStep(step.nodeId)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <RoutineStepConfigEditor
        steps={[step]}
        fieldValues={fieldValues}
        onFieldChange={onFieldChange ?? (() => undefined)}
        onLabelChange={onLabelChange}
        fieldErrors={fieldErrors}
        selectedNodeId={selectedNodeId}
      />
    </aside>
  );
}

function outputForNode(output: unknown, nodeId: string): unknown {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return (output as Record<string, unknown>)[nodeId] ?? output;
  }
  return output;
}
