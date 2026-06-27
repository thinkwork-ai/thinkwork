import { getApiAuthSecret, getAppsyncApiKey } from "@thinkwork/runtime-config";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { handleCors, json } from "../lib/response.js";
import { verifyMcpAccessToken } from "./mcp-oauth.js";
import type { GraphQLContext } from "../graphql/context.js";
import { createLoaders } from "../graphql/dataloaders.js";
import {
  and,
  asc,
  db,
  desc,
  eq,
  isNull,
  workItemEvents,
  workItemLabelAssignments,
  workItemLabels,
} from "../graphql/utils.js";
import {
  createWorkItem,
  createWorkItemDocument,
  getWorkItem,
  getWorkItemDocument,
  listWorkItemDocuments,
  listWorkItems,
  updateWorkItem,
  updateWorkItemDocument,
  updateWorkItemStatus,
} from "../lib/work-items/work-item-service.js";
import {
  claimNextOpenEngineWorkItem,
  listEligibleOpenEngineWorkItems,
} from "../lib/work-items/open-engine-queue-service.js";
import {
  recordOpenEngineReceipt,
  type OpenEngineReceiptType,
} from "../lib/work-items/open-engine-receipt-service.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const SERVER_NAME = "thinkwork-open-engine";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2025-06-18";
const REQUIRED_SCOPE = "open_engine:work_items";
const STATUS_LEDGER_DOCUMENT_KIND = "progress";

