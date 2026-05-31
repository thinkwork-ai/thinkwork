/**
 * Mobile platform tools for the on-device Pi harness.
 *
 * POST /api/mobile/tools/web-search
 *
 * These routes expose ThinkWork built-in tools to the mobile local agent. They
 * are intentionally separate from the MCP proxy: MCP is only for external MCP
 * servers, while built-ins resolve tenant config and provider secrets inside
 * ThinkWork.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../lib/cognito-auth.js";
import {
  handleCors,
  json,
  error,
  unauthorized,
  forbidden,
  notFound,
} from "../lib/response.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";
import {
  loadTenantWebSearchConfig,
  runWebSearch,
} from "../lib/builtin-tools/web-search.js";
import { validateTemplateWebSearch } from "../lib/templates/web-search-config.js";

const { users, agents } = schema;

const LOG_PREFIX = "[mobile-tools]";

interface WebSearchBody {
  agentId?: string;
  query?: string;
  num_results?: number;
}

function isWebSearchAllowed(agent: {
  web_search?: unknown;
  blocked_tools?: unknown;
}): boolean {
  const blocked = Array.isArray(agent.blocked_tools)
    ? (agent.blocked_tools as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  if (blocked.includes("web-search") || blocked.includes("web_search")) {
    return false;
  }

  const parsed = validateTemplateWebSearch(agent.web_search);
  return parsed.ok && parsed.value?.enabled === true;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const path = event.requestContext.http.path || event.rawPath || "";
  if (!path.endsWith("/tools/web-search")) {
    return notFound("Unknown mobile tool route");
  }

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito" || !auth.email) {
    return unauthorized("Authentication required");
  }

  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.email, auth.email.toLowerCase()))
    .limit(1);
  if (!userRow || !userRow.tenant_id) {
    return forbidden("No tenant resolved for caller");
  }

  let body: WebSearchBody;
  try {
    body = JSON.parse(event.body ?? "{}") as WebSearchBody;
  } catch {
    return error("Invalid JSON body", 400);
  }
  if (!body.agentId) return error("agentId is required", 400);
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return error("query is required", 400);

  const [agent] = await db
    .select({
      id: agents.id,
      web_search: agents.web_search,
      blocked_tools: agents.blocked_tools,
    })
    .from(agents)
    .where(
      and(eq(agents.id, body.agentId), eq(agents.tenant_id, userRow.tenant_id)),
    )
    .limit(1);
  if (!agent) return notFound("Agent not found");
  if (!isWebSearchAllowed(agent)) {
    return notFound("web_search is not enabled for this agent");
  }

  const config = await loadTenantWebSearchConfig(userRow.tenant_id);
  if (!config) {
    return notFound("web_search is not configured for this tenant");
  }

  const limit = Math.max(
    1,
    Math.min(Math.trunc(Number(body.num_results) || 5), 10),
  );

  try {
    const results = await runWebSearch({
      provider: config.provider,
      apiKey: config.apiKey,
      query,
      limit,
    });
    console.info(
      LOG_PREFIX,
      JSON.stringify({
        op: "web_search",
        tenantId: userRow.tenant_id,
        userId: userRow.id,
        agentId: body.agentId,
        provider: config.provider,
        resultCount: results.length,
      }),
    );
    return json({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            provider: config.provider,
            query,
            result_count: results.length,
            results,
          }),
        },
      ],
      isError: false,
    });
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} web_search failed:`,
      err instanceof Error ? err.message : err,
    );
    return json({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            provider: config.provider,
            query,
            result_count: 0,
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
      isError: true,
    });
  }
}
