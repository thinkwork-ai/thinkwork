/**
 * harness-runner Lambda (THINK-311 U5).
 *
 * Event-mode target for harness-flagged agents: the chat dispatch selector
 * (resolveRuntimeFunctionName) routes their turns here instead of the Pi
 * container Lambda, wrapped in the same API-GW-shaped /invocations
 * envelope. This handler wires real AWS/db/platform effects into the
 * pure-ish run loop in lib/harness/runner.ts.
 *
 * Lifecycle: maximum_retry_attempts=0 in terraform (async-retry
 * idempotency) — a crashed run must never re-execute a turn; the stall
 * monitor times out abandoned turns without retry-queue re-dispatch
 * (runtime_type='agentcore' exclusion) and releases the thread checkout.
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { threadTurns } from "@thinkwork/database-pg/schema";
import { deriveFunctionName, getConfig } from "@thinkwork/runtime-config";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  BedrockAgentCoreClient,
  GetResourceOauth2TokenCommand,
  GetWorkloadAccessTokenForJWTCommand,
  InvokeHarnessCommand,
  type HarnessMessage,
  type HarnessTool,
  type HarnessSystemContentBlock,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  parseHarnessInvokeEvent,
  normalizeHarnessWireEvent,
  runHarnessTurn,
  type EnsuredHarness,
  type HarnessInvokeMessage,
  type HarnessRunnerDeps,
  type HarnessStreamEvent,
} from "../lib/harness/runner.js";
import { handleDocumentEmission } from "../lib/artifacts/document-emission.js";
import { processFinalize } from "../lib/chat-finalize/process-finalize.js";
import { requireHarnessManagedProfile } from "../lib/harness/proof-profile.js";
import {
  abandonFreshHarnessTurn,
  prepareFreshHarnessTurn,
  transitionFreshHarnessTurn,
} from "../lib/harness/participant-session-store.js";
import { loadTurnToolExecutionInvocations } from "../lib/harness/tool-execution-ledger.js";
import { collectGovernedConnectorEvidence } from "../lib/harness/gateway-evidence.js";

const region =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region });
const lambda = new LambdaClient({ region });
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Control-plane responses wrap the harness document under a `harness` key
 * (`{harness: {...}, $metadata}`) — observed live on CreateHarness with
 * SDK 3.1088; summaries in ListHarnesses are unwrapped. Normalize both.
 */
export function unwrapHarness(
  response: Record<string, unknown>,
): Record<string, unknown> {
  const inner = response.harness;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return response;
}

export function readIdentity(raw: Record<string, unknown>): {
  harnessId: string;
  harnessArn: string;
  harnessVersion: string;
} {
  const response = unwrapHarness(raw);
  const harnessId = String(response.harnessId ?? response.id ?? "");
  const harnessArn = String(response.harnessArn ?? response.arn ?? "");
  const harnessVersion = String(
    response.harnessVersion ?? response.latestVersion ?? response.version ?? "",
  );
  if (!harnessId || !harnessArn) {
    throw new Error(
      `Harness control-plane response missing identity fields: ${JSON.stringify(Object.keys(raw))}`,
    );
  }
  return { harnessId, harnessArn, harnessVersion };
}

async function resolveHarness(input: {
  tenantId: string;
  tenantSlug: string;
}): Promise<EnsuredHarness> {
  const profile = await requireHarnessManagedProfile(input.tenantSlug);
  const harnessId = profile.harnessArn.split("/").at(-1) ?? "";
  if (!harnessId) throw new Error("AgentCore Harness ARN is malformed");
  return {
    harnessArn: profile.harnessArn,
    harnessId,
    harnessVersion: profile.liveVersion,
    modelId: profile.modelId,
    qualifier: profile.endpointName,
    configurationFingerprint: profile.configurationFingerprint,
    sessionStrategy: "fresh",
    gatewayUrl: profile.gatewayUrl,
    gatewayTargetName: profile.gatewayTargetName,
    identityWorkloadName: profile.identityWorkloadName,
    identityCredentialProviderName: profile.identityCredentialProviderName,
  };
}

