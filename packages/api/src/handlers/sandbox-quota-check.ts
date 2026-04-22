/**
 * sandbox-quota-check — narrow REST endpoint the Strands sandbox tool
 * calls before every executeCode to atomically claim quota (plan Unit 10).
 *
 * POST /api/sandbox/quota/check-and-increment
 *   Authorization: Bearer <API_AUTH_SECRET>
 *   body: { tenant_id, agent_id }
 *   → 200 { ok: true, tenant_daily_count, agent_hourly_count }
 *   → 429 { ok: false, dimension, resets_at }
 *
 * Uses the service-endpoint auth pattern (API_AUTH_SECRET) rather than
 * the GraphQL resolver auth path — avoids widening resolveCaller to
 * accept container-originated calls (per
 * docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md).
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, unauthorized } from "../lib/response.js";
import {
  checkAndIncrement,
  DEFAULT_AGENT_HOURLY_CAP,
  DEFAULT_TENANT_DAILY_CAP,
  type QuotaCaps,
} from "../lib/sandbox-quota.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
      body: "",
    };
  }
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }
  if (event.rawPath !== "/api/sandbox/quota/check-and-increment") {
    return error("Not found", 404);
  }

  const token = extractBearerToken(event);
  if (!token || !validateApiSecret(token)) return unauthorized();

  let body: { tenant_id?: string; agent_id?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }
  const { tenant_id, agent_id } = body;
  if (!tenant_id || !UUID_RE.test(tenant_id)) {
    return error("tenant_id: valid UUID required", 400);
  }
  if (!agent_id || !UUID_RE.test(agent_id)) {
    return error("agent_id: valid UUID required", 400);
  }

  const caps = resolveCapsFromEnv();

  const result = await checkAndIncrement({
    tenantId: tenant_id,
    agentId: agent_id,
    caps,
  });

  if (result.ok) {
    return json(
      {
        ok: true,
        tenant_daily_count: result.tenantDailyCount,
        agent_hourly_count: result.agentHourlyCount,
      },
      200,
    );
  }
  // 429 so the sandbox tool can distinguish cap breach from a 500.
  return json(
    {
      ok: false,
      dimension: result.dimension,
      resets_at: result.resetsAt,
    },
    429,
  );
}

/**
 * Cap overrides come from stage env vars populated by SSM at Lambda
 * cold-start:
 *   SANDBOX_TENANT_DAILY_CAP (default 500)
 *   SANDBOX_AGENT_HOURLY_CAP (default 20)
 * Zero is a legitimate kill-switch value — rejects every call including
 * the first. Exposed for unit tests.
 */
export function resolveCapsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): QuotaCaps {
  return {
    tenantDailyCap: parseCap(
      env.SANDBOX_TENANT_DAILY_CAP,
      DEFAULT_TENANT_DAILY_CAP,
    ),
    agentHourlyCap: parseCap(
      env.SANDBOX_AGENT_HOURLY_CAP,
      DEFAULT_AGENT_HOURLY_CAP,
    ),
  };
}

function parseCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}
