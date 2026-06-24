import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { authenticate } from "../lib/cognito-auth.js";
import { validateApiSecret } from "../lib/auth.js";
import { handleCors, json, error, unauthorized } from "../lib/response.js";
import {
  setTaskStatus,
  TaskStatusToolError,
  type TaskStatusToolActor,
} from "../lib/task-status-tool.js";
import { setWorkItemStatus } from "../lib/work-items/work-item-status-tool.js";

const { users } = schema;

interface TaskStatusToolBody {
  tenantId?: string;
  threadId?: string;
  agentId?: string | null;
  threadTurnId?: string;
  toolCallId?: string;
  linkedTaskId?: string;
  workItemId?: string;
  statusId?: string | null;
  statusCategory?: string | null;
  status?: string;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface ResolvedTaskStatusAuth {
  tenantId: string;
  threadId: string;
  agentId?: string | null;
  actor: TaskStatusToolActor;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  let body: TaskStatusToolBody;
  try {
    body = JSON.parse(event.body ?? "{}") as TaskStatusToolBody;
  } catch {
    return error("Invalid JSON body", 400);
  }

  const workItemStatusRequest = isWorkItemStatusPath(event);
  const linkedTaskId = stringValue(body.linkedTaskId);
  const workItemId = stringValue(body.workItemId);
  const status = stringValue(body.status);
  const statusCategory = stringValue(body.statusCategory) || status;
  const statusId = stringValue(body.statusId);
  if (workItemStatusRequest) {
    if (!workItemId) return error("workItemId is required", 400);
    if (!statusCategory && !statusId) {
      return error("statusCategory or statusId is required", 400);
    }
  } else {
    if (!linkedTaskId) return error("linkedTaskId is required", 400);
    if (!status) return error("status is required", 400);
  }

  const auth = await resolveAuth(event, body);
  if (!auth) return unauthorized("Authentication required");

  try {
    if (workItemStatusRequest) {
      const result = await setWorkItemStatus({
        tenantId: auth.tenantId,
        threadId: auth.threadId,
        agentId: auth.agentId,
        workItemId,
        statusId,
        statusCategory,
        note: body.note,
        metadata: body.metadata,
        threadTurnId: body.threadTurnId,
        toolCallId: body.toolCallId,
        actor: auth.actor,
      });
      return json({
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        details: result,
        isError: false,
      });
    }

    const result = await setTaskStatus({
      tenantId: auth.tenantId,
      threadId: auth.threadId,
      agentId: auth.agentId,
      linkedTaskId,
      status,
      note: body.note,
      metadata: body.metadata,
      actor: auth.actor,
    });
    return json({
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
      details: result,
      isError: false,
    });
  } catch (err) {
    if (err instanceof TaskStatusToolError) {
      return json(
        {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                error: err.message,
                code: err.code,
              }),
            },
          ],
          isError: true,
          error: err.message,
          code: err.code,
        },
        err.statusCode,
      );
    }
    console.error("[task-status-tool] failed", err);
    return error(
      workItemStatusRequest
        ? "set_work_item_status failed"
        : "set_task_status failed",
      500,
    );
  }
}

async function resolveAuth(
  event: APIGatewayProxyEventV2,
  body: TaskStatusToolBody,
): Promise<ResolvedTaskStatusAuth | null> {
  const bearer = bearerToken(event.headers);
  if (bearer && validateApiSecret(bearer)) {
    const tenantId = stringValue(body.tenantId);
    const threadId = stringValue(body.threadId);
    const agentId = stringValue(body.agentId);
    if (!tenantId || !threadId || !agentId) return null;
    return {
      tenantId,
      threadId,
      agentId,
      actor: { type: "agent", id: agentId },
    };
  }

  const cognito = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!cognito || cognito.authType !== "cognito" || !cognito.email) {
    return null;
  }
  const cognitoTenantId = stringValue(cognito.tenantId);
  const userWhere = cognitoTenantId
    ? and(
        eq(users.email, cognito.email.toLowerCase()),
        eq(users.tenant_id, cognitoTenantId),
      )
    : eq(users.email, cognito.email.toLowerCase());
  const [user] = await db
    .select({
      id: users.id,
      tenantId: users.tenant_id,
      email: users.email,
    })
    .from(users)
    .where(userWhere)
    .limit(1);
  const tenantId = cognitoTenantId || user?.tenantId || null;
  const threadId = stringValue(body.threadId);
  if (!tenantId || !threadId || !user?.id) return null;
  return {
    tenantId,
    threadId,
    agentId: stringValue(body.agentId) || null,
    actor: { type: "user", id: user.id, email: user.email },
  };
}

function bearerToken(
  headers: APIGatewayProxyEventV2["headers"],
): string | null {
  const value = headers.authorization ?? headers.Authorization;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isWorkItemStatusPath(event: APIGatewayProxyEventV2): boolean {
  return (
    event.rawPath === "/api/work-items/status" ||
    event.requestContext.http.path === "/api/work-items/status"
  );
}