async function mintHarnessAssertion(input: {
  tenantId: string;
  turnId: string;
}): Promise<{ token: string; expiresAt: number; jti: string }> {
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: deriveFunctionName("turn-assertion-mint"),
      InvocationType: "RequestResponse",
      Payload: encoder.encode(JSON.stringify({ ...input, target: "harness" })),
    }),
  );
  if (response.FunctionError) {
    throw new Error("Harness turn assertion mint failed");
  }
  const result = JSON.parse(
    response.Payload ? decoder.decode(response.Payload) : "{}",
  ) as Record<string, unknown>;
  if (
    typeof result.token !== "string" ||
    !result.token ||
    !Number.isInteger(result.expiresAt) ||
    Number(result.expiresAt) <= Math.floor(Date.now() / 1000) ||
    typeof result.jti !== "string" ||
    !result.jti
  ) {
    throw new Error("Harness turn assertion mint returned an invalid result");
  }
  return {
    token: result.token,
    expiresAt: Number(result.expiresAt),
    jti: result.jti,
  };
}

async function mintGatewayAssertion(input: {
  tenantId: string;
  turnId: string;
  identityWorkloadName: string;
  identityCredentialProviderName: string;
}): Promise<{ token: string; expiresAt: number; jti: string }> {
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: deriveFunctionName("turn-assertion-mint"),
      InvocationType: "RequestResponse",
      Payload: encoder.encode(
        JSON.stringify({
          tenantId: input.tenantId,
          turnId: input.turnId,
          target: "harness",
        }),
      ),
    }),
  );
  if (response.FunctionError) {
    throw new Error("Gateway OBO subject assertion mint failed");
  }
  const result = JSON.parse(
    response.Payload ? decoder.decode(response.Payload) : "{}",
  ) as Record<string, unknown>;
  if (
    typeof result.token !== "string" ||
    !result.token ||
    !Number.isInteger(result.expiresAt) ||
    Number(result.expiresAt) <= Math.floor(Date.now() / 1000) ||
    typeof result.jti !== "string" ||
    !result.jti
  ) {
    throw new Error(
      "Gateway OBO subject assertion mint returned an invalid result",
    );
  }
  const identity = new BedrockAgentCoreClient({ region });
  const workload = await identity.send(
    new GetWorkloadAccessTokenForJWTCommand({
      workloadName: input.identityWorkloadName,
      userToken: String(result.token),
    }),
  );
  if (!workload.workloadAccessToken) {
    identity.destroy();
    throw new Error("AgentCore Identity returned no workload access token");
  }
  const gateway = await identity.send(
    new GetResourceOauth2TokenCommand({
      workloadIdentityToken: workload.workloadAccessToken,
      resourceCredentialProviderName: input.identityCredentialProviderName,
      scopes: ["gateway:invoke"],
      oauth2Flow: "ON_BEHALF_OF_TOKEN_EXCHANGE",
      customParameters: {
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      },
    }),
  );
  identity.destroy();
  if (!gateway.accessToken) {
    throw new Error("AgentCore Identity returned no Gateway access token");
  }
  return {
    token: gateway.accessToken,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    jti: String(result.jti),
  };
}

async function* invokeHarnessWithBearer(input: {
  harnessArn: string;
  qualifier: string;
  bearerToken: string;
  runtimeSessionId: string;
  messages: HarnessInvokeMessage[];
  allowedTools?: string[];
  tools?: Array<Record<string, unknown>>;
  systemPrompt?: Array<{ text: string }>;
  maxIterations?: number;
}): AsyncIterable<HarnessStreamEvent> {
  // Use the generated SDK serializer for InvokeHarness. The prior hand-built
  // HTTP request produced valid text streams but silently lost native inline
  // tool selection on the OAuth/JWT path. Keep the SDK's canonical request
  // shape and replace only its SigV4 Authorization header after signing.
  const client = new BedrockAgentCoreClient({
    region,
    credentials: {
      accessKeyId: "BEARER",
      secretAccessKey: "BEARER",
    },
  });
  client.middlewareStack.addRelativeTo(
    (next: (args: any) => Promise<any>) => async (args: any) => {
      const request = args.request as {
        headers: Record<string, string | undefined>;
      };
      request.headers.authorization = `Bearer ${input.bearerToken}`;
      delete request.headers["x-amz-security-token"];
      return next(args);
    },
    {
      relation: "after",
      toMiddleware: "awsAuthMiddleware",
      name: "thinkworkHarnessBearerAuth",
      override: true,
    },
  );
  let response;
  try {
    response = await client.send(
      new InvokeHarnessCommand({
        harnessArn: input.harnessArn,
        ...(input.qualifier ? { qualifier: input.qualifier } : {}),
        runtimeSessionId: input.runtimeSessionId,
        messages: input.messages as unknown as HarnessMessage[],
        ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
        ...(input.tools
          ? { tools: input.tools as unknown as HarnessTool[] }
          : {}),
        ...(input.systemPrompt
          ? {
              systemPrompt: input.systemPrompt as HarnessSystemContentBlock[],
            }
          : {}),
        maxIterations: input.maxIterations ?? 50,
        timeoutSeconds: 900,
      }),
      { abortSignal: AbortSignal.timeout(910_000) },
    );
  } catch (error) {
    client.destroy();
    throw error;
  }
  const stream = response.stream;
  if (!stream) {
    client.destroy();
    throw new Error("InvokeHarness returned no stream");
  }
  try {
    for await (const event of stream) {
      yield normalizeHarnessWireEvent(
        event as unknown as Record<string, unknown>,
      );
    }
  } finally {
    client.destroy();
  }
}

