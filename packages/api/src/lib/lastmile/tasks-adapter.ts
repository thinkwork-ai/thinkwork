import {
  type LinkedTaskStatus,
  type LinkedTaskSyncStatus,
  normalizeExternalTaskStatus,
} from "../linked-tasks/status.js";
import {
  type EvaluateExternalTaskWritebackInput,
  evaluateExternalTaskWriteback,
} from "../spaces/writeback-policy.js";

export interface LastMileMcpToolCall {
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface LastMileMcpToolResponse {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface LastMileMcpClient {
  callTool(call: LastMileMcpToolCall): Promise<LastMileMcpToolResponse>;
}

export interface LastMileTasksAdapterOptions {
  client: LastMileMcpClient;
  serverName?: string;
  toolNames?: Partial<LastMileTaskToolNames>;
}

export interface LastMileTaskToolNames {
  createTask: string;
  readTask: string;
  postComment: string;
}

export interface LastMileTaskAssigneeInput {
  roleKey?: string | null;
  externalId?: string | null;
  displayName?: string | null;
}

export interface CreateLastMileTaskInput {
  tenantId: string;
  spaceId: string;
  threadId: string;
  checklistItemId?: string | null;
  idempotencyKey: string;
  title: string;
  description?: string | null;
  required?: boolean;
  assignee?: LastMileTaskAssigneeInput | null;
  dueAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ReadLastMileTaskInput {
  externalTaskId: string;
}

export interface PostLastMileTaskCommentInput {
  externalTaskId: string;
  body: string;
  writeback: EvaluateExternalTaskWritebackInput;
  metadata?: Record<string, unknown> | null;
}

export interface LastMileTaskSnapshot {
  externalTaskId: string;
  externalTaskUrl: string | null;
  title: string | null;
  status: LinkedTaskStatus;
  blocked: boolean;
  syncStatus: LinkedTaskSyncStatus;
  assignee: {
    externalId: string | null;
    displayName: string | null;
  } | null;
  dueAt: string | null;
  idempotent: boolean;
  needsTriage: boolean;
  raw: unknown;
}

export interface LastMileCommentResult {
  externalTaskId: string;
  commentId: string | null;
  postedAt: string | null;
  raw: unknown;
}

export interface LastMileProviderError {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
  detail?: unknown;
}

export type LastMileAdapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; providerError: LastMileProviderError };

export type LastMileCommentAdapterResult =
  | LastMileAdapterResult<LastMileCommentResult>
  | {
      ok: false;
      blockedByPolicy: ReturnType<typeof evaluateExternalTaskWriteback>;
    };

const DEFAULT_TOOL_NAMES: LastMileTaskToolNames = {
  createTask: "create_task",
  readTask: "read_task",
  postComment: "post_comment",
};

export function createLastMileTasksAdapter(
  options: LastMileTasksAdapterOptions,
) {
  const serverName = options.serverName ?? "lastmile-tasks";
  const toolNames = { ...DEFAULT_TOOL_NAMES, ...options.toolNames };

  return {
    async createTask(
      input: CreateLastMileTaskInput,
    ): Promise<LastMileAdapterResult<LastMileTaskSnapshot>> {
      const response = await callProvider(options.client, {
        serverName,
        toolName: toolNames.createTask,
        arguments: {
          tenantId: input.tenantId,
          spaceId: input.spaceId,
          threadId: input.threadId,
          checklistItemId: input.checklistItemId ?? null,
          idempotencyKey: input.idempotencyKey,
          title: input.title,
          description: input.description ?? null,
          required: input.required ?? true,
          assignee: normalizeAssigneeInput(input.assignee),
          dueAt: input.dueAt ?? null,
          metadata: input.metadata ?? {},
        },
      });
      if (!response.ok) return response;

      return toTaskSnapshotResult(response.value, {
        fallback: {
          title: input.title,
          needsTriage:
            !input.assignee?.externalId && Boolean(input.assignee?.roleKey),
        },
      });
    },

    async readTask(
      input: ReadLastMileTaskInput,
    ): Promise<LastMileAdapterResult<LastMileTaskSnapshot>> {
      const response = await callProvider(options.client, {
        serverName,
        toolName: toolNames.readTask,
        arguments: { externalTaskId: input.externalTaskId },
      });
      if (!response.ok) return response;
      return toTaskSnapshotResult(response.value, { fallback: {} });
    },

    async postComment(
      input: PostLastMileTaskCommentInput,
    ): Promise<LastMileCommentAdapterResult> {
      const decision = evaluateExternalTaskWriteback(input.writeback);
      if (!decision.allowed) {
        return { ok: false, blockedByPolicy: decision };
      }

      const response = await callProvider(options.client, {
        serverName,
        toolName: toolNames.postComment,
        arguments: {
          externalTaskId: input.externalTaskId,
          body: input.body,
          metadata: input.metadata ?? {},
        },
      });
      if (!response.ok) return response;

      const record = objectRecord(response.value);
      return {
        ok: true,
        value: {
          externalTaskId: input.externalTaskId,
          commentId: stringValue(record.commentId) ?? stringValue(record.id),
          postedAt:
            stringValue(record.postedAt) ?? stringValue(record.createdAt),
          raw: response.value,
        },
      };
    },
  };
}

async function callProvider(
  client: LastMileMcpClient,
  call: LastMileMcpToolCall,
): Promise<LastMileAdapterResult<unknown>> {
  try {
    const response = await client.callTool(call);
    if (response.isError) {
      return {
        ok: false,
        providerError: toProviderError(
          extractPayload(response),
          "MCP_TOOL_ERROR",
        ),
      };
    }
    return { ok: true, value: extractPayload(response) };
  } catch (error) {
    return {
      ok: false,
      providerError: toProviderError(error, "MCP_CALL_FAILED"),
    };
  }
}

function toTaskSnapshotResult(
  value: unknown,
  options: { fallback: { title?: string; needsTriage?: boolean } },
): LastMileAdapterResult<LastMileTaskSnapshot> {
  const snapshot = toTaskSnapshot(value, options.fallback);
  if (!snapshot.externalTaskId) {
    return {
      ok: false,
      providerError: {
        code: "PROVIDER_RESPONSE_MISSING_TASK_ID",
        message: "LastMile task provider response did not include a task id",
        retryable: false,
        detail: redactSecrets(value),
      },
    };
  }
  return { ok: true, value: snapshot };
}

function toTaskSnapshot(
  value: unknown,
  fallback: { title?: string; needsTriage?: boolean },
): LastMileTaskSnapshot {
  const record = objectRecord(value);
  const assignee = normalizeAssigneeOutput(record.assignee);
  const normalizedStatus = normalizeExternalTaskStatus(
    record.status ?? record.state ?? record.taskStatus,
  );
  const blocked =
    typeof record.blocked === "boolean"
      ? record.blocked
      : normalizedStatus.blocked;
  return {
    externalTaskId:
      stringValue(record.externalTaskId) ??
      stringValue(record.taskId) ??
      stringValue(record.id) ??
      "",
    externalTaskUrl:
      stringValue(record.externalTaskUrl) ??
      stringValue(record.url) ??
      stringValue(record.webUrl),
    title: stringValue(record.title) ?? fallback.title ?? null,
    status: normalizedStatus.status,
    blocked,
    syncStatus: normalizedStatus.syncStatus,
    assignee,
    dueAt: stringValue(record.dueAt) ?? stringValue(record.dueDate),
    idempotent: Boolean(
      record.idempotent ??
        record.duplicate ??
        record.existing ??
        record.alreadyExists,
    ),
    needsTriage: Boolean(
      fallback.needsTriage || record.needsTriage || !assignee,
    ),
    raw: value,
  };
}

function normalizeAssigneeInput(
  input: LastMileTaskAssigneeInput | null | undefined,
) {
  if (!input) return null;
  return {
    roleKey: input.roleKey ?? null,
    externalId: input.externalId ?? null,
    displayName: input.displayName ?? null,
  };
}

function normalizeAssigneeOutput(value: unknown) {
  const record = objectRecord(value);
  const externalId =
    stringValue(record.externalId) ??
    stringValue(record.id) ??
    stringValue(record.userId);
  const displayName =
    stringValue(record.displayName) ??
    stringValue(record.name) ??
    stringValue(record.email);
  if (!externalId && !displayName) return null;
  return { externalId, displayName };
}

function extractPayload(response: LastMileMcpToolResponse): unknown {
  if (response.structuredContent !== undefined) {
    const structured = objectRecord(response.structuredContent);
    return structured.task ?? structured.result ?? structured;
  }
  if (Array.isArray(response.content)) {
    const text = response.content
      .map((item) => stringValue(objectRecord(item).text) ?? "")
      .join("\n")
      .trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }
  return response.content ?? {};
}

function toProviderError(
  value: unknown,
  fallbackCode: string,
): LastMileProviderError {
  const record = objectRecord(value);
  const status = numberValue(record.status) ?? numberValue(record.statusCode);
  const code =
    stringValue(record.code) ??
    stringValue(record.errorCode) ??
    (status === 403 ? "PERMISSION_DENIED" : fallbackCode);
  return {
    code,
    message:
      stringValue(record.message) ??
      stringValue(record.error) ??
      (value instanceof Error
        ? value.message
        : "LastMile task provider failed"),
    retryable:
      typeof record.retryable === "boolean"
        ? record.retryable
        : status === undefined || status >= 500,
    ...(status !== undefined ? { status } : {}),
    detail: redactSecrets(value),
  };
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (!value || typeof value !== "object") {
    return value instanceof Error
      ? { name: value.name, message: value.message }
      : value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|password|authorization|api[-_]?key/i.test(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = redactSecrets(child);
    }
  }
  return output;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
