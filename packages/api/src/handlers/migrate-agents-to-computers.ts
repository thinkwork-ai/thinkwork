import {
  applyComputerMigration,
  ComputerMigrationBlockedError,
  dryRunComputerMigration,
} from "../lib/computers/migration.js";

interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  requestContext?: { http?: { method?: string } };
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return json(200, { ok: true });
  }
  const auth = event.headers?.authorization ?? event.headers?.Authorization;
  const expected =
    process.env.API_AUTH_SECRET || process.env.THINKWORK_API_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const tenantId = String(body.tenantId ?? "");
    if (!tenantId) return json(400, { ok: false, error: "tenantId required" });
    if (!UUID_RE.test(tenantId)) {
      return json(400, { ok: false, error: "tenantId must be a UUID" });
    }
    const mode = body.mode == null ? "dry-run" : String(body.mode);
    if (mode !== "dry-run" && mode !== "apply") {
      return json(400, {
        ok: false,
        error: "mode must be dry-run or apply",
      });
    }
    const idempotencyKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : null;
    if (mode === "apply") {
      const result = await applyComputerMigration({ tenantId, apply: true });
      return json(200, {
        ok: true,
        mode: "apply",
        idempotencyKey,
        ...result,
      });
    }
    const report = await dryRunComputerMigration({ tenantId });
    return json(200, { ok: true, mode: "dry-run", idempotencyKey, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ComputerMigrationBlockedError) {
      return json(err.statusCode, {
        ok: false,
        error: message,
        blockers: err.blockers,
      });
    }
    return json(500, { ok: false, error: message });
  }
}

function json(statusCode: number, payload: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-allow-methods": "POST,OPTIONS",
    },
    body: JSON.stringify(payload),
  };
}
