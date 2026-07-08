import { useEffect, useMemo, useState } from "react";
import { useMutation } from "urql";
import { toast } from "sonner";
import {
  Button,
  CopyableRow,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@thinkwork/ui";
import { SaveWorkflowMutation } from "@/lib/graphql-queries";

/**
 * Create/edit dialog for the unified Workflows section (THINK-218 R... web
 * slice). Definition editing v1: a structured mini-editor for the common
 * case — one agent step, optional looping — plus an Advanced (JSON) toggle
 * for the full step taxonomy (packages/agent-loops-core/src/workflow-definition.ts
 * is the source of truth for that document shape; this file only mirrors the
 * "one agent step" case for the structured editor).
 */

export type WorkflowTriggerFamily = "manual" | "schedule" | "webhook";

export type WorkflowFormInitialData = {
  id: string;
  name: string;
  description?: string | null;
  trigger?: {
    family: string;
    scheduleExpression?: string | null;
    timezone?: string | null;
  } | null;
  /** currentVersion.definitionSnapshot, parsed AWSJSON. */
  definition?: unknown;
};

type SaveWorkflowError = {
  stepId: string | null;
  field: string;
  reason: string;
};

type SavedWorkflow = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  lifecycleStatus: string;
  primaryTriggerFamily: string;
  currentVersionNumber?: number | null;
  updatedAt: string;
};

function apiBase(): string {
  const raw =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string | undefined> }).env
        ?.VITE_API_URL) ||
    "";
  return raw.replace(/\/$/, "");
}

