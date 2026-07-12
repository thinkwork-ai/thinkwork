import type { DocumentBinding } from "./contracts";

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

/**
 * Trigger families an approval predicate may name — the same closed set the
 * workflow control plane records on runs (workflows.primary_trigger_family /
 * workflow_runs.trigger_family).
 */
export const APPROVAL_TRIGGER_FAMILIES = [
  "manual",
  "schedule",
  "webhook",
  "crm",
  "n8n",
  "api",
  "agent",
  "child_workflow",
] as const;
export type ApprovalTriggerFamily = (typeof APPROVAL_TRIGGER_FAMILIES)[number];

export interface ApprovalWorkflowStep {
  id: string;
  kind: "approval";
  /** What the human is being asked to decide, in their terms. */
  prompt: string;
  /** Optional assigned approver (users.id); unset = any operator. */
  approverUserId?: string;
  /** Optional wait ceiling before the run fails as unattended. */
  timeoutSeconds?: number;
  /**
   * Restricted trigger predicate (THINK-193 U3): when present, the approval
   * only WAITS for runs whose trigger family is listed; every other run
   * records a visible `workflow_approval_skipped` event and advances. This
   * is a validated allowlist over APPROVAL_TRIGGER_FAMILIES — there is no
   * arbitrary expression evaluator.
   */
  when?: { triggerFamily: ApprovalTriggerFamily[] };
}

/**
 * PURE: does this approval step wait for a run with the given trigger
 * family? No predicate means it always waits; an UNKNOWN/null family also
 * waits — human review is the fail-safe side of the predicate.
 */
export function approvalStepWaits(
  step: Pick<ApprovalWorkflowStep, "when">,
  triggerFamily: string | null | undefined,
): boolean {
  const families = step.when?.triggerFamily;
  if (!families || families.length === 0) return true;
  if (triggerFamily == null) return true;
  if (!APPROVAL_TRIGGER_FAMILIES.includes(triggerFamily as never)) return true;
  return families.includes(triggerFamily as ApprovalTriggerFamily);
}

/**
 * Named stages of the memory pipeline a memory_stage step may run
 * (external-memory-compounding U1). The worker Lambda owns stage semantics;
 * the definition only names which stage this step triggers.
 */
export const MEMORY_STAGE_KINDS = [
  "preflight",
  "acquire",
  "extract",
  "project",
  "resolve",
  "retain",
  "compound",
  "graph",
  "wiki",
] as const;
export type MemoryStageKind = (typeof MEMORY_STAGE_KINDS)[number];

/**
 * Memory-pipeline step (external-memory-compounding U1): parks the run on a
 * task token while an asynchronous worker runs one stage of the memory
 * pipeline, then records the worker's result as step evidence.
 */
export interface MemoryStageWorkflowStep {
  id: string;
  kind: "memory_stage";
  /** Which memory-pipeline stage the worker runs. */
  stage: MemoryStageKind;
  /** Processor configuration (uuid, or a {{ }} template resolved at dispatch). */
  processorConfigId: string;
  /** Optional source configuration (uuid or {{ }} template). */
  sourceConfigId?: string;
  /** Stage-specific options passed through to the worker verbatim. */
  options?: Record<string, unknown>;
}

/**
 * Frozen dispatch<->worker protocol for memory_stage steps (THINK-193 U1).
 * workflow-step-dispatch (packages/lambda) Event-invokes the worker with the
 * payload; the worker (packages/api memory-stage-worker) resumes the parked
 * task token via SendTaskSuccess carrying the result JSON. Both sides import
 * these from here so the shapes cannot drift.
 */
export interface MemoryStageWorkerInvokePayload {
  workflowRunId: string;
  tenantId: string;
  stepId: string;
  iteration: number;
  stage: string;
  processorConfigId: string;
  sourceConfigId: string | null;
  options: Record<string, unknown> | null;
}

