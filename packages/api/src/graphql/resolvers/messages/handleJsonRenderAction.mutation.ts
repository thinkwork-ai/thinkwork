import { GraphQLError } from "graphql";
import {
  normalizeThreadJsonRenderActionParams,
  stableStringify,
  validateThreadJsonRenderPersistedPart,
  type ThreadJsonRenderDurableActionDescriptor,
  type ThreadJsonRenderPart,
  type ThreadJsonRenderPrimitive,
} from "../../../lib/thread-json-render/persisted-parts.js";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  gt,
  messages,
  sql,
  threads,
  workItemEvents,
  messageToCamel,
} from "../../utils.js";
import { TaskStatusToolError } from "../../../lib/task-status-tool.js";
import { setWorkItemStatus } from "../../../lib/work-items/work-item-status-tool.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "../threads/access.js";
import { sendMessage } from "./sendMessage.mutation.js";

const ACTION_RATE_LIMIT_WINDOW_MS = 60_000;
const ACTION_RATE_LIMIT_MAX = 12;

export const handleJsonRenderAction = async (
  _parent: unknown,
  args: { input?: HandleJsonRenderActionInput },
  ctx: GraphQLContext,
) => {
  const input = parseInput(args.input);
  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const source = await loadValidatedSourcePart({
    tenantId: caller.tenantId,
    userId: caller.userId,
    input,
  });
  const action = source.part.data.durableActions?.find(
    (candidate) => candidate.id === input.actionId,
  );
  if (!action) {
    throw new GraphQLError("Generated UI action is not available", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (action.disabled) {
    throw new GraphQLError("Generated UI action is disabled", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const actionParams = normalizeParams(action.params);
  const submittedParams = input.params ?? actionParams;
  if (stableStringify(submittedParams) !== stableStringify(actionParams)) {
    throw new GraphQLError("Generated UI action params do not match the spec", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const workItemAction = parseWorkItemStatusAction(actionParams);

  const duplicate = await findDuplicateActionMessage({
    tenantId: caller.tenantId,
    threadId: input.threadId,
    idempotencyKey: input.idempotencyKey,
  });
  if (duplicate) return messageToCamel(duplicate);

  const provenance = buildJsonRenderActionProvenance({
    input,
    action,
    workItemAction,
  });
  const priorEvent = await findPriorWorkItemActionEvent({
    tenantId: caller.tenantId,
    workItemId: workItemAction.workItemId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!priorEvent) {
    await assertActionRateLimit({
      tenantId: caller.tenantId,
      threadId: input.threadId,
      userId: caller.userId,
    });
  }
  const mutationResult = priorEvent
    ? mutationMetadataFromPriorEvent(workItemAction, priorEvent)
    : await applyWorkItemStatusAction({
        tenantId: caller.tenantId,
        userId: caller.userId,
        threadId: input.threadId,
        action: workItemAction,
        provenance,
      });

  const metadata = {
    jsonRenderAction: {
      ...provenance,
      params: actionParams,
      schemaVersion: source.part.data.schemaVersion,
      catalogVersion: source.part.data.catalogVersion,
      mutation: mutationResult,
    },
  };

  return sendMessage(
    _parent,
    {
      input: {
        threadId: input.threadId,
        role: "USER",
        content: actionMessageContent(action, source.part),
        agentRequested: false,
        senderType: "user",
        senderId: caller.userId,
        metadata: JSON.stringify(metadata),
      },
    },
    ctx,
  );
};

interface HandleJsonRenderActionInput {
  threadId: string;
  sourceMessageId: string;
  partId: string;
  actionId: string;
  specHash: string;
  idempotencyKey: string;
  params?: Record<string, ThreadJsonRenderPrimitive>;
}

interface WorkItemStatusAction {
  target: "work_item_status";
  workItemId: string;
  statusCategory: string | null;
  statusId: string | null;
  note: string | null;
}

interface JsonRenderActionProvenance {
  source: "json_render_action";
  sourceMessageId: string;
  partId: string;
  actionId: string;
  actionKind: ThreadJsonRenderDurableActionDescriptor["kind"];
  actionLabel: string;
  target: "work_item_status";
  workItemId: string;
  statusCategory: string | null;
  statusId: string | null;
  specHash: string;
  idempotencyKey: string;
}

interface PriorWorkItemActionEvent {
  newStatusId: string | null;
  metadata: unknown;
}

function parseInput(input: HandleJsonRenderActionInput | undefined) {
  if (!input) {
    throw new GraphQLError("Generated UI action input is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const parsed: HandleJsonRenderActionInput = {
    threadId: requiredString(input.threadId, "threadId"),
    sourceMessageId: requiredString(input.sourceMessageId, "sourceMessageId"),
    partId: requiredString(input.partId, "partId"),
    actionId: requiredString(input.actionId, "actionId"),
    specHash: requiredString(input.specHash, "specHash"),
    idempotencyKey: requiredString(input.idempotencyKey, "idempotencyKey"),
    params: normalizeParams(input.params),
  };
  if (parsed.idempotencyKey.length > 160) {
    throw new GraphQLError("Generated UI action idempotency key is too long", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return parsed;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GraphQLError(`Generated UI action ${field} is required`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return value.trim();
}

async function loadValidatedSourcePart(input: {
  tenantId: string;
  userId: string;
  input: HandleJsonRenderActionInput;
}): Promise<{ part: ThreadJsonRenderPart }> {
  const [visibleThread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.id, input.input.threadId),
        eq(threads.tenant_id, input.tenantId),
        callerVisibleThreadPredicate(input.tenantId, input.userId),
      ),
    );
  if (!visibleThread) {
    throw new GraphQLError("Thread does not belong to requester", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const [sourceMessage] = await db
    .select({
      id: messages.id,
      thread_id: messages.thread_id,
      tenant_id: messages.tenant_id,
      role: messages.role,
      parts: messages.parts,
    })
    .from(messages)
    .where(eq(messages.id, input.input.sourceMessageId));
  if (
    !sourceMessage ||
    sourceMessage.tenant_id !== input.tenantId ||
    sourceMessage.thread_id !== input.input.threadId
  ) {
    throw new GraphQLError("Generated UI source message was not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (sourceMessage.role !== "assistant") {
    throw new GraphQLError("Generated UI actions must come from assistant UI", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const rawPart = findSourcePart(sourceMessage.parts, input.input.partId);
  if (!rawPart) {
    throw new GraphQLError("Generated UI source part was not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  const validation = validateThreadJsonRenderPersistedPart(rawPart);
  if (!validation.ok) {
    throw new GraphQLError("Generated UI source part is invalid", {
      extensions: {
        code: "BAD_USER_INPUT",
        diagnostics: validation.diagnostics,
      },
    });
  }
  if (validation.part.data.specHash !== input.input.specHash) {
    throw new GraphQLError("Generated UI action is stale", {
      extensions: { code: "CONFLICT" },
    });
  }

  return { part: validation.part };
}

function findSourcePart(parts: unknown, partId: string): unknown {
  const parsed = parseJson(parts);
  if (!Array.isArray(parsed)) return null;
  return parsed.find(
    (part) =>
      isRecord(part) && part.type === "data-json-render" && part.id === partId,
  );
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeParams(
  value: unknown,
): Record<string, ThreadJsonRenderPrimitive> {
  const parsed = parseJson(value);
  if (parsed == null) return {};
  if (!isRecord(parsed)) {
    throw new GraphQLError("Generated UI action params must be an object", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  for (const param of Object.values(parsed)) {
    if (
      param === null ||
      typeof param === "string" ||
      typeof param === "number" ||
      typeof param === "boolean"
    ) {
      continue;
    }
    throw new GraphQLError("Generated UI action params must be primitive", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return normalizeThreadJsonRenderActionParams(parsed);
}

async function findDuplicateActionMessage(input: {
  tenantId: string;
  threadId: string;
  idempotencyKey: string;
}) {
  const [duplicate] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
        sql`${messages.metadata}->'jsonRenderAction'->>'idempotencyKey' = ${input.idempotencyKey}`,
      ),
    )
    .limit(1);
  return duplicate ?? null;
}

async function findPriorWorkItemActionEvent(input: {
  tenantId: string;
  workItemId: string;
  idempotencyKey: string;
}): Promise<PriorWorkItemActionEvent | null> {
  const [event] = await db
    .select({
      newStatusId: workItemEvents.new_status_id,
      metadata: workItemEvents.metadata,
    })
    .from(workItemEvents)
    .where(
      and(
        eq(workItemEvents.tenant_id, input.tenantId),
        eq(workItemEvents.work_item_id, input.workItemId),
        sql`${workItemEvents.metadata}->'manualMetadata'->'jsonRenderAction'->>'idempotencyKey' = ${input.idempotencyKey}`,
      ),
    )
    .limit(1);
  return event ?? null;
}

function parseWorkItemStatusAction(
  params: Record<string, ThreadJsonRenderPrimitive>,
): WorkItemStatusAction {
  const target = stringParam(params.target);
  if (target !== "work_item_status") {
    throw new GraphQLError(
      "Generated UI action target is not supported for server mutation",
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  const workItemId = stringParam(params.workItemId);
  if (!workItemId) {
    throw new GraphQLError("Generated UI action workItemId is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const statusCategory = stringParam(params.statusCategory);
  const statusId = stringParam(params.statusId);
  if (!statusCategory && !statusId) {
    throw new GraphQLError(
      "Generated UI action statusCategory or statusId is required",
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  return {
    target: "work_item_status",
    workItemId,
    statusCategory,
    statusId,
    note: stringParam(params.note),
  };
}

function buildJsonRenderActionProvenance(input: {
  input: HandleJsonRenderActionInput;
  action: ThreadJsonRenderDurableActionDescriptor;
  workItemAction: WorkItemStatusAction;
}): JsonRenderActionProvenance {
  return {
    source: "json_render_action",
    sourceMessageId: input.input.sourceMessageId,
    partId: input.input.partId,
    actionId: input.action.id,
    actionKind: input.action.kind,
    actionLabel: input.action.label,
    target: input.workItemAction.target,
    workItemId: input.workItemAction.workItemId,
    statusCategory: input.workItemAction.statusCategory,
    statusId: input.workItemAction.statusId,
    specHash: input.input.specHash,
    idempotencyKey: input.input.idempotencyKey,
  };
}

async function applyWorkItemStatusAction(input: {
  tenantId: string;
  userId: string;
  threadId: string;
  action: WorkItemStatusAction;
  provenance: JsonRenderActionProvenance;
}) {
  try {
    const result = await setWorkItemStatus({
      tenantId: input.tenantId,
      workItemId: input.action.workItemId,
      threadId: input.threadId,
      statusCategory: input.action.statusCategory,
      statusId: input.action.statusId,
      note: input.action.note,
      actor: { type: "user", id: input.userId },
      metadata: { jsonRenderAction: input.provenance },
    });
    return {
      target: input.action.target,
      workItemId: result.workItemId,
      statusCategory: result.statusCategory,
      statusId: result.statusId,
      previousStatusCategory: result.previousStatusCategory,
      linkedTaskId: result.linkedTaskId ?? null,
      alreadyApplied: false,
    };
  } catch (err) {
    if (err instanceof GraphQLError) throw err;
    if (err instanceof TaskStatusToolError) {
      throw new GraphQLError(err.message, {
        extensions: { code: err.code, httpStatus: err.statusCode },
      });
    }
    throw err;
  }
}

function mutationMetadataFromPriorEvent(
  action: WorkItemStatusAction,
  event: PriorWorkItemActionEvent,
) {
  const manualMetadata = objectValue(objectValue(event.metadata).manualMetadata);
  const priorAction = objectValue(manualMetadata.jsonRenderAction);
  return {
    target: action.target,
    workItemId: action.workItemId,
    statusCategory:
      stringParam(priorAction.statusCategory) ?? action.statusCategory,
    statusId: event.newStatusId ?? stringParam(priorAction.statusId),
    alreadyApplied: true,
  };
}

async function assertActionRateLimit(input: {
  tenantId: string;
  threadId: string;
  userId: string;
}) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
        eq(messages.sender_id, input.userId),
        gt(
          messages.created_at,
          new Date(Date.now() - ACTION_RATE_LIMIT_WINDOW_MS),
        ),
        sql`${messages.metadata}->'jsonRenderAction'->>'source' = 'json_render_action'`,
      ),
    );
  const count = Number(row?.count ?? 0);
  if (count >= ACTION_RATE_LIMIT_MAX) {
    throw new GraphQLError("Generated UI action rate limit exceeded", {
      extensions: { code: "RATE_LIMITED" },
    });
  }
}

function actionMessageContent(
  action: ThreadJsonRenderDurableActionDescriptor,
  part: ThreadJsonRenderPart,
): string {
  const title = part.data.mobileFallback.title.trim();
  const summary = part.data.mobileFallback.summary.trim();
  const lines = [
    `Generated UI action: ${action.label}`,
    title ? `Source: ${title}` : null,
    summary ? `Summary: ${summary}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringParam(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