const TOOLS = [
  {
    name: "open_engine_list_work_items",
    description:
      "List OpenEngine-eligible ThinkWork Work Items. Defaults to oldest eligible assigned Agent Todo ordering.",
    inputSchema: {
      type: "object",
      properties: {
        queueKey: { type: "string" },
        spaceId: { type: "string" },
        statusId: { type: "string" },
        labelSlugs: { type: "array", items: { type: "string" } },
        ownerUserId: { type: "string" },
        ownerAgentId: { type: "string" },
        agentId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        includeAllOpenEngine: {
          type: "boolean",
          description:
            "When true, list OpenEngine Work Items even when they are blocked, held, claimed, or scheduled later.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_claim_next",
    description:
      "Atomically claim exactly one eligible Work Item for an agent and record an AGENT CLAIMED receipt.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        queueKey: { type: "string" },
        spaceId: { type: "string" },
        statusId: { type: "string" },
        labelSlugs: { type: "array", items: { type: "string" } },
        leaseSeconds: { type: "integer", minimum: 1, maximum: 86400 },
        message: { type: "string" },
      },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_get_work_item",
    description:
      "Fetch one Work Item detail with labels, document pointers, and recent receipts.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: "string" },
      },
      required: ["workItemId"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_get_context",
    description:
      "Fetch a compact agent context packet for a Work Item: summary, queue state, labels, document index, recent receipts, and thread pointers.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: "string" },
        receiptLimit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["workItemId"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_create_work_item",
    description: "Create a ThinkWork Work Item for OpenEngine queue use.",
    inputSchema: {
      type: "object",
      properties: {
        spaceId: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
        },
        ownerUserId: { type: "string" },
        ownerAgentId: { type: "string" },
        statusId: { type: "string" },
        labelSlugs: { type: "array", items: { type: "string" } },
        openEngineEnabled: { type: "boolean" },
        queueKey: { type: "string" },
        openEngineScheduledAt: { type: "string" },
        openEngineDependencyState: {
          type: "string",
          enum: ["ready", "waiting"],
        },
        openEngineRouting: { type: "object" },
        metadata: { type: "object" },
      },
      required: ["spaceId", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_update_work_item",
    description:
      "Update Work Item title, notes, owner, labels, metadata, or archive state.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
        },
        ownerUserId: { type: "string" },
        ownerAgentId: { type: "string" },
        labelSlugs: { type: "array", items: { type: "string" } },
        openEngineEnabled: { type: "boolean" },
        queueKey: { type: "string" },
        openEngineScheduledAt: { type: "string" },
        openEngineDependencyState: {
          type: "string",
          enum: ["ready", "waiting"],
        },
        openEngineRouting: { type: "object" },
        metadata: { type: "object" },
        archived: { type: "boolean" },
      },
      required: ["workItemId"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_list_documents",
    description:
      "List Work Item documents without loading all content. Use fetch only for the document needed.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: "string" },
        kind: {
          type: "string",
          enum: [
            "plan",
            "progress",
            "spec",
            "evidence",
            "handoff",
            "note",
            "other",
          ],
        },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        includeArchived: { type: "boolean" },
      },
      required: ["workItemId"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_fetch_document",
    description:
      "Fetch a single text/markdown/json Work Item document. Binary documents return metadata with content null.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
      },
      required: ["documentId"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_create_document",
    description:
      "Create a Work Item plan, progress, spec, evidence, handoff, note, or other document.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: "string" },
        title: { type: "string" },
        ...documentWriteProperties(),
      },
      required: ["workItemId", "title", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_update_document",
    description: "Update Work Item document metadata/content or archive it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        ...documentWriteProperties(),
        archived: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_record_receipt",
    description:
      "Write a durable OpenEngine receipt such as AGENT CLAIMED, AGENT DONE, AGENT BLOCKED, AGENT HUMAN HOLD, AGENT STATUS, or AGENT FOLLOW-UP.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: "string" },
        agentId: { type: "string" },
        receiptType: { type: "string" },
        threadId: { type: "string" },
        message: { type: "string" },
        evidence: { type: "object" },
        metadata: { type: "object" },
      },
      required: ["workItemId", "agentId", "receiptType"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_update_state",
    description:
      "Convenience state transition for blocked, human_hold, resumed, review, done, and failed Work Item states.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: "string" },
        agentId: { type: "string" },
        state: {
          type: "string",
          enum: [
            "blocked",
            "human_hold",
            "resumed",
            "review",
            "done",
            "failed",
          ],
        },
        message: { type: "string" },
        evidence: { type: "object" },
        statusId: { type: "string" },
        statusCategory: {
          type: "string",
          enum: ["todo", "active", "blocked", "done", "skipped"],
        },
      },
      required: ["workItemId", "agentId", "state"],
      additionalProperties: false,
    },
  },
  {
    name: "open_engine_update_status_ledger",
    description:
      "Create or update the agent's durable status ledger entry for a Work Item without creating heartbeat clutter.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: "string" },
        agentId: { type: "string" },
        status: {
          type: "string",
          enum: [
            "checking",
            "none",
            "completed",
            "blocked",
            "holding",
            "resumed",
            "failed",
          ],
        },
        message: { type: "string" },
        queueResult: { type: "object" },
      },
      required: ["workItemId", "agentId", "status"],
      additionalProperties: false,
    },
  },
] as const;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  const metadataUrl = `${issuerUrl(event)}/.well-known/oauth-protected-resource/mcp/open-engine`;
  const bearer = bearerToken(event);
  if (!bearer) return unauthorized(metadataUrl);

  let claims: Record<string, unknown>;
  if (isServiceBearer(bearer)) {
    claims = {
      "tw:auth_kind": "service",
      scope: REQUIRED_SCOPE,
      "custom:tenant_id": event.headers["x-tenant-id"],
      "custom:user_id":
        event.headers["x-user-id"] || event.headers["x-principal-id"],
      "custom:agent_id": event.headers["x-agent-id"],
    };
  } else {
    try {
      claims = await verifyMcpAccessToken(
        bearer,
        resourceUrl(event),
        issuerUrl(event),
      );
      claims["tw:auth_kind"] = "oauth";
    } catch (err) {
      const auth = await tryFirstPartyAuth(event);
      if (!auth) {
        console.warn("[mcp-open-engine] bearer verification failed", {
          reason: err instanceof Error ? err.message : String(err),
        });
        return unauthorized(metadataUrl);
      }
      claims = {
        "tw:auth_kind": "first-party",
        scope: REQUIRED_SCOPE,
        sub: auth.principalId,
        email: auth.email,
        tenant_id: auth.tenantId,
        "custom:agent_id": auth.agentId,
      };
    }
  }

  if (event.requestContext.http.method === "GET") {
    return json({
      status: "ok",
      server: SERVER_NAME,
      version: SERVER_VERSION,
      tools: TOOLS.length,
    });
  }
  if (event.requestContext.http.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const request = parseJsonRpc(event);
  if (!request) {
    return json(
      {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      },
      400,
    );
  }
  if (!("id" in request)) {
    return {
      statusCode: 202,
      headers: { "Content-Type": "application/json" },
      body: "",
    };
  }

  switch (request.method) {
    case "initialize":
      return jsonRpcResult(request.id, {
        protocolVersion: request.params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    case "notifications/initialized":
      return {
        statusCode: 202,
        headers: { "Content-Type": "application/json" },
        body: "",
      };
    case "tools/list":
      return jsonRpcResult(request.id, { tools: TOOLS });
    case "tools/call":
      return handleToolCall(request, claims);
    default:
      return jsonRpcError(
        request.id,
        -32601,
        `Method not found: ${request.method}`,
      );
  }
}

async function handleToolCall(
  request: JsonRpcRequest,
  claims: Record<string, unknown>,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (!hasScope(claims, REQUIRED_SCOPE)) {
    return jsonRpcError(
      request.id,
      -32001,
      `${REQUIRED_SCOPE} scope is required`,
    );
  }
  const params = request.params as ToolCallParams | undefined;
  const toolName = typeof params?.name === "string" ? params.name : "";
  const args = isRecord(params?.arguments) ? params.arguments : {};
  if (!toolName)
    return jsonRpcError(request.id, -32602, "Tool name is required");

  const caller = await resolveCaller(claims);
  if (!caller) {
    return jsonRpcError(
      request.id,
      -32002,
      "Could not resolve authenticated ThinkWork caller",
    );
  }
  const ctx = graphQlContextForMcpCaller(caller, claims);

  try {
    switch (toolName) {
      case "open_engine_list_work_items":
        return jsonRpcToolResult(
          request.id,
          await listOpenEngineTool(ctx, caller, args),
        );
      case "open_engine_claim_next":
        return jsonRpcToolResult(
          request.id,
          await claimNextTool(ctx, caller, args),
        );
      case "open_engine_get_work_item":
        return jsonRpcToolResult(
          request.id,
          await getWorkItemContext(ctx, caller, args),
        );
      case "open_engine_get_context":
        return jsonRpcToolResult(
          request.id,
          await getWorkItemContext(ctx, caller, args),
        );
      case "open_engine_create_work_item":
        return jsonRpcToolResult(
          request.id,
          await createWorkItemTool(ctx, caller, args),
        );
      case "open_engine_update_work_item":
        return jsonRpcToolResult(
          request.id,
          await updateWorkItemTool(ctx, caller, args),
        );
      case "open_engine_list_documents":
        return jsonRpcToolResult(
          request.id,
          await listDocumentsTool(ctx, caller, args),
        );
      case "open_engine_fetch_document":
        return jsonRpcToolResult(
          request.id,
          await fetchDocumentTool(ctx, caller, args),
        );
      case "open_engine_create_document":
        return jsonRpcToolResult(
          request.id,
          await createDocumentTool(ctx, caller, args),
        );
      case "open_engine_update_document":
        return jsonRpcToolResult(
          request.id,
          await updateDocumentTool(ctx, caller, args),
        );
      case "open_engine_record_receipt":
        return jsonRpcToolResult(
          request.id,
          await recordReceiptTool(caller, args),
        );
      case "open_engine_update_state":
        return jsonRpcToolResult(
          request.id,
          await updateStateTool(ctx, caller, args),
        );
      case "open_engine_update_status_ledger":
        return jsonRpcToolResult(
          request.id,
          await updateStatusLedgerTool(ctx, caller, args),
        );
      default:
        return jsonRpcError(request.id, -32601, `Unknown tool: ${toolName}`);
    }
  } catch (err) {
    return jsonRpcError(
      request.id,
      errorCode(err),
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function listOpenEngineTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  if (booleanArg(args.includeAllOpenEngine) === true) {
    const rows = await listWorkItems(ctx, {
      tenantId: caller.tenantId,
      spaceId: stringArg(args.spaceId),
      statusId: stringArg(args.statusId),
      ownerUserId: stringArg(args.ownerUserId),
      ownerAgentId: stringArg(args.ownerAgentId) ?? stringArg(args.agentId),
      labelSlugs: stringArrayArg(args.labelSlugs),
      metadata: undefined,
      limit: limitArg(args.limit),
    });
    return {
      ok: true,
      workItems: rows
        .filter((row: any) => row.open_engine_enabled === true)
        .map(formatWorkItemSummary),
    };
  }
  const rows = await listEligibleOpenEngineWorkItems({
    tenantId: caller.tenantId,
    queueKey: nullableStringArg(args.queueKey),
    spaceId: stringArg(args.spaceId),
    statusId: stringArg(args.statusId),
    labelSlugs: stringArrayArg(args.labelSlugs),
    ownerUserId: stringArg(args.ownerUserId),
    ownerAgentId: stringArg(args.ownerAgentId),
    agentId: stringArg(args.agentId),
    limit: limitArg(args.limit),
  });
  return { ok: true, workItems: rows.map(formatWorkItemSummary) };
}

async function claimNextTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const agentId = requiredStringArg(args.agentId, "agentId");
  const claimed = await claimNextOpenEngineWorkItem({
    tenantId: caller.tenantId,
    queueKey: nullableStringArg(args.queueKey),
    spaceId: stringArg(args.spaceId),
    statusId: stringArg(args.statusId),
    labelSlugs: stringArrayArg(args.labelSlugs),
    agentId,
    leaseSeconds: numberArg(args.leaseSeconds),
  });
  if (!claimed) {
    return {
      ok: true,
      claimed: null,
      reason: "no_eligible_work_item",
    };
  }
  const event = await recordOpenEngineReceipt({
    tenantId: caller.tenantId,
    workItemId: claimed.id,
    agentId,
    receiptType: "claimed",
    message: stringArg(args.message) ?? "AGENT CLAIMED",
    metadata: { sourceTool: "open_engine_claim_next" },
  });
  return {
    ok: true,
    claimed: formatWorkItemSummary(claimed),
    receipt: formatEvent(event),
    context: await buildContextPacket(ctx, caller, claimed.id, DEFAULT_LIMIT),
  };
}

async function getWorkItemContext(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  return buildContextPacket(
    ctx,
    caller,
    requiredStringArg(args.workItemId, "workItemId"),
    limitArg(args.receiptLimit),
  );
}

async function createWorkItemTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const created = await createWorkItem(ctx, {
    tenantId: caller.tenantId,
    spaceId: requiredStringArg(args.spaceId, "spaceId"),
    title: requiredStringArg(args.title, "title"),
    notes: stringArg(args.notes),
    priority: stringArg(args.priority),
    statusId: stringArg(args.statusId),
    ownerUserId: stringArg(args.ownerUserId),
    ownerAgentId: stringArg(args.ownerAgentId),
    labelSlugs: stringArrayArg(args.labelSlugs),
    openEngineEnabled: optionalBooleanArg(args.openEngineEnabled) ?? true,
    openEngineQueueKey: stringArg(args.queueKey),
    openEngineScheduledAt: optionalArg(args.openEngineScheduledAt),
    openEngineDependencyState:
      stringArg(args.openEngineDependencyState) ?? "ready",
    openEngineRouting: optionalRecordArg(args.openEngineRouting),
    metadata: isRecord(args.metadata) ? args.metadata : { openEngine: true },
  });
  return { ok: true, workItem: formatWorkItemSummary(created) };
}

async function updateWorkItemTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const updated = await updateWorkItem(ctx, {
    tenantId: caller.tenantId,
    workItemId: requiredStringArg(args.workItemId, "workItemId"),
    title: optionalArg(args.title),
    notes: optionalArg(args.notes),
    priority: optionalArg(args.priority),
    ownerUserId: optionalArg(args.ownerUserId),
    ownerAgentId: optionalArg(args.ownerAgentId),
    labelSlugs: Array.isArray(args.labelSlugs)
      ? stringArrayArg(args.labelSlugs)
      : undefined,
    openEngineEnabled: optionalBooleanArg(args.openEngineEnabled),
    openEngineQueueKey: optionalArg(args.queueKey),
    openEngineScheduledAt: optionalArg(args.openEngineScheduledAt),
    openEngineDependencyState: optionalArg(args.openEngineDependencyState),
    openEngineRouting: optionalRecordArg(args.openEngineRouting),
    metadata: optionalRecordArg(args.metadata),
    archived: optionalBooleanArg(args.archived),
  });
  return { ok: true, workItem: formatWorkItemSummary(updated) };
}

async function listDocumentsTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const documents = await listWorkItemDocuments(ctx, {
    tenantId: caller.tenantId,
    workItemId: requiredStringArg(args.workItemId, "workItemId"),
    kind: stringArg(args.kind),
    limit: limitArg(args.limit),
    includeArchived: booleanArg(args.includeArchived) === true,
  });
  return {
    ok: true,
    documents: documents.map(formatDocumentPointer),
  };
}

