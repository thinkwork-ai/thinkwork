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
  "connector_work",
  "thread_turn",
  "google_cli_smoke",
  "google_workspace_auth_check",
  "google_calendar_upcoming",
  "dashboard_artifact_refresh",
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
    if (existing) return toGraphqlComputerTask(existing);
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

  return toGraphqlComputerTask(task);
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
    conditions.push(sql`${computerTasks.input}->>'threadId' = ${input.threadId}`);
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
    taskType === "google_cli_smoke" ||
    taskType === "google_workspace_auth_check"
  ) {
    return null;
  }

  if (taskType === "google_calendar_upcoming") {
    return normalizeGoogleCalendarUpcomingInput(input);
  }

  if (taskType === "dashboard_artifact_refresh") {
    return normalizeDashboardArtifactRefreshInput(input);
  }

  if (taskType === "connector_work") {
    return normalizeConnectorWorkInput(input);
  }

  if (taskType === "thread_turn") {
    return normalizeThreadTurnInput(input);
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

function normalizeConnectorWorkInput(input: unknown): Record<string, unknown> {
  const payload = coerceObject(input);
  return {
    connectorId: requiredString(payload.connectorId, "connectorId"),
    connectorExecutionId: requiredString(
      payload.connectorExecutionId,
      "connectorExecutionId",
    ),
    externalRef: requiredString(payload.externalRef, "externalRef"),
    title: requiredString(payload.title, "title"),
    body: requiredString(payload.body, "body"),
    metadata:
      payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : null,
  };
}

function normalizeThreadTurnInput(input: unknown): Record<string, unknown> {
  const payload = coerceObject(input);
  return {
    threadId: requiredString(payload.threadId, "threadId"),
    messageId: requiredString(payload.messageId, "messageId"),
    source:
      typeof payload.source === "string" && payload.source.trim()
        ? payload.source.trim()
        : "chat_message",
    actorType:
      typeof payload.actorType === "string" && payload.actorType.trim()
        ? payload.actorType.trim()
        : null,
    actorId:
      typeof payload.actorId === "string" && payload.actorId.trim()
        ? payload.actorId.trim()
        : null,
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
  };
}

function normalizeDashboardArtifactRefreshInput(
  input: unknown,
): Record<string, unknown> {
  const payload = coerceObject(input);
  const recipeVersion = clampInteger(payload.recipeVersion, 1, 1, 100_000);
  return {
    artifactId: requiredString(payload.artifactId, "artifactId"),
    requestedByUserId: requiredString(
      payload.requestedByUserId,
      "requestedByUserId",
    ),
    recipeId:
      typeof payload.recipeId === "string" && payload.recipeId.trim()
        ? payload.recipeId.trim()
        : null,
    recipeVersion,
    dashboardKind:
      typeof payload.dashboardKind === "string" && payload.dashboardKind.trim()
        ? payload.dashboardKind.trim()
        : "pipeline_risk",
  };
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
