/**
 * Workflow definition — the versioned, ThinkWork-owned document the shared
 * Step Functions interpreter executes (THINK-219 thin slice).
 *
 * Stored on workflow_versions.definition_snapshot (jsonb). The interpreter
 * reads steps by index; steps are typed; the optional continuation policy
 * makes the workflow a loop. Validation reports ThinkWork-level errors
 * ({stepId, field, reason}) — never ASL or Step Functions vocabulary.
 */

export const WORKFLOW_DEFINITION_VERSION = 1 as const;

/** workflow_versions.source_kind value for interpreter-authored definitions. */
export const WORKFLOW_INTERPRETER_SOURCE_KIND = "workflow_interpreter";

/** workflow_engine_bindings.binding_type for the shared interpreter machine. */
export const WORKFLOW_INTERPRETER_BINDING_TYPE = "step_functions_interpreter";

export interface AgentWorkflowStep {
  id: string;
  kind: "agent";
  /** The goal-mode objective dispatched to the platform agent. */
  objective: string;
  /** Optional per-turn token budget passed through to the goal runtime. */
  tokenBudget?: number;
}

export interface WaitWorkflowStep {
  id: string;
  kind: "wait";
  /** ISO-8601 timestamp with timezone to wait until. Exactly one of until/durationSeconds. */
  until?: string;
  /** Relative wait in seconds. Exactly one of until/durationSeconds. */
  durationSeconds?: number;
}

export type WorkflowStep = AgentWorkflowStep | WaitWorkflowStep;

export const WORKFLOW_STEP_KINDS = ["agent", "wait"] as const;

export interface ContinuationPolicy {
  /**
   * Natural-language exit signal the policy evaluation judges iteration
   * evidence against (e.g. "the weekly report document exists and is shared").
   */
  exitSignal: string;
  /** Hard iteration ceiling enforced by the interpreter, not the agent. */
  maxIterations: number;
  /** Optional oversight configuration surfaced to operators. */
  oversight?: {
    autonomyLevel?: "autonomous" | "checkpointed";
    checkpoints?: string[];
  };
}

export interface WorkflowDefinition {
  version: typeof WORKFLOW_DEFINITION_VERSION;
  steps: WorkflowStep[];
  continuationPolicy?: ContinuationPolicy;
}

export interface DefinitionValidationError {
  /** Offending step id, or null for definition-level errors. */
  stepId: string | null;
  field: string;
  reason: string;
}

export type DefinitionValidationResult =
  | { ok: true; definition: WorkflowDefinition }
  | { ok: false; errors: DefinitionValidationError[] };

const STEP_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestampWithZone(value: string): boolean {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * Validate an untrusted definition document. Returns the typed definition on
 * success, or every error found (not just the first) on failure.
 */
export function validateWorkflowDefinition(
  input: unknown,
): DefinitionValidationResult {
  const errors: DefinitionValidationError[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        {
          stepId: null,
          field: "definition",
          reason: "definition must be a JSON object",
        },
      ],
    };
  }

  if (input.version !== WORKFLOW_DEFINITION_VERSION) {
    errors.push({
      stepId: null,
      field: "version",
      reason: `version must be ${WORKFLOW_DEFINITION_VERSION}`,
    });
  }

  const steps = input.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push({
      stepId: null,
      field: "steps",
      reason: "steps must be a non-empty array",
    });
    return { ok: false, errors };
  }

  const seenIds = new Set<string>();
  steps.forEach((rawStep, index) => {
    if (!isRecord(rawStep)) {
      errors.push({
        stepId: null,
        field: `steps[${index}]`,
        reason: "step must be a JSON object",
      });
      return;
    }

    const id = typeof rawStep.id === "string" ? rawStep.id : null;
    if (!id || !STEP_ID_PATTERN.test(id)) {
      errors.push({
        stepId: id,
        field: `steps[${index}].id`,
        reason:
          "step id is required: 1-64 letters, digits, dashes, or underscores",
      });
    } else if (seenIds.has(id)) {
      errors.push({
        stepId: id,
        field: `steps[${index}].id`,
        reason: `duplicate step id "${id}"`,
      });
    } else {
      seenIds.add(id);
    }

    const kind = rawStep.kind;
    if (kind === "agent") {
      if (typeof rawStep.objective !== "string" || !rawStep.objective.trim()) {
        errors.push({
          stepId: id,
          field: `steps[${index}].objective`,
          reason: "agent step requires a non-empty objective",
        });
      }
      if (
        rawStep.tokenBudget !== undefined &&
        (typeof rawStep.tokenBudget !== "number" || rawStep.tokenBudget <= 0)
      ) {
        errors.push({
          stepId: id,
          field: `steps[${index}].tokenBudget`,
          reason: "tokenBudget must be a positive number when present",
        });
      }
    } else if (kind === "wait") {
      const hasUntil = rawStep.until !== undefined;
      const hasDuration = rawStep.durationSeconds !== undefined;
      if (hasUntil === hasDuration) {
        errors.push({
          stepId: id,
          field: `steps[${index}]`,
          reason: "wait step requires exactly one of until or durationSeconds",
        });
      }
      if (
        hasUntil &&
        (typeof rawStep.until !== "string" ||
          !isIsoTimestampWithZone(rawStep.until))
      ) {
        errors.push({
          stepId: id,
          field: `steps[${index}].until`,
          reason: "until must be an ISO-8601 timestamp with timezone",
        });
      }
      if (
        hasDuration &&
        (typeof rawStep.durationSeconds !== "number" ||
          !Number.isInteger(rawStep.durationSeconds) ||
          rawStep.durationSeconds <= 0)
      ) {
        errors.push({
          stepId: id,
          field: `steps[${index}].durationSeconds`,
          reason: "durationSeconds must be a positive integer",
        });
      }
    } else {
      errors.push({
        stepId: id,
        field: `steps[${index}].kind`,
        reason: `unknown step kind "${String(kind)}" — supported kinds: ${WORKFLOW_STEP_KINDS.join(", ")}`,
      });
    }
  });

  const policy = input.continuationPolicy;
  if (policy !== undefined) {
    if (!isRecord(policy)) {
      errors.push({
        stepId: null,
        field: "continuationPolicy",
        reason: "continuationPolicy must be a JSON object when present",
      });
    } else {
      if (typeof policy.exitSignal !== "string" || !policy.exitSignal.trim()) {
        errors.push({
          stepId: null,
          field: "continuationPolicy.exitSignal",
          reason: "exitSignal is required for a looping workflow",
        });
      }
      if (
        typeof policy.maxIterations !== "number" ||
        !Number.isInteger(policy.maxIterations) ||
        policy.maxIterations <= 0
      ) {
        errors.push({
          stepId: null,
          field: "continuationPolicy.maxIterations",
          reason: "maxIterations must be a positive integer",
        });
      }
      if (policy.oversight !== undefined && !isRecord(policy.oversight)) {
        errors.push({
          stepId: null,
          field: "continuationPolicy.oversight",
          reason: "oversight must be a JSON object when present",
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, definition: input as unknown as WorkflowDefinition };
}

/**
 * Read a definition from a workflow_versions.definition_snapshot value.
 * Returns null when the snapshot does not hold an interpreter definition.
 */
export function readWorkflowDefinition(
  snapshot: unknown,
): WorkflowDefinition | null {
  const result = validateWorkflowDefinition(snapshot);
  return result.ok ? result.definition : null;
}

/** True when the definition declares a continuation policy (a Loop). */
export function isLoopingDefinition(definition: WorkflowDefinition): boolean {
  return definition.continuationPolicy !== undefined;
}