export interface MemoryStageWorkerResult {
  status: "succeeded" | "failed";
  stage: string;
  counts?: Record<string, number>;
  error?: string;
  output?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Approved-plan override (THINK-193 U3) — the narrowing a human applies when
// approving a memory workflow's plan review. Frozen protocol shared by the
// resolveWorkflowApproval mutation (packages/api), the workflow-resume Lambda,
// record_approval / await_memory_stage in workflow-step-dispatch
// (packages/lambda), and the memory-stage worker/sweeper (packages/api).
// The override may only NARROW saved authorization/config boundaries — the
// mutation validates it against the processor's saved sources and the stage
// runtime re-enforces narrow-only semantics (effectiveLimit / source
// intersection) regardless.
// ---------------------------------------------------------------------------

export interface ApprovalPlanOverride {
  /** Restrict the run to these already-configured source configs. */
  sourceConfigIds?: string[];
  /** Advisory focus keys chosen from the preflight plan. */
  focusKeys?: string[];
  /** ISO-8601 bounds narrowing the evidence time range. */
  timeRange?: { from?: string; to?: string };
  /** Cap on records this run may acquire (narrows boundary/budget caps). */
  maxRecords?: number;
}

const OVERRIDE_MAX_LIST = 50;
const OVERRIDE_MAX_KEY_CHARS = 200;

/**
 * Shape-validate an untrusted override into the frozen protocol shape, or
 * null when nothing usable is present. Throws on structurally invalid input
 * (wrong types, oversized lists, unordered time range) so callers surface a
 * clear error instead of silently dropping a reviewer's narrowing.
 */
export function sanitizeApprovalPlanOverride(
  input: unknown,
): ApprovalPlanOverride | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("approval override must be a JSON object");
  }
  const raw = input as Record<string, unknown>;
  const override: ApprovalPlanOverride = {};

  const readList = (key: "sourceConfigIds" | "focusKeys"): void => {
    const value = raw[key];
    if (value === undefined || value === null) return;
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`approval override ${key} must be a non-empty array`);
    }
    if (value.length > OVERRIDE_MAX_LIST) {
      throw new Error(
        `approval override ${key} allows at most ${OVERRIDE_MAX_LIST} entries`,
      );
    }
    const items = value.map((item) => {
      if (
        typeof item !== "string" ||
        !item.trim() ||
        item.length > OVERRIDE_MAX_KEY_CHARS
      ) {
        throw new Error(
          `approval override ${key} entries must be non-empty strings of at most ${OVERRIDE_MAX_KEY_CHARS} characters`,
        );
      }
      return item.trim();
    });
    override[key] = items;
  };
  readList("sourceConfigIds");
  readList("focusKeys");

  const timeRange = raw.timeRange;
  if (timeRange !== undefined && timeRange !== null) {
    if (typeof timeRange !== "object" || Array.isArray(timeRange)) {
      throw new Error("approval override timeRange must be a JSON object");
    }
    const { from, to } = timeRange as { from?: unknown; to?: unknown };
    const range: { from?: string; to?: string } = {};
    for (const [key, value] of [
      ["from", from],
      ["to", to],
    ] as const) {
      if (value === undefined || value === null) continue;
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new Error(
          `approval override timeRange.${key} must be an ISO-8601 timestamp`,
        );
      }
      range[key] = value;
    }
    if (
      range.from &&
      range.to &&
      Date.parse(range.from) > Date.parse(range.to)
    ) {
      throw new Error(
        "approval override timeRange.from must not be after timeRange.to",
      );
    }
    if (range.from || range.to) override.timeRange = range;
  }

  const maxRecords = raw.maxRecords;
  if (maxRecords !== undefined && maxRecords !== null) {
    if (
      typeof maxRecords !== "number" ||
      !Number.isInteger(maxRecords) ||
      maxRecords <= 0
    ) {
      throw new Error(
        "approval override maxRecords must be a positive integer",
      );
    }
    override.maxRecords = maxRecords;
  }

  return Object.keys(override).length > 0 ? override : null;
}

/** Step-output key record_approval persists an approved override under. */
export const APPROVAL_OVERRIDE_OUTPUT_KEY = "approvalOverride";

/**
 * Merge a run's recorded approval override (if any approval step persisted
 * one as its step output) into a memory_stage step's options under the
 * `override` key. Shared by workflow-step-dispatch (park time) and the
 * memory-stage sweeper (payload reconstruction) so a redriven run keeps the
 * reviewer's narrowing.
 */
