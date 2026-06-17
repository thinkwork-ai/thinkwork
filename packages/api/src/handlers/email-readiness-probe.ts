import { getApiAuthSecret } from "@thinkwork/runtime-config";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { db } from "../lib/db.js";
import { error, handleCors, json, unauthorized } from "../lib/response.js";
import { runEmailReadinessProbe } from "../lib/email-channel/readiness-probes.js";

export async function handler(event: APIGatewayProxyEventV2) {
  const cors = handleCors(event);
  if (cors) return cors;
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }
  const bearer = (event.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer !== getApiAuthSecret()) {
    return unauthorized();
  }
  let body: { tenantId?: string; providerInstallId?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON", 400);
  }
  if (!body.tenantId || !body.providerInstallId) {
    return error("tenantId and providerInstallId are required", 400);
  }
  try {
    const result = await runEmailReadinessProbe({
      db,
      tenantId: body.tenantId,
      providerInstallId: body.providerInstallId,
    });
    return json({
      providerInstallId: result.providerInstallId,
      productionReady: result.productionReady,
      checks: result.checks.map((check) => ({
        checkKey: check.check_key,
        status: check.status,
        failureCode: check.failure_code,
        failureMessage: check.failure_message,
      })),
    });
  } catch (err) {
    console.error("[email-readiness-probe] failed", err);
    return error("Email readiness probe failed", 500);
  }
}
