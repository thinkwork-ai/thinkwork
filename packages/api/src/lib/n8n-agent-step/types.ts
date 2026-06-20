import { createHash } from "node:crypto";

export const N8N_AGENT_STEP_TIMEOUT_DEFAULT_SECONDS = 24 * 60 * 60;
export const N8N_AGENT_STEP_TIMEOUT_MIN_SECONDS = 5 * 60;
export const N8N_AGENT_STEP_TIMEOUT_MAX_SECONDS = 7 * 24 * 60 * 60;

export const N8N_AGENT_STEP_RUN_STATUSES = [
  "accepted",
  "waiting",
  "awaiting_human",
  "resume_pending",
  "resuming",
  "resumed",
  "resume_failed",
  "failed",
  "expired",
] as const;

export type N8nAgentStepRunStatus =
  (typeof N8N_AGENT_STEP_RUN_STATUSES)[number];

export const N8N_AGENT_STEP_TERMINAL_RUN_STATUSES = [
  "resumed",
  "resume_failed",
  "failed",
  "expired",
] as const satisfies readonly N8nAgentStepRunStatus[];

export type N8nAgentStepTerminalRunStatus =
  (typeof N8N_AGENT_STEP_TERMINAL_RUN_STATUSES)[number];

export const N8N_AGENT_STEP_RESUME_PAYLOAD_STATUSES = [
  "succeeded",
  "failed",
  "expired",
] as const;

export type N8nAgentStepResumePayloadStatus =
  (typeof N8N_AGENT_STEP_RESUME_PAYLOAD_STATUSES)[number];

export interface N8nAgentStepIdentity {
  workflowId: string;
  workflowName?: string | null;
  executionId: string;
  stepId: string;
}

export interface N8nAgentStepIdempotencyInput {
  tenantId: string;
  n8n: N8nAgentStepIdentity;
  correlationId: string;
}

export interface N8nAgentStepTimeoutResult {
  timeoutSeconds: number;
  expiresAt: Date;
}

export interface N8nAgentStepValidationError {
  code: string;
  field: string;
  message: string;
}

export class N8nAgentStepContractError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(error: N8nAgentStepValidationError) {
    super(error.message);
    this.name = "N8nAgentStepContractError";
    this.code = error.code;
    this.field = error.field;
  }
}

const SECRET_KEY_PATTERN =
  /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|credential|password|secret|signature|resume[_-]?url|webhook[_-]?url)/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i;
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{13,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/;
const PREFIXED_SECRET_PATTERN =
  /\b(?:gh[oprsu]_[A-Za-z0-9]{20,}|xox[abep]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{40,}|sk-proj-[A-Za-z0-9_-]{40,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16})\b/;

const REDACTED = "[redacted]";
const MAX_PREVIEW_CHARS = 2048;

export function buildN8nAgentStepIdempotencyKey(
  input: N8nAgentStepIdempotencyInput,
): string {
  const parts = [
    input.tenantId,
    input.n8n.workflowId,
    input.n8n.executionId,
    input.correlationId,
    input.n8n.stepId,
  ].map((part) => normalizeIdentityPart(part));
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

export function normalizeN8nAgentStepTimeout(input: {
  timeoutSeconds?: number | null;
  now?: Date;
}): N8nAgentStepTimeoutResult {
  const timeoutSeconds =
    input.timeoutSeconds ?? N8N_AGENT_STEP_TIMEOUT_DEFAULT_SECONDS;
  if (!Number.isInteger(timeoutSeconds)) {
    throw new N8nAgentStepContractError({
      code: "N8N_AGENT_STEP_TIMEOUT_INVALID",
      field: "timeoutSeconds",
      message: "timeoutSeconds must be an integer number of seconds.",
    });
  }
  if (
    timeoutSeconds < N8N_AGENT_STEP_TIMEOUT_MIN_SECONDS ||
    timeoutSeconds > N8N_AGENT_STEP_TIMEOUT_MAX_SECONDS
  ) {
    throw new N8nAgentStepContractError({
      code: "N8N_AGENT_STEP_TIMEOUT_OUT_OF_RANGE",
      field: "timeoutSeconds",
      message: "timeoutSeconds must be between 300 seconds and 604800 seconds.",
    });
  }

  const now = input.now ?? new Date();
  return {
    timeoutSeconds,
    expiresAt: new Date(now.getTime() + timeoutSeconds * 1000),
  };
}

export function sanitizeN8nAgentStepMetadata(
  metadata: unknown,
): Record<string, unknown> {
  const sanitized = sanitizeMetadataValue(metadata, []);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {};
  }
  return sanitized as Record<string, unknown>;
}

export function previewN8nAgentStepValue(value: unknown): string {
  if (typeof value === "string") {
    return truncate(value.trim(), MAX_PREVIEW_CHARS);
  }
  try {
    return truncate(JSON.stringify(value), MAX_PREVIEW_CHARS);
  } catch {
    return "[unserializable]";
  }
}

function normalizeIdentityPart(part: string): string {
  const normalized = part.trim();
  if (!normalized) {
    throw new N8nAgentStepContractError({
      code: "N8N_AGENT_STEP_IDENTITY_EMPTY",
      field: "idempotency",
      message:
        "n8n workflow, execution, correlation, and step ids are required.",
    });
  }
  return normalized;
}

function sanitizeMetadataValue(value: unknown, path: string[]): unknown {
  if (path.some((part) => SECRET_KEY_PATTERN.test(part))) {
    return REDACTED;
  }

  if (typeof value === "string") {
    if (looksSecretish(value)) return REDACTED;
    return truncate(value, MAX_PREVIEW_CHARS);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 25)
      .map((item, index) => sanitizeMetadataValue(item, [...path, `${index}`]));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      50,
    );
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [
        key,
        sanitizeMetadataValue(entryValue, [...path, key]),
      ]),
    );
  }

  return String(value);
}

function looksSecretish(value: string): boolean {
  return (
    BEARER_PATTERN.test(value) ||
    JWT_PATTERN.test(value) ||
    PREFIXED_SECRET_PATTERN.test(value)
  );
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 15)}...[truncated]`;
}