export function mergeApprovalOverrideIntoOptions(
  stepOutputs: Record<string, { output: unknown }>,
  options: Record<string, unknown> | null,
): Record<string, unknown> | null {
  let override: unknown = null;
  for (const entry of Object.values(stepOutputs)) {
    const output = entry?.output;
    if (
      output &&
      typeof output === "object" &&
      !Array.isArray(output) &&
      (output as Record<string, unknown>)[APPROVAL_OVERRIDE_OUTPUT_KEY]
    ) {
      override = (output as Record<string, unknown>)[
        APPROVAL_OVERRIDE_OUTPUT_KEY
      ];
    }
  }
  if (!override) return options;
  return { ...(options ?? {}), override };
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

/**
 * Deliver step (THINK-227 U4, KTD3): email the workflow's maintained document
 * — an email-safe inline rendering plus a living share link — to the
 * operator-configured recipient list after the agent step finalizes. Only
 * meaningful on a definition carrying a `documentBinding` (validated below);
 * the executor gates on "a new edition landed since the run started" and
 * records skipped/sent/failed step evidence (KTD4).
 */
export interface DeliverWorkflowStep {
  id: string;
  kind: "deliver";
  /** Recipient email addresses (free-form; the operator list is the grant). */
  recipients: string[];
  /** Optional subject override; defaults to the document's title line. */
  subjectTemplate?: string;
}

export type WorkflowStep =
  | AgentWorkflowStep
  | WaitWorkflowStep
  | RoutineWorkflowStep
  | ToolWorkflowStep
  | ApprovalWorkflowStep
  | HttpWorkflowStep
  | EmitEventWorkflowStep
  | DeliverWorkflowStep
  | MemoryStageWorkflowStep;

export type WorkflowStepKind = WorkflowStep["kind"];

export const WORKFLOW_STEP_KINDS = [
  "agent",
  "routine",
  "tool",
  "approval",
  "wait",
  "http",
  "emit_event",
  "deliver",
  "memory_stage",
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
  /**
   * THINK-227 U1 (KTD1): snapshot of the automation's document binding at
   * conversion time, carried for readers that only see the definition. The
   * binding VALUE consumed at dispatch is always re-resolved from the
   * automation's live `target_spec` (so first-run capture never leaves a
   * stale snapshot authoritative); this copy exists so a definition is
   * self-describing about whether its agent step maintains a document.
   */
  documentBinding?: DocumentBinding;
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
    } else if (kind === "deliver") {
      validateDeliverStep(rawStep, id, index, errors, input);
    } else if (kind === "memory_stage") {
      validateMemoryStageStep(rawStep, id, index, errors);
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

  const binding = input.documentBinding;
  if (binding !== undefined) {
    if (!isRecord(binding)) {
      errors.push({
        stepId: null,
        field: "documentBinding",
        reason: "documentBinding must be a JSON object when present",
      });
    } else if (binding.mode !== "create" && binding.mode !== "existing") {
      errors.push({
        stepId: null,
        field: "documentBinding.mode",
        reason: 'documentBinding.mode must be "create" or "existing"',
      });
    }
  }

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
  if (rawStep.when !== undefined) {
    validateApprovalWhen(rawStep.when, id, index, errors);
  }
}

/**
 * `when` is a validated allowlist predicate, never an expression: exactly
 * one key (triggerFamily) holding a non-empty array drawn from
 * APPROVAL_TRIGGER_FAMILIES.
 */
function validateApprovalWhen(
  when: unknown,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
): void {
  if (!isRecord(when)) {
    errors.push({
      stepId: id,
      field: `steps[${index}].when`,
      reason: "when must be a JSON object when present",
    });
    return;
  }
  const unknownKeys = Object.keys(when).filter(
    (key) => key !== "triggerFamily",
  );
  if (unknownKeys.length > 0) {
    errors.push({
      stepId: id,
      field: `steps[${index}].when`,
      reason: `when supports only the triggerFamily predicate — unknown key(s): ${unknownKeys.join(", ")}`,
    });
  }
  const families = when.triggerFamily;
  if (!Array.isArray(families) || families.length === 0) {
    errors.push({
      stepId: id,
      field: `steps[${index}].when.triggerFamily`,
      reason: "when.triggerFamily must be a non-empty array",
    });
    return;
  }
  for (const family of families) {
    if (
      typeof family !== "string" ||
      !APPROVAL_TRIGGER_FAMILIES.includes(family as ApprovalTriggerFamily)
    ) {
      errors.push({
        stepId: id,
        field: `steps[${index}].when.triggerFamily`,
        reason: `"${String(family)}" is not a trigger family — allowed: ${APPROVAL_TRIGGER_FAMILIES.join(", ")}`,
      });
    }
  }
}

function validateMemoryStageStep(
  rawStep: Record<string, unknown>,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
): void {
  if (
    typeof rawStep.stage !== "string" ||
    !MEMORY_STAGE_KINDS.includes(rawStep.stage as MemoryStageKind)
  ) {
    errors.push({
      stepId: id,
      field: `steps[${index}].stage`,
      reason: `memory_stage step stage must be one of ${MEMORY_STAGE_KINDS.join(", ")}`,
    });
  }
  if (
    typeof rawStep.processorConfigId !== "string" ||
    !rawStep.processorConfigId.trim()
  ) {
    errors.push({
      stepId: id,
      field: `steps[${index}].processorConfigId`,
      reason:
        "memory_stage step requires the processorConfigId of the memory processor to run",
    });
  }
  if (
    rawStep.sourceConfigId !== undefined &&
    (typeof rawStep.sourceConfigId !== "string" ||
      !rawStep.sourceConfigId.trim())
  ) {
    errors.push({
      stepId: id,
      field: `steps[${index}].sourceConfigId`,
      reason: "sourceConfigId must be a non-empty string when present",
    });
  }
  if (rawStep.options !== undefined && !isRecord(rawStep.options)) {
    errors.push({
      stepId: id,
      field: `steps[${index}].options`,
      reason: "options must be a JSON object when present",
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

const MAX_DELIVER_RECIPIENTS = 50;
// Same deliberately-loose shape as the target-spec delivery normalizer: no
// whitespace, exactly one @, a dot in the domain — blocks header injection
// and obvious junk without re-implementing RFC 5322.
const DELIVER_RECIPIENT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateDeliverStep(
  rawStep: Record<string, unknown>,
  id: string | null,
  index: number,
  errors: DefinitionValidationError[],
  definition: Record<string, unknown>,
): void {
  const recipients = rawStep.recipients;
  if (!Array.isArray(recipients) || recipients.length === 0) {
    errors.push({
      stepId: id,
      field: `steps[${index}].recipients`,
      reason: "deliver step requires a non-empty recipients array",
    });
  } else {
    if (recipients.length > MAX_DELIVER_RECIPIENTS) {
      errors.push({
        stepId: id,
        field: `steps[${index}].recipients`,
        reason: `deliver step allows at most ${MAX_DELIVER_RECIPIENTS} recipients`,
      });
    }
    recipients.forEach((recipient, position) => {
      if (
        typeof recipient !== "string" ||
        !DELIVER_RECIPIENT_PATTERN.test(recipient)
      ) {
        errors.push({
          stepId: id,
          field: `steps[${index}].recipients[${position}]`,
          reason: `"${String(recipient)}" is not a plausible email address`,
        });
      }
    });
  }
  if (
    rawStep.subjectTemplate !== undefined &&
    (typeof rawStep.subjectTemplate !== "string" ||
      rawStep.subjectTemplate.length > 300 ||
      /[\r\n]/.test(rawStep.subjectTemplate))
  ) {
    errors.push({
      stepId: id,
      field: `steps[${index}].subjectTemplate`,
      reason:
        "subjectTemplate must be a single-line string of at most 300 characters",
    });
  }
  // A deliver step sends the workflow's maintained document — without a
  // binding there is nothing to deliver.
  if (definition.documentBinding === undefined) {
    errors.push({
      stepId: id,
      field: `steps[${index}]`,
      reason:
        "deliver step requires the workflow to carry a documentBinding — it sends the bound document",
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
