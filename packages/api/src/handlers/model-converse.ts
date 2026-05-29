/**
 * Model proxy for the mobile agent harness.
 *
 * POST /api/model/converse
 *
 * Cognito-authenticated. The mobile harness runs its agent loop on the device and calls
 * this once per loop step with the full transcript; the proxy performs a single stateless
 * Bedrock `Converse` call and maps the result back to the provider-neutral wire shape. No
 * AWS credentials live on the device — the user's Cognito idToken authenticates here and
 * Bedrock is reached with the Lambda's own role.
 *
 *   200 → { text, toolCalls, stopReason, usage, modelId }
 *   400 → unresolvable / un-allowlisted model id (fail loud, no silent Sonnet)
 *   401 → unauthenticated
 *   403 → authenticated but not a bootstrapped tenant member (Bedrock spend is gated)
 *   502 → Bedrock ValidationException / model error (surfaced, never empty content)
 *
 * Tenant is resolved by email (the JWT `custom:tenant_id` claim is null for Google-
 * federated users — every mobile OAuth user); inference is gated to tenant members for
 * cost control and the turn is logged with tenant/user/model/usage for attribution.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { eq } from "drizzle-orm";
import { authenticate } from "../lib/cognito-auth.js";
import {
  handleCors,
  json,
  error,
  unauthorized,
  forbidden,
} from "../lib/response.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";
import {
  ModelResolutionError,
  parseConverseOutput,
  resolveModelId,
  toConverseMessages,
  toSystem,
  toToolConfig,
  type ProxyRequest,
  type ProxyResponse,
} from "../lib/model-proxy/converse-mapping.js";

const { users } = schema;

function region(): string {
  return process.env.AWS_REGION || "us-east-1";
}

function callTimeoutMs(): number {
  const v = Number(process.env.MOBILE_BEDROCK_CALL_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 60_000;
}

// Lambda reuses the client across invocations.
let _client: BedrockRuntimeClient | null = null;
function getClient(): BedrockRuntimeClient {
  if (!_client) _client = new BedrockRuntimeClient({ region: region() });
  return _client;
}

function isValidationLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "ValidationException" ||
    err.name === "ModelErrorException" ||
    err.name === "AccessDeniedException" ||
    err.name === "ResourceNotFoundException"
  );
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito" || !auth.email) {
    return unauthorized("Authentication required");
  }

  // Tenant by email — JWT tenantId is null for Google-federated users. Gate Bedrock
  // spend to bootstrapped tenant members (fail closed).
  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.email, auth.email.toLowerCase()))
    .limit(1);
  if (!userRow || !userRow.tenant_id) {
    return forbidden("No tenant resolved for caller");
  }
  const tenantId = userRow.tenant_id;

  let body: ProxyRequest;
  try {
    body = JSON.parse(event.body ?? "{}") as ProxyRequest;
  } catch {
    return error("Invalid JSON body", 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return error("messages is required", 400);
  }

  let modelId: string;
  try {
    modelId = resolveModelId(body.model);
  } catch (err) {
    if (err instanceof ModelResolutionError) return error(err.message, 400);
    throw err;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), callTimeoutMs());
  try {
    const output = await getClient().send(
      new ConverseCommand({
        modelId,
        system: toSystem(body.system),
        messages: toConverseMessages(body.messages),
        toolConfig: toToolConfig(body.tools),
        inferenceConfig: {
          maxTokens: body.maxTokens ?? 4096,
          temperature: body.temperature ?? 0,
        },
      }),
      { abortSignal: controller.signal },
    );

    const parsed = parseConverseOutput(output);
    const response: ProxyResponse = { ...parsed, modelId };

    console.info(
      "[model-converse]",
      JSON.stringify({
        tenantId,
        userId: userRow.id,
        modelId,
        stopReason: response.stopReason,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        toolCalls: response.toolCalls.length,
      }),
    );

    return json(response);
  } catch (err) {
    if (isValidationLikeError(err)) {
      // Surface the failure instead of recording an empty-content "success".
      return error(
        `Bedrock rejected the request: ${(err as Error).name}: ${(err as Error).message}`,
        502,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
