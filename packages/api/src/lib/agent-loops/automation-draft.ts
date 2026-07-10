import type {
  GoalSpec,
  JudgeSpec,
  WorkerSpec,
} from "@thinkwork/agent-loops-core";

export const PROMPT_FIRST_CREATED_FROM = [
  "settings.automations.builder",
  "settings.automations.chat",
  "settings.automations.easy",
  "settings.automations.manual",
] as const;

export const RUNTIME_INFERRED_COMPLETION_CRITERION =
  "The agent produces a useful response or next step for the automation prompt.";

export const DEFAULT_SELF_CHECK_JUDGE_CRITERIA = [
  "The response addresses the automation prompt.",
  "Important uncertainty, blockers, or follow-up actions are visible.",
];

type JsonRecord = Record<string, unknown>;

export type DefaultAutomationWorker = Pick<WorkerSpec, "id" | "type"> & {
  label?: string | null;
};

export interface AutomationDraftInput {
  goalSpec: JsonRecord;
  workerSpec: JsonRecord;
  judgeSpec: JsonRecord;
  sourceMetadata: JsonRecord;
  defaultWorker?: DefaultAutomationWorker | null;
}

export interface NormalizedAutomationDraft {
  goalSpec: JsonRecord;
  workerSpec: JsonRecord;
  judgeSpec: JsonRecord;
  sourceMetadata: JsonRecord;
}

export function isPromptFirstAutomationDraft(
  sourceMetadata: JsonRecord,
): boolean {
  const createdFrom = stringValue(sourceMetadata.createdFrom);
  const creationMode = stringValue(sourceMetadata.creationMode);
  return (
    PROMPT_FIRST_CREATED_FROM.includes(
      createdFrom as (typeof PROMPT_FIRST_CREATED_FROM)[number],
    ) ||
    creationMode === "builder" ||
    creationMode === "chat" ||
    creationMode === "easy" ||
    creationMode === "manual" ||
    stringValue(sourceMetadata.goalInference) === "runtime_inferred"
  );
}

export function promptFirstDraftNeedsDefaultWorker(input: {
  workerSpec: JsonRecord;
  sourceMetadata: JsonRecord;
}): boolean {
  return (
    isPromptFirstAutomationDraft(input.sourceMetadata) &&
    !stringValue(input.workerSpec.id)
  );
}

/**
 * goalSpec is a legacy contract input (target_spec is authoritative for
 * dispatch since THINK-159), but normalizeGoalSpec still requires a
 * non-empty completionCriteria. The web editor sends `[]` (it has no
 * criteria surface), so an un-backfilled draft dies at save time —
 * observed live on TEI (THINK-246): editing a delivery recipient failed
 * with a masked "Unexpected error". Backfill the runtime-inferred
 * criterion whenever criteria are absent, prompt-first or not.
 */
function withInferredCompletionCriteria(
  goalSpec: Partial<GoalSpec> & JsonRecord,
): Partial<GoalSpec> & JsonRecord {
  const criteria = stringArray(
    goalSpec.completionCriteria ?? goalSpec.completion_criteria,
  );
  if (criteria.length > 0) return goalSpec;
  return {
    ...goalSpec,
    completionCriteria: [RUNTIME_INFERRED_COMPLETION_CRITERION],
  };
}

export function normalizeAutomationDraft(
  input: AutomationDraftInput,
): NormalizedAutomationDraft {
  if (!isPromptFirstAutomationDraft(input.sourceMetadata)) {
    return {
      goalSpec: withInferredCompletionCriteria(input.goalSpec),
      workerSpec: input.workerSpec,
      judgeSpec: input.judgeSpec,
      sourceMetadata: input.sourceMetadata,
    };
  }

  const sourceMetadata = { ...input.sourceMetadata };
  const prompt = firstNonEmptyString(
    sourceMetadata.prompt,
    input.goalSpec.objective,
    sourceMetadata.objective,
  );
  const completionCriteria = stringArray(
    input.goalSpec.completionCriteria ?? input.goalSpec.completion_criteria,
  );
  const inferredGoal = completionCriteria.length === 0;
  const goalSpec: Partial<GoalSpec> & JsonRecord = {
    ...input.goalSpec,
    objective: firstNonEmptyString(input.goalSpec.objective, prompt),
    completionCriteria: inferredGoal
      ? [RUNTIME_INFERRED_COMPLETION_CRITERION]
      : completionCriteria,
  };

  const workerSpec: Partial<WorkerSpec> & JsonRecord = { ...input.workerSpec };
  if (!stringValue(workerSpec.id) && input.defaultWorker) {
    workerSpec.type = input.defaultWorker.type;
    workerSpec.id = input.defaultWorker.id;
    workerSpec.label = input.defaultWorker.label ?? undefined;
    workerSpec.toolHints = stringArray(workerSpec.toolHints);
    workerSpec.config = record(workerSpec.config);
    sourceMetadata.workerInference = "tenant_default_agent";
  }

  const judgeCriteria = stringArray(input.judgeSpec.criteria);
  const judgeMode =
    stringValue(input.judgeSpec.mode) === "human_approval"
      ? "human_approval"
      : "self_check";
  const judgeSpec: Partial<JudgeSpec> & JsonRecord = {
    ...input.judgeSpec,
    mode: judgeMode,
    criteria:
      judgeCriteria.length === 0
        ? DEFAULT_SELF_CHECK_JUDGE_CRITERIA
        : judgeCriteria,
    config: record(input.judgeSpec.config),
  };
  if (judgeCriteria.length === 0) {
    sourceMetadata.judgeInference = "default_self_check";
  }

  sourceMetadata.prompt = prompt;
  sourceMetadata.goalInference = inferredGoal
    ? "runtime_inferred"
    : stringValue(sourceMetadata.goalInference) || "explicit";

  return {
    goalSpec,
    workerSpec,
    judgeSpec,
    sourceMetadata,
  };
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) return normalized;
  }
  return "";
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => stringValue(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