async function fetchDocumentTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const document = await getWorkItemDocument(ctx, {
    tenantId: caller.tenantId,
    id: requiredStringArg(args.documentId, "documentId"),
  });
  if (!document) return { ok: false, error: "document_not_found" };
  return { ok: true, document: formatDocument(document) };
}

async function createDocumentTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const created = await createWorkItemDocument(ctx, {
    tenantId: caller.tenantId,
    workItemId: requiredStringArg(args.workItemId, "workItemId"),
    title: requiredStringArg(args.title, "title"),
    kind: stringArg(args.kind),
    content: optionalArg(args.content),
    contentBase64: optionalArg(args.contentBase64),
    contentType: stringArg(args.contentType),
    filename: stringArg(args.filename),
    metadata: optionalRecordArg(args.metadata),
  });
  return { ok: true, document: formatDocument(created) };
}

async function updateDocumentTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const updated = await updateWorkItemDocument(ctx, {
    tenantId: caller.tenantId,
    id: requiredStringArg(args.id, "id"),
    title: optionalArg(args.title),
    kind: optionalArg(args.kind),
    content: optionalArg(args.content),
    contentBase64: optionalArg(args.contentBase64),
    contentType: optionalArg(args.contentType),
    filename: optionalArg(args.filename),
    metadata: optionalRecordArg(args.metadata),
    archived: optionalBooleanArg(args.archived),
  });
  return { ok: true, document: formatDocument(updated) };
}

