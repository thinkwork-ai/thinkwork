/**
 * Workflow definition — the versioned, ThinkWork-owned document the shared
 * Step Functions interpreter executes (THINK-219 thin slice; full step
 * taxonomy THINK-214).
 *
 * Stored on workflow_versions.definition_snapshot (jsonb). The interpreter
 * reads steps by index; steps are typed; the optional continuation policy
 * makes the workflow a loop. Validation reports ThinkWork-level errors
 * ({stepId, field, reason}) — never ASL or Step Functions vocabulary.
 *
 * Input mapping: string values inside a step's input/payload/body/url may
 * hold `{{ ... }}` placeholders resolved at dispatch time. Allowed roots:
 *   {{ trigger.payload.x }}  — the trigger's caller payload (webhook body etc.)
 *   {{ run.input.x }}        — the run's recorded input
 *   {{ steps.<stepId>.output.x }} — a PRECEDING step's recorded output
 * The validator checks placeholder roots and that step references point at
 * earlier steps; resolution itself happens in the step-dispatch layer.
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

export interface RoutineWorkflowStep {
  id: string;
  kind: "routine";
  /** The routine (routines.id) this step invokes via its existing engine. */
  routineId: string;
  /** Input passed to the routine; string values may hold {{ }} placeholders. */
  input?: Record<string, unknown>;
}

export interface ToolWorkflowStep {
  id: string;
  kind: "tool";
  /** Platform tool name to invoke. */
  tool: string;
  /** Tool input; string values may hold {{ }} placeholders. */
  input?: Record<string, unknown>;
}

export interface ApprovalWorkflowStep {
  id: string;
  kind: "approval";
  /** What the human is being asked to decide, in their terms. */
  prompt: string;
  /** Optional assigned approver (users.id); unset = any operator. */
  approverUserId?: string;
  /** Optional wait ceiling before the run fails as unattended. */
  timeoutSeconds?: number;
}

export const HTTP_STEP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;
export type HttpStepMethod = (typeof HTTP_STEP_METHODS)[number];

export interface HttpWorkflowStep {
  id: string;
  kind: "http";
  method: HttpStepMethod;
  /** Absolute http(s) URL; may hold {{ }} placeholders. */
  url: string;
  /** Header values may hold {{ }} placeholders. */
  headers?: Record<string, string>;
  /** JSON body; string values may hold {{ }} placeholders. */
  body?: unknown;
  timeoutSeconds?: number;
}

export interface EmitEventWorkflowStep {
  id: string;
  kind: "emit_event";
  /** Dot-namespaced event type, e.g. "report.published". */
  eventType: string;
  /** Event payload; string values may hold {{ }} placeholders. */
  payload?: Record<string, unknown>;
}

export type WorkflowStep =
  | AgentWorkflowStep
  | WaitWorkflowStep
  | RoutineWorkflowStep
  | ToolWorkflowStep
  | ApprovalWorkflowStep
  | HttpWorkflowStep
  | EmitEventWorkflowStep;

export type WorkflowStepKind = WorkflowStep["kind"];