function createRealDeps(): HarnessRunnerDeps {
  const workspaceBucket = getConfig("WORKSPACE_BUCKET", "");
  return {
    workspaceBucket,
    resolveHarness,
    mintHarnessAssertion,
    prepareFreshTurn: prepareFreshHarnessTurn,
    transitionFreshTurn: transitionFreshHarnessTurn,
    abandonFreshTurn: abandonFreshHarnessTurn,
    invokeHarness: invokeHarnessWithBearer,
    async emitDocument(input) {
      // Resolve triggering_message_id the same way the activity handler
      // does — handleDocumentEmission derives the acting user from it.
      const db = getDb();
      const [turnRow] = await db
        .select({
          triggering_message_id: threadTurns.triggering_message_id,
        })
        .from(threadTurns)
        .where(
          and(
            eq(threadTurns.id, input.turnId),
            eq(threadTurns.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      return handleDocumentEmission({
        tenantId: input.tenantId,
        threadId: input.threadId,
        agentId: input.agentId,
        turnId: input.turnId,
        triggeringMessageId: turnRow?.triggering_message_id ?? null,
        raw: input.raw,
      });
    },
    async finalize(payload) {
      const governedInvocations = await loadTurnToolExecutionInvocations({
        tenantId: payload.tenant_id,
        threadId: payload.thread_id,
        turnId: payload.thread_turn_id,
      });
      if (payload.response && governedInvocations.length > 0) {
        const merged = [
          ...(payload.response.tool_invocations ?? []),
          ...governedInvocations,
        ];
        payload.response.tool_invocations = merged;
        payload.response.tools_called = [
          ...new Set(
            merged
              .map((invocation) => String(invocation.tool_name ?? ""))
              .filter(Boolean),
          ),
        ];
      }
      return processFinalize(payload);
    },
    async bumpTurnActivity({ turnId, tenantId }) {
      const db = getDb();
      await db
        .update(threadTurns)
        .set({ last_activity_at: new Date() })
        .where(
          and(
            eq(threadTurns.id, turnId),
            eq(threadTurns.tenant_id, tenantId),
            eq(threadTurns.status, "running"),
            sql`${threadTurns.finalized_at} IS NULL`,
          ),
        );
    },
    loadToolExecutions: loadTurnToolExecutionInvocations,
    collectConnectorEvidence: async (input) =>
      collectGovernedConnectorEvidence({
        profile: {
          gatewayUrl: input.gatewayUrl,
          gatewayTargetName: input.gatewayTargetName,
        },
        deps: {
          mintAssertion: ({ tenantId, turnId }) =>
            mintGatewayAssertion({
              tenantId,
              turnId,
              identityWorkloadName: input.identityWorkloadName,
              identityCredentialProviderName:
                input.identityCredentialProviderName,
            }),
          fetch,
        },
        tenantId: input.tenantId,
        turnId: input.turnId,
        connector: input.connector,
        query: input.query,
      }),
    async fetchWorkspaceText(key) {
      if (!workspaceBucket) return null;
      try {
        const object = await s3.send(
          new GetObjectCommand({ Bucket: workspaceBucket, Key: key }),
        );
        return (await object.Body?.transformToString()) ?? null;
      } catch {
        return null;
      }
    },
  };
}

export async function handler(event: unknown): Promise<{ ok: boolean }> {
  const payload = parseHarnessInvokeEvent(event);
  console.log(
    `[harness-runner] thread=${payload.thread_id} turn=${payload.thread_turn_id} agent=${payload.assistant_id}`,
  );
  // runHarnessTurn finalizes every internal failure itself; anything that
  // escapes (payload missing ids, finalize failure) lands in the DLQ and
  // the stall monitor reconciles the turn (KTD-9 backstop).
  const result = await runHarnessTurn(payload, createRealDeps());
  console.log(
    `[harness-runner] turn ${payload.thread_turn_id}: ${result.status}`,
  );
  return { ok: result.status === "completed" };
}