/** Best-effort read of the "single agent step" shape for the simple editor. */
function seedFromDefinition(definition: unknown): {
  advanced: boolean;
  objective: string;
  tokenBudget: string;
  looping: boolean;
  exitSignal: string;
  maxIterations: string;
  advancedJson: string;
} {
  const fallback = {
    advanced: false,
    objective: "",
    tokenBudget: "",
    looping: false,
    exitSignal: "",
    maxIterations: "5",
    advancedJson: "",
  };
  if (!definition || typeof definition !== "object") return fallback;
  const doc = definition as {
    steps?: unknown;
    continuationPolicy?: { exitSignal?: unknown; maxIterations?: unknown };
  };
  const steps = Array.isArray(doc.steps) ? doc.steps : null;
  const singleAgentStep =
    steps &&
    steps.length === 1 &&
    isRecord(steps[0]) &&
    steps[0].kind === "agent"
      ? (steps[0] as { objective?: unknown; tokenBudget?: unknown })
      : null;

  if (!singleAgentStep) {
    return {
      ...fallback,
      advanced: true,
      advancedJson: JSON.stringify(definition, null, 2),
    };
  }

  const policy = doc.continuationPolicy;
  return {
    advanced: false,
    objective:
      typeof singleAgentStep.objective === "string"
        ? singleAgentStep.objective
        : "",
    tokenBudget:
      typeof singleAgentStep.tokenBudget === "number"
        ? String(singleAgentStep.tokenBudget)
        : "",
    looping: Boolean(policy),
    exitSignal:
      policy && typeof policy.exitSignal === "string" ? policy.exitSignal : "",
    maxIterations:
      policy && typeof policy.maxIterations === "number"
        ? String(policy.maxIterations)
        : "5",
    advancedJson: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function WorkflowFormDialog({
  open,
  onOpenChange,
  initialWorkflow,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create a new workflow. */
  initialWorkflow?: WorkflowFormInitialData | null;
  onSaved: (workflow: SavedWorkflow, webhookToken: string | null) => void;
}) {
  const isEditing = Boolean(initialWorkflow);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerFamily, setTriggerFamily] =
    useState<WorkflowTriggerFamily>("manual");
  const [scheduleExpression, setScheduleExpression] = useState("");
  const [scheduleTimezone, setScheduleTimezone] = useState("");
  const [objective, setObjective] = useState("");
  const [tokenBudget, setTokenBudget] = useState("");
  const [looping, setLooping] = useState(false);
  const [exitSignal, setExitSignal] = useState("");
  const [maxIterations, setMaxIterations] = useState("5");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [advancedJson, setAdvancedJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<SaveWorkflowError[]>([]);
  const [webhookToken, setWebhookToken] = useState<string | null>(null);

  const [state, saveWorkflow] = useMutation(SaveWorkflowMutation);

  // Re-seed whenever the dialog opens against a (possibly new) target.
  useEffect(() => {
    if (!open) return;
    setJsonError(null);
    setSaveErrors([]);
    setWebhookToken(null);
    setName(initialWorkflow?.name ?? "");
    setDescription(initialWorkflow?.description ?? "");
    const family =
      (initialWorkflow?.trigger?.family as WorkflowTriggerFamily) || "manual";
    setTriggerFamily(
      family === "schedule" || family === "webhook" ? family : "manual",
    );
    setScheduleExpression(initialWorkflow?.trigger?.scheduleExpression ?? "");
    setScheduleTimezone(initialWorkflow?.trigger?.timezone ?? "");
    const seed = seedFromDefinition(initialWorkflow?.definition);
    setAdvancedMode(seed.advanced);
    setObjective(seed.objective);
    setTokenBudget(seed.tokenBudget);
    setLooping(seed.looping);
    setExitSignal(seed.exitSignal);
    setMaxIterations(seed.maxIterations);
    setAdvancedJson(seed.advancedJson);
  }, [open, initialWorkflow]);

  const webhookUrl = useMemo(
    () => (webhookToken ? `${apiBase()}/webhooks/${webhookToken}` : null),
    [webhookToken],
  );

  function buildDefinition(): { definition?: unknown; error?: string } {
    if (advancedMode) {
      const trimmed = advancedJson.trim();
      if (!trimmed) return { error: "Provide a definition document." };
      try {
        return { definition: JSON.parse(trimmed) };
      } catch {
        return {
          error: "Definition JSON is invalid — check for a syntax error.",
        };
      }
    }
    if (!objective.trim()) {
      return { error: "Give the agent step an objective." };
    }
    const budget = tokenBudget.trim() ? Number(tokenBudget) : undefined;
    return {
      definition: {
        version: 1,
        steps: [
          {
            id: "agent-1",
            kind: "agent",
            objective: objective.trim(),
            ...(budget && Number.isFinite(budget)
              ? { tokenBudget: budget }
              : {}),
          },
        ],
        ...(looping
          ? {
              continuationPolicy: {
                exitSignal: exitSignal.trim(),
                maxIterations: Number(maxIterations) || 1,
              },
            }
          : {}),
      },
    };
  }

  async function onSubmit() {
    setJsonError(null);
    setSaveErrors([]);
    if (!name.trim()) {
      setJsonError("A workflow name is required.");
      return;
    }
    if (triggerFamily === "schedule" && !scheduleExpression.trim()) {
      setJsonError("A schedule trigger needs a rate() or cron() expression.");
      return;
    }
    const built = buildDefinition();
    if (built.error) {
      setJsonError(built.error);
      return;
    }

    const result = await saveWorkflow({
      input: {
        id: initialWorkflow?.id ?? null,
        name: name.trim(),
        description: description.trim() || null,
        definition: built.definition,
        trigger: {
          family: triggerFamily,
          schedule:
            triggerFamily === "schedule"
              ? {
                  scheduleExpression: scheduleExpression.trim(),
                  timezone: scheduleTimezone.trim() || null,
                  enabled: true,
                }
              : null,
        },
      },
    });

    if (result.error) {
      setJsonError(result.error.message);
      return;
    }
    const payload = result.data?.saveWorkflow;
    if (!payload) return;
    if (payload.errors.length > 0) {
      setSaveErrors(payload.errors);
      return;
    }
    if (payload.webhookToken) {
      setWebhookToken(payload.webhookToken);
    }
    if (payload.workflow) {
      toast.success(isEditing ? "Workflow updated." : "Workflow created.");
      onSaved(payload.workflow, payload.webhookToken ?? null);
      if (!payload.webhookToken) {
        onOpenChange(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit workflow" : "New workflow"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Trigger</label>
            <Select
              value={triggerFamily}
              onValueChange={(v) =>
                setTriggerFamily(v as WorkflowTriggerFamily)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="schedule">Schedule</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {triggerFamily === "schedule" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Expression</label>
                <Input
                  value={scheduleExpression}
                  onChange={(e) => setScheduleExpression(e.target.value)}
                  placeholder="rate(1 hour) or cron(0 9 * * ? *)"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Timezone</label>
                <Input
                  value={scheduleTimezone}
                  onChange={(e) => setScheduleTimezone(e.target.value)}
                  placeholder="America/New_York"
                />
              </div>
            </div>
          ) : null}

          {triggerFamily === "webhook" && webhookUrl ? (
            <div className="rounded-md border border-border/70 p-3">
              <CopyableRow label="Webhook URL" value={webhookUrl} />
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-border/70 pt-4">
            <label className="text-sm font-medium">Definition</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Advanced (JSON)
              </span>
              <Switch
                checked={advancedMode}
                onCheckedChange={setAdvancedMode}
              />
            </div>
          </div>

          {advancedMode ? (
            <div className="space-y-1.5">
              <Textarea
                value={advancedJson}
                onChange={(e) => setAdvancedJson(e.target.value)}
                rows={12}
                className="font-mono text-xs"
                placeholder='{"version": 1, "steps": [...]}'
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Objective</label>
                <Textarea
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  rows={3}
                  placeholder="What should the agent accomplish on each run?"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Token budget (optional)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={tokenBudget}
                  onChange={(e) => setTokenBudget(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Loop until done</label>
                <Switch checked={looping} onCheckedChange={setLooping} />
              </div>
              {looping ? (
                <div className="space-y-3 rounded-md border border-border/70 p-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Exit signal</label>
                    <Textarea
                      value={exitSignal}
                      onChange={(e) => setExitSignal(e.target.value)}
                      rows={2}
                      placeholder="e.g. the weekly report document exists and is shared"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">
                      Max iterations
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {jsonError ? (
            <p className="text-sm text-destructive">{jsonError}</p>
          ) : null}

          {saveErrors.length > 0 ? (
            <div className="space-y-1 rounded-md border border-destructive/30 p-3">
              {saveErrors.map((error, index) => (
                <p key={index} className="text-sm text-destructive">
                  {error.stepId ? `Step "${error.stepId}" — ` : ""}
                  {error.field}: {error.reason}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {webhookUrl ? "Done" : "Cancel"}
          </Button>
          {!webhookUrl || isEditing ? (
            <Button onClick={onSubmit} disabled={state.fetching}>
              {state.fetching ? "Saving…" : isEditing ? "Save" : "Create"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