async function recordReceiptTool(
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const event = await recordOpenEngineReceipt({
    tenantId: caller.tenantId,
    workItemId: requiredStringArg(args.workItemId, "workItemId"),
    agentId: requiredStringArg(args.agentId, "agentId"),
    receiptType: requiredStringArg(args.receiptType, "receiptType"),
    threadId: stringArg(args.threadId),
    message: stringArg(args.message),
    evidence: optionalRecordArg(args.evidence) ?? null,
    metadata: optionalRecordArg(args.metadata) ?? null,
  });
  return { ok: true, receipt: formatEvent(event) };
}

async function updateStateTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const state = requiredStringArg(args.state, "state");
  const receiptType = receiptTypeForState(state);
  const receipt = await recordOpenEngineReceipt({
    tenantId: caller.tenantId,
    workItemId: requiredStringArg(args.workItemId, "workItemId"),
    agentId: requiredStringArg(args.agentId, "agentId"),
    receiptType,
    message: stringArg(args.message),
    evidence: optionalRecordArg(args.evidence) ?? null,
    metadata: { sourceTool: "open_engine_update_state", state },
  });
  const statusId = stringArg(args.statusId);
  const statusCategory = stringArg(args.statusCategory);
  const updated =
    statusId || statusCategory
      ? await updateWorkItemStatus(ctx, {
          tenantId: caller.tenantId,
          workItemId: requiredStringArg(args.workItemId, "workItemId"),
          statusId,
          statusCategory,
          note: stringArg(args.message),
          metadata: { sourceTool: "open_engine_update_state", state },
        })
      : await getWorkItem(ctx, {
          tenantId: caller.tenantId,
          id: requiredStringArg(args.workItemId, "workItemId"),
        });
  return {
    ok: true,
    state,
    receipt: formatEvent(receipt),
    workItem: updated ? formatWorkItemSummary(updated) : null,
  };
}

