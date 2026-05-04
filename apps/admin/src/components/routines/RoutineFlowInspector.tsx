import { useState } from "react";
import { AlertCircle, CheckCircle2, Info, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  RoutineStepConfigEditor,
  type RoutineCredentialOption,
  type RoutineConfigStep,
} from "./RoutineStepConfigEditor";
import type { StepEventLite } from "./ExecutionGraph";
import { cn } from "@/lib/utils";

interface RoutineFlowInspectorProps {
  mode: "authoring" | "execution";
  selectedNodeId?: string | null;
  steps?: RoutineConfigStep[];
  fieldValues?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  credentialOptions?: RoutineCredentialOption[];
  onFieldChange?: (key: string, value: string) => void;
  onLabelChange?: (nodeId: string, value: string) => void;
  onRemoveStep?: (nodeId: string) => void;
  stepEvents?: StepEventLite[];
  executionOutput?: unknown;
  className?: string;
}

export function RoutineFlowInspector({
  mode,
  selectedNodeId,
  steps = [],
  fieldValues = {},
  fieldErrors = {},
  credentialOptions = [],
  onFieldChange,
  onLabelChange,
  onRemoveStep,
  stepEvents = [],
  executionOutput,
  className,
}: RoutineFlowInspectorProps) {
  if (!selectedNodeId) {
    return (
      <aside
        className={cn(
          "rounded-md border border-border/70 bg-card/50 p-4",
          className,
        )}
      >
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
    const step = steps.find((candidate) => candidate.nodeId === selectedNodeId);
    return (
      <aside
        className={cn(
          "rounded-md border border-border/70 bg-card/50 p-4",
          className,
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">
              {step?.label ?? selectedNodeId}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {step?.recipeName ?? step?.recipeId ?? "Run detail"}
            </p>
          </div>
          {latest && <Badge variant="outline">{latest.status}</Badge>}
        </div>
        <dl className="mt-4 divide-y divide-border/70 rounded-md border border-border/70 text-sm">
          <DetailRow label="Node ID" value={selectedNodeId} monospace />
          {step?.recipeName && (
            <DetailRow label="Type" value={step.recipeName} />
          )}
          {step?.recipeId && (
            <DetailRow label="Runtime" value={step.recipeId} monospace />
          )}
        </dl>
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
      <aside
        className={cn(
          "rounded-md border border-border/70 bg-card/50 p-4",
          className,
        )}
      >
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
    <AuthoringInspector
      step={step}
      fieldValues={fieldValues}
      fieldErrors={fieldErrors}
      credentialOptions={credentialOptions}
      onFieldChange={onFieldChange ?? (() => undefined)}
      onLabelChange={onLabelChange}
      onRemoveStep={onRemoveStep}
      selectedNodeId={selectedNodeId}
      className={className}
    />
  );
}

function AuthoringInspector({
  step,
  fieldValues,
  fieldErrors,
  credentialOptions,
  onFieldChange,
  onLabelChange,
  onRemoveStep,
  selectedNodeId,
  className,
}: {
  step: RoutineConfigStep;
  fieldValues: Record<string, string>;
  fieldErrors: Record<string, string>;
  credentialOptions: RoutineCredentialOption[];
  onFieldChange: (key: string, value: string) => void;
  onLabelChange?: (nodeId: string, value: string) => void;
  onRemoveStep?: (nodeId: string) => void;
  selectedNodeId: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const editableFields = step.configFields.filter((field) => field.editable);
  const requiredFields = step.configFields.filter((field) => field.required);
  const configuredFields = editableFields.filter((field) =>
    (fieldValues[fieldKey(step.nodeId, field.key)] ?? "").trim(),
  );
  const requiredConfiguredFields = requiredFields.filter((field) =>
    (fieldValues[fieldKey(step.nodeId, field.key)] ?? "").trim(),
  );
  const issues = step.configFields.filter(
    (field) => fieldErrors[fieldKey(step.nodeId, field.key)],
  );

  return (
    <aside
      className={cn("rounded-md border border-border/70 bg-card/50", className)}
    >
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border/70 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{step.label}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {step.recipeName}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={`Edit ${step.label}`}
            title="Edit step"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
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
      </div>
      <div className="space-y-4 p-4">
        <div className="flex min-w-0 flex-wrap gap-2">
          {issues.length > 0 ? (
            <Badge className="border-transparent bg-destructive/10 text-destructive">
              <AlertCircle className="h-3 w-3" />
              {issues.length} {issues.length === 1 ? "issue" : "issues"}
            </Badge>
          ) : editableFields.length > 0 ? (
            <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              Configured
            </Badge>
          ) : (
            <Badge variant="outline">No config</Badge>
          )}
          <Badge variant="outline">
            {configuredFields.length}/{editableFields.length} editable
          </Badge>
          {requiredFields.length > 0 && (
            <Badge variant="outline">
              {requiredConfiguredFields.length}/{requiredFields.length} required
            </Badge>
          )}
        </div>

        <dl className="divide-y divide-border/70 rounded-md border border-border/70 text-sm">
          <DetailRow label="Node ID" value={step.nodeId} monospace />
          <DetailRow label="Recipe" value={step.recipeName} />
          <DetailRow label="Recipe ID" value={step.recipeId} monospace />
          <DetailRow
            label="Fields"
            value={
              step.configFields.length
                ? `${step.configFields.length} total`
                : "None"
            }
          />
        </dl>

        {issues.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="text-sm font-medium text-destructive">
              Needs attention
            </div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {issues.map((field) => (
                <li key={field.key} className="flex gap-2">
                  <span className="text-destructive">-</span>
                  <span className="min-w-0">
                    {field.label}:{" "}
                    {fieldErrors[fieldKey(step.nodeId, field.key)]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-[min(760px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b border-border/70 pr-12">
            <SheetTitle>Edit step</SheetTitle>
            <SheetDescription>
              {step.label} - {step.recipeName}
            </SheetDescription>
          </SheetHeader>
          <RoutineStepConfigEditor
            steps={[step]}
            fieldValues={fieldValues}
            onFieldChange={onFieldChange}
            onLabelChange={onLabelChange}
            fieldErrors={fieldErrors}
            credentialOptions={credentialOptions}
            selectedNodeId={selectedNodeId}
            layout="stacked"
          />
        </SheetContent>
      </Sheet>
    </aside>
  );
}

function DetailRow({
  label,
  value,
  monospace,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 px-3 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={monospace ? "truncate font-mono text-xs" : "truncate"}>
        {value}
      </dd>
    </div>
  );
}

function outputForNode(output: unknown, nodeId: string): unknown {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return (output as Record<string, unknown>)[nodeId] ?? output;
  }
  return output;
}

function fieldKey(nodeId: string, fieldKeyValue: string): string {
  return `${nodeId}.${fieldKeyValue}`;
}
