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
import { authenticate } from "../lib/cognito-auth.js";
import {
  admitCognitoTenant,
  AuthAdmissionError,
} from "../lib/auth-admission.js";
import {
  handleCors,
  json,
  error,
  unauthorized,
  forbidden,
} from "../lib/response.js";
import { recordCostEvents } from "../lib/cost-recording.js";
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
  if (!auth || auth.authType !== "cognito") {
    return unauthorized("Authentication required");
  }

  let admission;
  try {
    admission = await admitCognitoTenant(auth, auth.tenantId ?? undefined);
  } catch (cause) {
    if (!(cause instanceof AuthAdmissionError)) throw cause;
    return forbidden("No tenant resolved for caller");
  }
  const tenantId = admission.tenantId;

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
  const startedAt = Date.now();
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

    // THINK-245 U6: per-tenant cost event for this proxy call. The API
    // Gateway requestId is unique per HTTP call — each call is exactly one
    // billable Converse invocation, so it's a sound idempotency key.
    // Best-effort: a recording failure must never fail the user's request.
    try {
      await recordCostEvents({
        tenantId,
        userId: admission.userId,
        requestId: `model-converse:${event.requestContext.requestId}`,
        model: modelId,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        // Converse usage.inputTokens EXCLUDES cache tokens; pass them through.
        cachedReadTokens: output.usage?.cacheReadInputTokens ?? 0,
        cachedWriteTokens: output.usage?.cacheWriteInputTokens ?? 0,
        durationMs: Date.now() - startedAt,
        recordCompute: false,
        source: "model_converse",
      });
    } catch (err) {
      console.error("[model-converse] cost recording failed:", err);
    }

    console.info(
      "[model-converse]",
      JSON.stringify({
        tenantId,
        userId: admission.userId,
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
