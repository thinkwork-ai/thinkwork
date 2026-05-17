import { GraphQLError } from "graphql";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computers,
  computerEvents,
  computerTasks,
} from "@thinkwork/database-pg/schema";

const db = getDb();
const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;
const MAX_GOOGLE_CALENDAR_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_GOOGLE_CALENDAR_WINDOW_MS = MAX_GOOGLE_CALENDAR_WINDOW_MS;
const DEFAULT_GOOGLE_CALENDAR_RESULTS = 10;
const MAX_GOOGLE_CALENDAR_RESULTS = 25;

export const COMPUTER_TASK_TYPES = [
  "health_check",
  "workspace_file_list",
  "workspace_file_read",
  "workspace_file_write",
  "workspace_file_delete",
  "thread_turn",
  "google_cli_smoke",
  "google_workspace_auth_check",
  "google_calendar_upcoming",
  "runbook_execute",
] as const;

export type ComputerTaskType = (typeof COMPUTER_TASK_TYPES)[number];
export type ComputerTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export class ComputerTaskInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputerTaskInputError";
  }
}

export async function enqueueComputerTask(input: {
  tenantId: string;
  computerId: string;
  taskType: ComputerTaskType;
  taskInput?: unknown;
  idempotencyKey?: string | null;
  createdByUserId?: string | null;
}) {
  await requireComputer(input.tenantId, input.computerId);
  const normalizedInput = normalizeTaskInput(input.taskType, input.taskInput);

  if (input.idempotencyKey) {
    const existing = await findTaskByIdempotencyKey({
      tenantId: input.tenantId,
      computerId: input.computerId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      return { ...toGraphqlComputerTask(existing), wasCreated: false };
    }
  }

  const [task] = await insertTask({
    ...input,
    normalizedInput,
  });

  await db.insert(computerEvents).values({
    tenant_id: input.tenantId,
    computer_id: input.computerId,
    task_id: task.id,
    event_type: "computer_task_enqueued",
    level: "info",
    payload: {
      taskType: input.taskType,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });

  return { ...toGraphqlComputerTask(task), wasCreated: true };
}

async function insertTask(input: {
  tenantId: string;
  computerId: string;
  taskType: ComputerTaskType;
  normalizedInput: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  createdByUserId?: string | null;
}) {
  try {
    return await db
      .insert(computerTasks)
      .values({
        tenant_id: input.tenantId,
        computer_id: input.computerId,
        task_type: input.taskType,
        input: input.normalizedInput,
        idempotency_key: input.idempotencyKey ?? null,
        created_by_user_id: input.createdByUserId ?? null,
      })
      .returning();
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const existing = await findTaskByIdempotencyKey({
        tenantId: input.tenantId,
        computerId: input.computerId,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) return [existing];
    }
    throw err;
  }
}

export async function listComputerTasks(input: {
  tenantId: string;
  computerId: string;
  threadId?: string | null;
  status?: ComputerTaskStatus | null;
  limit?: number | null;
}) {
  await requireComputer(input.tenantId, input.computerId);
  const conditions = [
    eq(computerTasks.tenant_id, input.tenantId),
    eq(computerTasks.computer_id, input.computerId),
  ];
  if (input.status) {
    conditions.push(eq(computerTasks.status, input.status));
  }
  if (input.threadId) {
    conditions.push(
      sql`${computerTasks.input}->>'threadId' = ${input.threadId}`,
    );
  }
  const rows = await db
    .select()
    .from(computerTasks)
    .where(and(...conditions))
    .orderBy(desc(computerTasks.created_at))
    .limit(Math.min(Math.max(input.limit ?? 25, 1), 100));
  return rows.map((row) => toGraphqlComputerTask(row));
}

export function parseComputerTaskType(value: unknown): ComputerTaskType {
  const normalized = String(value ?? "").toLowerCase();
  if (isComputerTaskType(normalized)) return normalized;
  throw new GraphQLError(`Unsupported Computer task type: ${String(value)}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function parseComputerTaskStatus(
  value: unknown,
): ComputerTaskStatus | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "running" ||
    normalized === "completed" ||
    normalized === "failed" ||
    normalized === "cancelled"
  ) {
    return normalized;
  }
  throw new GraphQLError(`Invalid Computer task status: ${String(value)}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function normalizeTaskInput(
  taskType: ComputerTaskType,
  input: unknown,
): Record<string, unknown> | null {
  if (
    taskType === "health_check" ||
    taskType === "workspace_file_list" ||
    taskType === "google_cli_smoke"
  ) {
    return null;
  }

  if (taskType === "google_workspace_auth_check") {
    return normalizeRequesterEnvelopeInput(input);
  }

  if (taskType === "google_calendar_upcoming") {
    return normalizeGoogleCalendarUpcomingInput(input);
  }

  if (taskType === "thread_turn") {
    return normalizeThreadTurnInput(input);
  }

  if (taskType === "runbook_execute") {
    return normalizeRunbookExecuteInput(input);
  }

  if (taskType === "workspace_file_write") {
    const payload = coerceObject(input);
    const path = requiredString(payload.path, "path");
    const content = requiredString(payload.content, "content");
    if (Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_FILE_BYTES) {
      throw new ComputerTaskInputError(
        `content must be ${MAX_WORKSPACE_FILE_BYTES} bytes or less`,
      );
    }
    return { path: validateWorkspaceRelativePath(path), content };
  }

  if (
    taskType === "workspace_file_read" ||
    taskType === "workspace_file_delete"
  ) {
    const payload = coerceObject(input);
    return {
      path: validateWorkspaceRelativePath(requiredString(payload.path, "path")),
    };
  }

  return assertNever(taskType);
}

export function validateWorkspaceRelativePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new ComputerTaskInputError("path is required");
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new ComputerTaskInputError("path must be workspace-relative");
  }
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new ComputerTaskInputError("path cannot contain . or .. segments");
  }
  return parts.join("/");
}

function normalizeThreadTurnInput(input: unknown): Record<string, unknown> {
  const payload = coerceObject(input);
  const source =
    typeof payload.source === "string" && payload.source.trim()
      ? payload.source.trim()
      : "chat_message";
  if (source === "slack") return normalizeSlackThreadTurnInput(payload);
  const actorType = optionalString(payload.actorType);
  const actorId = optionalString(payload.actorId);
  const requesterUserId = normalizeRequesterUserId({
    requesterUserId: payload.requesterUserId,
    actorType,
    actorId,
    taskName: "thread_turn",
  });

  return {
    threadId: requiredString(payload.threadId, "threadId"),
    messageId: requiredString(payload.messageId, "messageId"),
    source,
    actorType,
    actorId,
    requesterUserId,
    contextClass:
      optionalString(payload.contextClass) ??
      (requesterUserId ? "user" : "system"),
    runbookRunId: optionalString(payload.runbookRunId),
    credentialSubject: normalizeCredentialSubject(payload, requesterUserId),
    event: normalizeEvent(payload.event),
    surfaceContext: normalizeSurfaceContext(payload, source),
  };
}

function normalizeSlackThreadTurnInput(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const slackPayload = coerceObject(payload.slack ?? payload);
  const sourceMessage =
    slackPayload.sourceMessage === null
      ? null
      : coerceObject(slackPayload.sourceMessage);
  const slack = {
    slackTeamId: requiredString(slackPayload.slackTeamId, "slackTeamId"),
    slackUserId: requiredString(slackPayload.slackUserId, "slackUserId"),
    slackWorkspaceRowId: optionalString(slackPayload.slackWorkspaceRowId),
    channelId: requiredString(slackPayload.channelId, "channelId"),
    channelType: requiredString(slackPayload.channelType, "channelType"),
    rootThreadTs: optionalString(slackPayload.rootThreadTs),
    responseUrl: optionalString(slackPayload.responseUrl),
    triggerSurface: requiredString(
      slackPayload.triggerSurface,
      "triggerSurface",
    ),
    sourceMessage,
    threadContext: Array.isArray(slackPayload.threadContext)
      ? slackPayload.threadContext
      : [],
    fileRefs: Array.isArray(slackPayload.fileRefs) ? slackPayload.fileRefs : [],
    placeholderTs: optionalString(slackPayload.placeholderTs),
    modalViewId: optionalString(slackPayload.modalViewId),
  };
  const actorType = optionalString(payload.actorType) ?? "user";
  const actorId = requiredString(payload.actorId, "actorId");
  const requesterUserId = normalizeRequesterUserId({
    requesterUserId: payload.requesterUserId,
    actorType,
    actorId,
    taskName: "thread_turn",
  });
  return {
    source: "slack",
    threadId: requiredString(payload.threadId, "threadId"),
    messageId: requiredString(payload.messageId, "messageId"),
    slack,
    channelType: requiredString(payload.channelType, "channelType"),
    slackTeamId: slack.slackTeamId,
    slackUserId: slack.slackUserId,
    slackWorkspaceRowId: slack.slackWorkspaceRowId,
    triggerSurface: slack.triggerSurface,
    rootThreadTs: slack.rootThreadTs,
    channelId: slack.channelId,
    threadTs: requiredString(payload.threadTs, "threadTs"),
    messageTs: requiredString(payload.messageTs, "messageTs"),
    eventId: requiredString(payload.eventId, "eventId"),
    sourceMessage,
    threadContext: slack.threadContext,
    fileRefs: slack.fileRefs,
    responseUrl: slack.responseUrl,
    placeholderTs: slack.placeholderTs,
    modalViewId: slack.modalViewId,
    actorType,
    actorId,
    requesterUserId,
    contextClass: "user",
    surfaceContext: {
      source: "slack",
      channelType: slack.channelType,
      triggerSurface: slack.triggerSurface,
      slackTeamId: slack.slackTeamId,
      slackUserId: slack.slackUserId,
      slackWorkspaceRowId: slack.slackWorkspaceRowId,
      channelId: slack.channelId,
      rootThreadTs: slack.rootThreadTs,
    },
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRequesterUserId(input: {
  requesterUserId: unknown;
  actorType: string | null;
  actorId: string | null;
  taskName: string;
}): string | null {
  const explicit = optionalString(input.requesterUserId);
  const requesterUserId =
    explicit ?? (input.actorType === "user" ? input.actorId : null);
  if (input.actorType === "user" && !requesterUserId) {
    throw new ComputerTaskInputError(
      `requesterUserId is required for user-originated ${input.taskName} tasks`,
    );
  }
  return requesterUserId;
}

function requesterEnvelopeFields(payload: Record<string, unknown>) {
  const actorType = optionalString(payload.actorType);
  const actorId = optionalString(payload.actorId);
  const requesterUserId = normalizeRequesterUserId({
    requesterUserId: payload.requesterUserId,
    actorType,
    actorId,
    taskName: "Google Workspace",
  });
  return {
    ...(actorType ? { actorType } : {}),
    ...(actorId ? { actorId } : {}),
    ...(requesterUserId ? { requesterUserId, contextClass: "user" } : {}),
  };
}

function normalizeSurfaceContext(
  payload: Record<string, unknown>,
  source: string,
) {
  const explicit =
    payload.surfaceContext &&
    typeof payload.surfaceContext === "object" &&
    !Array.isArray(payload.surfaceContext)
      ? (payload.surfaceContext as Record<string, unknown>)
      : {};
  return {
    source,
    triggerId: optionalString(payload.triggerId),
    triggerType: optionalString(payload.triggerType),
    scheduleName: optionalString(payload.scheduleName),
    ...explicit,
  };
}

function normalizeCredentialSubject(
  payload: Record<string, unknown>,
  requesterUserId: string | null,
) {
  const raw =
    payload.credentialSubject &&
    typeof payload.credentialSubject === "object" &&
    !Array.isArray(payload.credentialSubject)
      ? (payload.credentialSubject as Record<string, unknown>)
      : null;
  if (!raw) return null;

  const type = optionalString(raw.type);
  const userId = optionalString(raw.userId);
  if (type !== "user" || !userId) {
    throw new ComputerTaskInputError(
      "credentialSubject must identify a user subject",
    );
  }
  if (requesterUserId && userId !== requesterUserId) {
    throw new ComputerTaskInputError(
      "credentialSubject.userId must match requesterUserId",
    );
  }

  return {
    type,
    userId,
    connectionId: optionalString(raw.connectionId),
    provider: optionalString(raw.provider),
  };
}

function normalizeEvent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeRunbookExecuteInput(input: unknown): Record<string, unknown> {
  const payload = coerceObject(input);
  const actorType = optionalString(payload.actorType);
  const actorId = optionalString(payload.actorId);
  const requesterUserId = normalizeRequesterUserId({
    requesterUserId: payload.requesterUserId,
    actorType,
    actorId,
    taskName: "runbook_execute",
  });
  return {
    runbookRunId: requiredString(payload.runbookRunId, "runbookRunId"),
    threadId: requiredString(payload.threadId, "threadId"),
    messageId: requiredString(payload.messageId, "messageId"),
    actorType,
    actorId,
    requesterUserId,
    contextClass: requesterUserId ? "user" : "system",
  };
}

function normalizeGoogleCalendarUpcomingInput(
  input: unknown,
): Record<string, unknown> {
  const payload =
    input === undefined || input === null ? {} : coerceObject(input);
  const now = new Date();
  const timeMin = optionalDate(payload.timeMin, "timeMin") ?? now;
  const requestedTimeMax =
    optionalDate(payload.timeMax, "timeMax") ??
    new Date(timeMin.getTime() + DEFAULT_GOOGLE_CALENDAR_WINDOW_MS);
  if (requestedTimeMax.getTime() <= timeMin.getTime()) {
    throw new ComputerTaskInputError("timeMax must be after timeMin");
  }
  const maxTimeMax = new Date(
    timeMin.getTime() + MAX_GOOGLE_CALENDAR_WINDOW_MS,
  );
  const timeMax =
    requestedTimeMax.getTime() > maxTimeMax.getTime()
      ? maxTimeMax
      : requestedTimeMax;
  const maxResults = clampInteger(
    payload.maxResults,
    DEFAULT_GOOGLE_CALENDAR_RESULTS,
    1,
    MAX_GOOGLE_CALENDAR_RESULTS,
  );
  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults,
    ...requesterEnvelopeFields(payload),
  };
}

function normalizeRequesterEnvelopeInput(
  input: unknown,
): Record<string, unknown> | null {
  if (input === undefined || input === null) return null;
  const payload = coerceObject(input);
  const envelope = requesterEnvelopeFields(payload);
  return Object.keys(envelope).length > 0 ? envelope : null;
}

export function toGraphqlComputerTask(row: Record<string, any>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    computerId: row.computer_id,
    taskType: String(row.task_type ?? "").toUpperCase(),
    status: String(row.status ?? "").toUpperCase(),
    input: row.input ?? null,
    output: row.output ?? null,
    error: row.error ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    claimedAt: row.claimed_at ?? null,
    completedAt: row.completed_at ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findTaskByIdempotencyKey(input: {
  tenantId: string;
  computerId: string;
  idempotencyKey: string;
}) {
  const [task] = await db
    .select()
    .from(computerTasks)
    .where(
      and(
        eq(computerTasks.tenant_id, input.tenantId),
        eq(computerTasks.computer_id, input.computerId),
        eq(computerTasks.idempotency_key, input.idempotencyKey),
      ),
    )
    .orderBy(asc(computerTasks.created_at))
    .limit(1);
  return task ?? null;
}

async function requireComputer(tenantId: string, computerId: string) {
  const [computer] = await db
    .select({ id: computers.id })
    .from(computers)
    .where(and(eq(computers.tenant_id, tenantId), eq(computers.id, computerId)))
    .limit(1);
  if (!computer) {
    throw new GraphQLError("Computer not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
}

function isComputerTaskType(value: string): value is ComputerTaskType {
  return COMPUTER_TASK_TYPES.includes(value as ComputerTaskType);
}

function coerceObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new ComputerTaskInputError(
        "input must be an object or JSON object",
      );
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new ComputerTaskInputError("input must be an object");
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ComputerTaskInputError(`${name} is required`);
  }
  return value;
}

function optionalDate(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ComputerTaskInputError(`${name} must be an ISO timestamp`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ComputerTaskInputError(`${name} must be an ISO timestamp`);
  }
  return date;
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new ComputerTaskInputError("maxResults must be a number");
  }
  const integer = Math.floor(parsed);
  return Math.min(Math.max(integer, min), max);
}

function assertNever(value: never): never {
  throw new ComputerTaskInputError(`Unsupported task type: ${String(value)}`);
}

function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}