async function updateStatusLedgerTool(
  ctx: GraphQLContext,
  caller: McpCaller,
  args: Record<string, unknown>,
) {
  const workItemId = requiredStringArg(args.workItemId, "workItemId");
  const agentId = requiredStringArg(args.agentId, "agentId");
  const status = requiredStringArg(args.status, "status");
  const content = JSON.stringify(
    {
      agentId,
      status,
      message: stringArg(args.message),
      queueResult: optionalRecordArg(args.queueResult) ?? null,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
  const existing = await findStatusLedgerDocument(
    ctx,
    caller.tenantId,
    workItemId,
    agentId,
  );
  const metadata = {
    openEngineStatusLedger: true,
    agentId,
  };
  const document = existing
    ? await updateWorkItemDocument(ctx, {
        tenantId: caller.tenantId,
        id: existing.id,
        title: `OpenEngine status ledger: ${agentId}`,
        kind: STATUS_LEDGER_DOCUMENT_KIND,
        content,
        contentType: "application/json",
        metadata,
      })
    : await createWorkItemDocument(ctx, {
        tenantId: caller.tenantId,
        workItemId,
        title: `OpenEngine status ledger: ${agentId}`,
        kind: STATUS_LEDGER_DOCUMENT_KIND,
        content,
        contentType: "application/json",
        metadata,
      });
  await recordOpenEngineReceipt({
    tenantId: caller.tenantId,
    workItemId,
    agentId,
    receiptType: "status",
    message: stringArg(args.message) ?? `AGENT STATUS ${status}`,
    metadata: { status, ledgerDocumentId: document.id },
  });
  return {
    ok: true,
    status,
    document: formatDocument(document),
  };
}

async function buildContextPacket(
  ctx: GraphQLContext,
  caller: McpCaller,
  workItemId: string,
  receiptLimit: number | undefined,
) {
  const workItem = await getWorkItem(ctx, {
    tenantId: caller.tenantId,
    id: workItemId,
  });
  if (!workItem) return { ok: false, error: "work_item_not_found" };
  const [labels, documents, receipts] = await Promise.all([
    loadLabels(caller.tenantId, workItemId),
    listWorkItemDocuments(ctx, {
      tenantId: caller.tenantId,
      workItemId,
      includeContent: false,
      limit: MAX_LIMIT,
    }),
    loadReceipts(caller.tenantId, workItemId, receiptLimit ?? DEFAULT_LIMIT),
  ]);
  return {
    ok: true,
    workItem: formatWorkItemSummary(workItem),
    queue: {
      enabled: Boolean((workItem as any).open_engine_enabled),
      queueKey: (workItem as any).open_engine_queue_key ?? null,
      claimedByAgentId:
        (workItem as any).open_engine_claimed_by_agent_id ?? null,
      claimedAt: iso((workItem as any).open_engine_claimed_at),
      claimExpiresAt: iso((workItem as any).open_engine_claim_expires_at),
      humanHold: Boolean((workItem as any).open_engine_human_hold),
      humanHoldReason: (workItem as any).open_engine_human_hold_reason ?? null,
      dependencyState: (workItem as any).open_engine_dependency_state ?? null,
      scheduledAt: iso((workItem as any).open_engine_scheduled_at),
      routing: (workItem as any).open_engine_routing ?? null,
    },
    labels,
    documents: documents.map(formatDocumentPointer),
    receipts: receipts.map(formatEvent),
    progressiveFetch: {
      listDocumentsTool: "open_engine_list_documents",
      fetchDocumentTool: "open_engine_fetch_document",
    },
  };
}

async function loadLabels(tenantId: string, workItemId: string) {
  const rows = await db
    .select({
      id: workItemLabels.id,
      name: workItemLabels.name,
      slug: workItemLabels.slug,
      color: workItemLabels.color,
    })
    .from(workItemLabelAssignments)
    .innerJoin(
      workItemLabels,
      and(
        eq(workItemLabels.tenant_id, workItemLabelAssignments.tenant_id),
        eq(workItemLabels.id, workItemLabelAssignments.label_id),
      ),
    )
    .where(
      and(
        eq(workItemLabelAssignments.tenant_id, tenantId),
        eq(workItemLabelAssignments.work_item_id, workItemId),
        isNull(workItemLabels.archived_at),
      ),
    )
    .orderBy(asc(workItemLabels.name));
  return rows;
}

async function loadReceipts(
  tenantId: string,
  workItemId: string,
  limit: number,
) {
  return db
    .select()
    .from(workItemEvents)
    .where(
      and(
        eq(workItemEvents.tenant_id, tenantId),
        eq(workItemEvents.work_item_id, workItemId),
        eq(workItemEvents.event_type, "agent_action"),
      ),
    )
    .orderBy(desc(workItemEvents.created_at))
    .limit(Math.min(Math.max(limit, 1), MAX_LIMIT));
}

async function findStatusLedgerDocument(
  ctx: GraphQLContext,
  tenantId: string,
  workItemId: string,
  agentId: string,
) {
  const docs = await listWorkItemDocuments(ctx, {
    tenantId,
    workItemId,
    kind: STATUS_LEDGER_DOCUMENT_KIND,
    includeArchived: false,
    limit: MAX_LIMIT,
  });
  return docs.find((doc: any) => {
    const metadata = doc.metadata;
    return (
      metadata &&
      typeof metadata === "object" &&
      (metadata as Record<string, unknown>).openEngineStatusLedger === true &&
      (metadata as Record<string, unknown>).agentId === agentId
    );
  }) as any;
}

function graphQlContextForMcpCaller(
  caller: McpCaller,
  claims: Record<string, unknown>,
): GraphQLContext {
  const authKind = stringClaim(claims["tw:auth_kind"]);
  const auth =
    authKind === "oauth" && caller.userId
      ? {
          authType: "cognito" as const,
          principalId: caller.userId,
          tenantId: caller.tenantId,
          email: stringClaim(claims.email) ?? null,
          emailVerified:
            claims.email_verified === true ||
            stringClaim(claims.email_verified) === "true",
          agentId: null,
        }
      : {
          authType: "service" as const,
          principalId: null,
          tenantId: caller.tenantId,
          email: null,
          emailVerified: false,
          agentId: null,
        };
  return { auth, db, loaders: createLoaders(), headers: {} };
}

async function resolveCaller(
  claims: Record<string, unknown>,
): Promise<McpCaller | null> {
  const claimedUserId =
    stringClaim(claims.user_id) ?? stringClaim(claims["custom:user_id"]);
  const claimedTenantId =
    stringClaim(claims.tenant_id) ?? stringClaim(claims["custom:tenant_id"]);
  const agentId = stringClaim(claims["custom:agent_id"]) ?? null;
  if (claimedTenantId) {
    return {
      tenantId: claimedTenantId,
      userId: claimedUserId ?? null,
      agentId,
    };
  }

  const sub = stringClaim(claims.sub);
  if (!sub) return null;
  const { resolveCallerFromAuth } = await import(
    "../graphql/resolvers/core/resolve-auth-user.js"
  );
  const resolved = await resolveCallerFromAuth({
    authType: "cognito",
    principalId: sub,
    email: stringClaim(claims.email) ?? null,
    emailVerified:
      claims.email_verified === true ||
      stringClaim(claims.email_verified) === "true",
    tenantId: null,
    agentId: null,
  });
  if (!resolved.tenantId) return null;
  return { tenantId: resolved.tenantId, userId: resolved.userId, agentId };
}

function formatWorkItemSummary(row: Record<string, any>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    statusId: row.status_id ?? null,
    title: row.title,
    notes: row.notes ?? null,
    priority: row.priority,
    ownerUserId: row.owner_user_id ?? null,
    ownerAgentId: row.owner_agent_id ?? null,
    dueAt: iso(row.due_at),
    blocked: Boolean(row.blocked),
    applicable: Boolean(row.applicable),
    completedAt: iso(row.completed_at),
    openEngine: {
      enabled: Boolean(row.open_engine_enabled),
      queueKey: row.open_engine_queue_key ?? null,
      claimedByAgentId: row.open_engine_claimed_by_agent_id ?? null,
      claimedAt: iso(row.open_engine_claimed_at),
      claimExpiresAt: iso(row.open_engine_claim_expires_at),
      humanHold: Boolean(row.open_engine_human_hold),
      humanHoldReason: row.open_engine_human_hold_reason ?? null,
      dependencyState: row.open_engine_dependency_state ?? null,
      scheduledAt: iso(row.open_engine_scheduled_at),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function formatDocumentPointer(row: Record<string, any>) {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    kind: row.kind,
    title: row.title,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    checksumSha256: row.checksum_sha256 ?? null,
    metadata: row.metadata ?? null,
    previewAvailable: isPreviewableContentType(row.content_type),
    binary: !isPreviewableContentType(row.content_type),
    archivedAt: iso(row.archived_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function formatDocument(row: Record<string, any>) {
  return {
    ...formatDocumentPointer(row),
    content: row.content ?? null,
    downloadAvailable:
      row.content == null && !isPreviewableContentType(row.content_type),
  };
}

function formatEvent(row: Record<string, any>) {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    threadId: row.thread_id ?? null,
    actorAgentId: row.actor_agent_id ?? null,
    eventType: row.event_type,
    message: row.message ?? null,
    metadata: row.metadata ?? null,
    createdAt: iso(row.created_at),
  };
}

function receiptTypeForState(state: string): OpenEngineReceiptType {
  switch (state) {
    case "blocked":
      return "blocked";
    case "human_hold":
      return "human_hold";
    case "resumed":
      return "resumed";
    case "review":
      return "applied";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "status";
  }
}

function documentWriteProperties() {
  return {
    kind: {
      type: "string",
      enum: [
        "plan",
        "progress",
        "spec",
        "evidence",
        "handoff",
        "note",
        "other",
      ],
    },
    content: { type: "string" },
    contentBase64: { type: "string" },
    contentType: { type: "string" },
    filename: { type: "string" },
    metadata: { type: "object" },
  };
}

function jsonRpcToolResult(
  id: JsonRpcRequest["id"],
  structuredContent: unknown,
) {
  return jsonRpcResult(id, {
    content: [
      { type: "text", text: JSON.stringify(structuredContent, null, 2) },
    ],
    structuredContent,
  });
}

function jsonRpcResult(
  id: JsonRpcRequest["id"],
  result: Record<string, unknown>,
) {
  return json({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

function parseJsonRpc(event: APIGatewayProxyEventV2): JsonRpcRequest | null {
  if (!event.body) return null;
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const parsed = JSON.parse(body) as JsonRpcRequest;
    if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string")
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function unauthorized(
  resourceMetadataUrl: string,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
    },
    body: JSON.stringify({ error: "unauthorized" }),
  };
}

function errorCode(err: unknown) {
  const code = (err as { extensions?: { code?: unknown } } | undefined)
    ?.extensions?.code;
  if (code === "FORBIDDEN" || code === "UNAUTHENTICATED") return -32003;
  if (code === "NOT_FOUND") return -32004;
  if (code === "BAD_USER_INPUT") return -32602;
  return -32000;
}

function bearerToken(event: APIGatewayProxyEventV2): string | null {
  const header = event.headers.authorization || event.headers.Authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function isServiceBearer(bearer: string): boolean {
  return [getApiAuthSecret(), process.env.GRAPHQL_API_KEY, getAppsyncApiKey()]
    .filter(Boolean)
    .some((secret) => secret === bearer);
}

async function tryFirstPartyAuth(event: APIGatewayProxyEventV2) {
  const { authenticate } = await import("../lib/cognito-auth.js");
  return authenticate(event.headers);
}

function resourceUrl(event: APIGatewayProxyEventV2): string {
  return `${issuerUrl(event)}/mcp/open-engine`;
}

function issuerUrl(event: APIGatewayProxyEventV2): string {
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host || event.requestContext.domainName;
  return `${proto}://${host}`;
}

function hasScope(claims: Record<string, unknown>, scope: string): boolean {
  return stringClaim(claims.scope)?.split(/\s+/).includes(scope) ?? false;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredStringArg(value: unknown, field: string): string {
  const result = stringArg(value);
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function stringArg(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableStringArg(value: unknown): string | null | undefined {
  return value === null ? null : (stringArg(value) ?? undefined);
}

function stringArrayArg(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.map(stringArg).filter((item): item is string => Boolean(item)),
    ),
  ];
}

function numberArg(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function limitArg(value: unknown): number {
  const numeric = numberArg(value) ?? DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(numeric), 1), MAX_LIMIT);
}

function booleanArg(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalBooleanArg(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalRecordArg(
  value: unknown,
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function optionalArg(value: unknown): unknown {
  return value === undefined ? undefined : value;
}

function isPreviewableContentType(contentType: unknown) {
  const normalized = String(contentType ?? "").toLowerCase();
  return normalized.startsWith("text/") || normalized === "application/json";
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolCallParams = {
  name?: unknown;
  arguments?: unknown;
};

type McpCaller = {
  tenantId: string;
  userId: string | null;
  agentId: string | null;
};
