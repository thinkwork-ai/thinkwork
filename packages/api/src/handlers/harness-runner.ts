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
import { EventStreamCodec } from "@smithy/eventstream-codec";
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
import { requireHarnessProofProfile } from "../lib/harness/proof-profile.js";
import {
  abandonFreshHarnessTurn,
  prepareFreshHarnessTurn,
  transitionFreshHarnessTurn,
} from "../lib/harness/participant-session-store.js";

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
  const profile = await requireHarnessProofProfile(input.tenantSlug);
  const harnessId = profile.harnessArn.split("/").at(-1) ?? "";
  if (!harnessId) throw new Error("Harness proof ARN is malformed");
  return {
    harnessArn: profile.harnessArn,
    harnessId,
    harnessVersion: profile.liveVersion,
    qualifier: profile.endpointName,
    configurationFingerprint: profile.configurationFingerprint,
    sessionStrategy: "fresh",
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

function eventHeader(
  message: { headers?: Record<string, { value?: unknown }> },
  name: string,
): string | undefined {
  const value = message.headers?.[name]?.value;
  return typeof value === "string" ? value : undefined;
}

async function* invokeHarnessWithBearer(input: {
  harnessArn: string;
  qualifier: string;
  bearerToken: string;
  runtimeSessionId: string;
  messages: HarnessInvokeMessage[];
}): AsyncIterable<HarnessStreamEvent> {
  const url = new URL(
    `https://bedrock-agentcore.${region}.amazonaws.com/harnesses/invoke`,
  );
  url.searchParams.set("harnessArn", input.harnessArn);
  url.searchParams.set("qualifier", input.qualifier);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.bearerToken}`,
      "content-type": "application/json",
      "x-amzn-bedrock-agentcore-runtime-session-id": input.runtimeSessionId,
    },
    body: JSON.stringify({
      messages: input.messages,
      maxIterations: 50,
      timeoutSeconds: 900,
    }),
    signal: AbortSignal.timeout(910_000),
  });
  if (!response.ok || !response.body) {
    const requestId =
      response.headers.get("x-amzn-requestid") ??
      response.headers.get("x-amz-request-id") ??
      "unknown";
    const responseDetail = await response
      .text()
      .then((body) => body.replace(/\s+/g, " ").trim().slice(0, 1_000))
      .catch(() => "");
    throw new Error(
      `Harness Bearer invocation failed with HTTP ${response.status} (request ${requestId})${responseDetail ? `: ${responseDetail}` : ""}`,
    );
  }

  const codec = new EventStreamCodec(
    (bytes) => decoder.decode(bytes),
    (text) => encoder.encode(text),
  );
  let buffer = Buffer.alloc(0);
  const reader = response.body.getReader();
  for (;;) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    if (!chunk) continue;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length >= 4) {
      const frameLength = buffer.readUInt32BE(0);
      if (frameLength < 16) throw new Error("Invalid Harness event frame");
      if (buffer.length < frameLength) break;
      const frame = buffer.subarray(0, frameLength);
      buffer = buffer.subarray(frameLength);
      const message = codec.decode(frame);
      if (eventHeader(message, ":message-type") === "exception") {
        const exceptionType =
          eventHeader(message, ":exception-type") ?? "service_exception";
        throw new Error(`Harness stream failed (${exceptionType})`);
      }
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(decoder.decode(message.body)) as Record<
          string,
          unknown
        >;
      } catch {
        continue;
      }
      yield normalizeHarnessWireEvent(event);
    }
  }
  if (buffer.length !== 0) {
    throw new Error("Harness event stream ended with an incomplete frame");
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
