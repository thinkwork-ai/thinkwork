export class N8nAgentStepPayloadError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "N8nAgentStepPayloadError";
  }
}

export interface ParsedN8nAgentStepResumeUrl {
  href: string;
  host: string;
  path: string;
}

export interface ParsedN8nAgentStepStartPayload {
  workflowId: string;
  workflowName: string | null;
  executionId: string;
  stepId: string;
  correlationId: string;
  requestId: string | null;
  agentId: string;
  spaceId: string;
  instructions: string;
  input: unknown;
  metadata: Record<string, unknown>;
  timeoutSeconds: number | null;
  resumeUrl: ParsedN8nAgentStepResumeUrl | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseN8nAgentStepStartPayload(
  value: unknown,
): ParsedN8nAgentStepStartPayload {
  const input = objectValue(value, "request body");
  const workflowId = requiredString(input.workflowId, "workflowId", 256);
  const executionId = requiredString(input.executionId, "executionId", 256);
  const stepId = requiredString(input.stepId, "stepId", 256);
  const correlationId = requiredString(
    input.correlationId,
    "correlationId",
    256,
  );
  const agentId = requiredUuid(input.agentId, "agentId");
  const spaceId = requiredUuid(input.spaceId, "spaceId");
  const instructions = requiredString(
    input.instructions,
    "instructions",
    20_000,
  );

  return {
    workflowId,
    workflowName: optionalString(input.workflowName, "workflowName", 512),
    executionId,
    stepId,
    correlationId,
    requestId: optionalString(input.requestId, "requestId", 256),
    agentId,
    spaceId,
    instructions,
    input: input.input ?? null,
    metadata: optionalRecord(input.metadata, "metadata"),
    timeoutSeconds: optionalTimeoutSeconds(input.timeoutSeconds),
    resumeUrl: parseResumeUrl(input.resumeUrl),
  };
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const trimmed = stringValue(value, field, maxLength);
  if (!trimmed) {
    throw new N8nAgentStepPayloadError(`${field} is required`);
  }
  return trimmed;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return stringValue(value, field, maxLength);
}

function stringValue(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new N8nAgentStepPayloadError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new N8nAgentStepPayloadError(
      `${field} must be ${maxLength} characters or fewer`,
    );
  }
  return trimmed;
}

function requiredUuid(value: unknown, field: string): string {
  const id = requiredString(value, field, 128);
  if (!UUID_RE.test(id)) {
    throw new N8nAgentStepPayloadError(`${field} must be a UUID`);
  }
  return id;
}

function optionalTimeoutSeconds(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new N8nAgentStepPayloadError("timeoutSeconds must be an integer");
  }
  return value;
}

function parseResumeUrl(value: unknown): ParsedN8nAgentStepResumeUrl | null {
  const raw = optionalString(value, "resumeUrl", 4096);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new N8nAgentStepPayloadError("resumeUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new N8nAgentStepPayloadError("resumeUrl must use https");
  }
  if (parsed.username || parsed.password) {
    throw new N8nAgentStepPayloadError(
      "resumeUrl must not include credentials",
    );
  }
  return {
    href: parsed.href,
    host: parsed.host,
    path: `${parsed.pathname}${parsed.search}`,
  };
}

function optionalRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return objectValue(value, field);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new N8nAgentStepPayloadError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}
