import { createHash } from "node:crypto";

export const WORKFLOW_TRIGGER_FAMILIES = [
  "manual",
  "schedule",
  "webhook",
  "crm",
  "n8n",
  "api",
  "agent",
  "child_workflow",
] as const;

export type WorkflowTriggerFamily = (typeof WORKFLOW_TRIGGER_FAMILIES)[number];

export const WORKFLOW_TRIGGER_ACTOR_TYPES = [
  "user",
  "agent",
  "system",
  "api_key",
  "schedule",
  "connected_app",
  "app_user",
  "child_workflow",
] as const;

export type WorkflowTriggerActorType =
  (typeof WORKFLOW_TRIGGER_ACTOR_TYPES)[number];

export type WorkflowTriggerActorInput = {
  type: WorkflowTriggerActorType;
  id?: string | null;
  externalId?: string | null;
  displayName?: string | null;
};

export type WorkflowTriggerContractInput = {
  family: WorkflowTriggerFamily;
  source: string;
  actor: WorkflowTriggerActorInput;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  nonIdempotent?: boolean;
  payload?: Record<string, unknown> | null;
  occurredAt?: Date | string | null;
};

export type NormalizedWorkflowTrigger = {
  triggerFamily: WorkflowTriggerFamily;
  triggerSource: string;
  actorType: WorkflowTriggerActorType;
  actorId: string | null;
  actorExternalId: string | null;
  actorDisplayName: string | null;
  idempotencyKey: string | null;
  correlationId: string;
  idempotencyRequired: boolean;
  inputSummary: Record<string, unknown>;
  occurredAt: Date | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXTERNAL_IDEMPOTENT_FAMILIES = new Set<WorkflowTriggerFamily>([
  "schedule",
  "webhook",
  "crm",
  "n8n",
  "api",
  "agent",
  "child_workflow",
]);

export function normalizeWorkflowTriggerContract(
  input: WorkflowTriggerContractInput,
): NormalizedWorkflowTrigger {
  if (!WORKFLOW_TRIGGER_FAMILIES.includes(input.family)) {
    throw new Error(`unsupported workflow trigger family: ${input.family}`);
  }
  const triggerSource = input.source.trim();
  if (!triggerSource) {
    throw new Error("workflow trigger source is required");
  }
  if (!input.actor?.type) {
    throw new Error("workflow trigger actor is required");
  }
  if (!WORKFLOW_TRIGGER_ACTOR_TYPES.includes(input.actor.type)) {
    throw new Error(`unsupported workflow trigger actor: ${input.actor.type}`);
  }

  const idempotencyRequired =
    EXTERNAL_IDEMPOTENT_FAMILIES.has(input.family) && !input.nonIdempotent;
  const idempotencyKey = normalizeString(input.idempotencyKey);
  if (idempotencyRequired && !idempotencyKey) {
    throw new Error(
      `${input.family} workflow triggers require a stable idempotency key`,
    );
  }
  if (input.nonIdempotent && input.family !== "manual") {
    throw new Error("only manual workflow triggers may opt out of idempotency");
  }

  const occurredAt = normalizeDate(input.occurredAt);
  const actorId = isUuid(input.actor.id) ? input.actor.id : null;
  const actorExternalId =
    normalizeString(input.actor.externalId) ??
    (actorId ? null : normalizeString(input.actor.id));
  const actorDisplayName = normalizeString(input.actor.displayName);
  const correlationId =
    normalizeString(input.correlationId) ??
    idempotencyKey ??
    buildManualCorrelationId(input.family, triggerSource, input.payload);

  return {
    triggerFamily: input.family,
    triggerSource,
    actorType: input.actor.type,
    actorId,
    actorExternalId,
    actorDisplayName,
    idempotencyKey,
    correlationId,
    idempotencyRequired,
    inputSummary: buildInputSummary({
      payload: input.payload,
      actorExternalId,
      actorDisplayName,
      occurredAt,
    }),
    occurredAt,
  };
}

export function workflowRunTriggerColumns(trigger: NormalizedWorkflowTrigger) {
  return {
    trigger_family: trigger.triggerFamily,
    trigger_source: trigger.triggerSource,
    actor_type: trigger.actorType,
    actor_id: trigger.actorId,
    idempotency_key: trigger.idempotencyKey,
    correlation_id: trigger.correlationId,
    input_summary: trigger.inputSummary,
  };
}

function buildInputSummary(input: {
  payload?: Record<string, unknown> | null;
  actorExternalId: string | null;
  actorDisplayName: string | null;
  occurredAt: Date | null;
}): Record<string, unknown> {
  return {
    ...(input.payload ?? {}),
    actorExternalId: input.actorExternalId,
    actorDisplayName: input.actorDisplayName,
    occurredAt: input.occurredAt?.toISOString() ?? null,
  };
}

function buildManualCorrelationId(
  family: WorkflowTriggerFamily,
  source: string,
  payload?: Record<string, unknown> | null,
): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(payload ?? {}))
    .digest("hex")
    .slice(0, 16);
  return `${family}:${source}:${hash}`;
}

function normalizeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