export const WORKFLOW_STEP_KINDS = [
  "agent",
  "routine",
  "tool",
  "approval",
  "wait",
  "http",
  "emit_event",
] as const satisfies readonly WorkflowStepKind[];

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
const EVENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9_]*(\.[a-z0-9][a-z0-9_]*)*$/i;
const TEMPLATE_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const TEMPLATE_ROOTS = ["trigger", "run", "steps"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestampWithZone(value: string): boolean {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export interface TemplateReference {
  /** The raw dotted expression inside the braces, e.g. "steps.fetch.output.id". */
  expression: string;
  root: string;
  /** Set when root === "steps": the referenced step id. */
  stepId?: string;
}

/**
 * Extract every `{{ ... }}` placeholder from string values nested anywhere in
 * a JSON value. Used by the validator (reference checking) and by the
 * dispatch-time resolver.
 */
export function extractTemplateReferences(value: unknown): TemplateReference[] {
  const references: TemplateReference[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(TEMPLATE_PATTERN)) {
        const expression = (match[1] ?? "").trim();
        const segments = expression.split(".");
        const root = segments[0] ?? "";
        references.push({
          expression,
          root,
          ...(root === "steps" && segments[1] ? { stepId: segments[1] } : {}),
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (isRecord(node)) {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return references;
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
    }

    const kind = rawStep.kind;
    if (kind === "agent") {
      validateAgentStep(rawStep, id, index, errors);
    } else if (kind === "wait") {
      validateWaitStep(rawStep, id, index, errors);
    } else if (kind === "routine") {
      validateRoutineStep(rawStep, id, index, errors);
    } else if (kind === "tool") {
      validateToolStep(rawStep, id, index, errors);
    } else if (kind === "approval") {
      validateApprovalStep(rawStep, id, index, errors);
    } else if (kind === "http") {
      validateHttpStep(rawStep, id, index, errors);
    } else if (kind === "emit_event") {
      validateEmitEventStep(rawStep, id, index, errors);
    } else {
      errors.push({
        stepId: id,
        field: `steps[${index}].kind`,
        reason: `unknown step kind "${String(kind)}" — supported kinds: ${WORKFLOW_STEP_KINDS.join(", ")}`,
      });
    }

    // Input-mapping references: allowed roots only, and step references must
    // point at an EARLIER step (later/self references cannot resolve).
    for (const reference of extractTemplateReferences(rawStep)) {
      if (!TEMPLATE_ROOTS.includes(reference.root as never)) {
        errors.push({
          stepId: id,
          field: `steps[${index}]`,
          reason: `"{{ ${reference.expression} }}" has unknown root "${reference.root}" — allowed roots: ${TEMPLATE_ROOTS.join(", ")}`,
        });
      } else if (reference.root === "steps") {
        if (!reference.stepId) {
          errors.push({
            stepId: id,
            field: `steps[${index}]`,
            reason: `"{{ ${reference.expression} }}" must name a step, e.g. {{ steps.<stepId>.output.field }}`,
          });
        } else if (!seenIds.has(reference.stepId)) {
          errors.push({
            stepId: id,
            field: `steps[${index}]`,
            reason: `"{{ ${reference.expression} }}" references step "${reference.stepId}", which is not an earlier step in this workflow`,
          });
        }
      }
    }

    // Register the id only after reference checking so self-references are
    // rejected alongside forward references.
    if (id && STEP_ID_PATTERN.test(id)) seenIds.add(id);
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

function validateAgentStep(
  rawStep: Record<string, unknown>,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
): void {
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
}

function validateWaitStep(
  rawStep: Record<string, unknown>,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
): void {
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
}

function validateRoutineStep(
  rawStep: Record<string, unknown>,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
): void {
  if (typeof rawStep.routineId !== "string" || !rawStep.routineId.trim()) {
    errors.push({
      stepId: id,
      field: `steps[${index}].routineId`,
      reason: "routine step requires the routineId to invoke",
    });
  }
  if (rawStep.input !== undefined && !isRecord(rawStep.input)) {
    errors.push({
      stepId: id,
      field: `steps[${index}].input`,
      reason: "input must be a JSON object when present",
    });
  }
}

function validateToolStep(
  rawStep: Record<string, unknown>,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
): void {
  if (typeof rawStep.tool !== "string" || !rawStep.tool.trim()) {
    errors.push({
      stepId: id,
      field: `steps[${index}].tool`,
      reason: "tool step requires the tool name to invoke",
    });
  }
  if (rawStep.input !== undefined && !isRecord(rawStep.input)) {
    errors.push({
      stepId: id,
      field: `steps[${index}].input`,
      reason: "input must be a JSON object when present",
    });
  }
}

function validateApprovalStep(
  rawStep: Record<string, unknown>,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
): void {
  if (typeof rawStep.prompt !== "string" || !rawStep.prompt.trim()) {
    errors.push({
      stepId: id,
      field: `steps[${index}].prompt`,
      reason: "approval step requires a prompt describing the decision",
    });
  }
  if (
    rawStep.approverUserId !== undefined &&
    (typeof rawStep.approverUserId !== "string" ||
      !rawStep.approverUserId.trim())
  ) {
    errors.push({
      stepId: id,
      field: `steps[${index}].approverUserId`,
      reason: "approverUserId must be a non-empty string when present",
    });
  }
  if (
    rawStep.timeoutSeconds !== undefined &&
    (typeof rawStep.timeoutSeconds !== "number" ||
      !Number.isInteger(rawStep.timeoutSeconds) ||
      rawStep.timeoutSeconds <= 0)
  ) {
    errors.push({
      stepId: id,
      field: `steps[${index}].timeoutSeconds`,
      reason: "timeoutSeconds must be a positive integer when present",
    });
  }
}

function validateHttpStep(
  rawStep: Record<string, unknown>,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
): void {
  if (
    typeof rawStep.method !== "string" ||
    !HTTP_STEP_METHODS.includes(rawStep.method as HttpStepMethod)
  ) {
    errors.push({
      stepId: id,
      field: `steps[${index}].method`,
      reason: `http step method must be one of ${HTTP_STEP_METHODS.join(", ")}`,
    });
  }
  const url = rawStep.url;
  if (typeof url !== "string" || !url.trim()) {
    errors.push({
      stepId: id,
      field: `steps[${index}].url`,
      reason: "http step requires a url",
    });
  } else if (!TEMPLATE_PATTERN.test(url)) {
    // A fully literal URL must parse as absolute http(s) now; templated URLs
    // are checked at dispatch time after resolution.
    TEMPLATE_PATTERN.lastIndex = 0;
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (
      !parsed ||
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    ) {
      errors.push({
        stepId: id,
        field: `steps[${index}].url`,
        reason: "url must be an absolute http(s) URL",
      });
    }
  }
  TEMPLATE_PATTERN.lastIndex = 0;
  if (rawStep.headers !== undefined) {
    if (
      !isRecord(rawStep.headers) ||
      Object.values(rawStep.headers).some((v) => typeof v !== "string")
    ) {
      errors.push({
        stepId: id,
        field: `steps[${index}].headers`,
        reason: "headers must be an object of string values when present",
      });
    }
  }
  if (
    rawStep.timeoutSeconds !== undefined &&
    (typeof rawStep.timeoutSeconds !== "number" ||
      !Number.isInteger(rawStep.timeoutSeconds) ||
      rawStep.timeoutSeconds <= 0)
  ) {
    errors.push({
      stepId: id,
      field: `steps[${index}].timeoutSeconds`,
      reason: "timeoutSeconds must be a positive integer when present",
    });
  }
}

function validateEmitEventStep(
  rawStep: Record<string, unknown>,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
): void {
  if (
    typeof rawStep.eventType !== "string" ||
    !EVENT_TYPE_PATTERN.test(rawStep.eventType)
  ) {
    errors.push({
      stepId: id,
      field: `steps[${index}].eventType`,
      reason:
        'emit_event step requires a dot-namespaced eventType, e.g. "report.published"',
    });
  }
  if (rawStep.payload !== undefined && !isRecord(rawStep.payload)) {
    errors.push({
      stepId: id,
      field: `steps[${index}].payload`,
      reason: "payload must be a JSON object when present",
    });
  }
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
