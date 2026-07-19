import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { messages, threads, threadTurns } from "@thinkwork/database-pg/schema";
import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import {
  signTurnAssertion,
  TURN_ASSERTION_MAX_TTL_SECONDS,
  type TurnAssertionSigner,
} from "../lib/mcp-oauth/turn-assertion.js";
import { loadCanonicalQuestionAnswerTurn } from "../lib/harness/canonical-question-answer-turn.js";

export interface TurnAssertionMintEvent {
  tenantId: string;
  turnId: string;
  target: "harness" | "gateway";
  operation?: string;
  toolUseId?: string;
  inputHash?: string;
}

export interface TrustedTurnAssertionTuple {
  tenantId: string;
  agentId: string;
  threadId: string;
  turnId: string;
  triggeringMessageId: string;
  participantId: string;
  sessionGeneration: number;
  spaceId: string | null;
  runtimeType: string | null;
  status: string;
}

export interface TurnAssertionMintDeps extends TurnAssertionSigner {
  issuer: string;
  harnessAudience: string;
  gatewayAudience: string;
  loadTrustedTurn(args: {
    tenantId: string;
    turnId: string;
  }): Promise<TrustedTurnAssertionTuple | null>;
  nowSeconds(): number;
  newJti(): string;
}

export interface TurnAssertionMintResult {
  token: string;
  tokenType: "Bearer";
  expiresAt: number;
  jti: string;
  target: "harness" | "gateway";
}

const region =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const kms = new KMSClient({ region });

export function createTurnAssertionMintHandler(deps: TurnAssertionMintDeps) {
  return async function mintTurnAssertion(
    rawEvent: TurnAssertionMintEvent,
  ): Promise<TurnAssertionMintResult> {
    const event = validateEvent(rawEvent);
    const trusted = await deps.loadTrustedTurn({
      tenantId: event.tenantId,
      turnId: event.turnId,
    });
    if (
      !trusted ||
      trusted.tenantId !== event.tenantId ||
      trusted.turnId !== event.turnId ||
      (trusted.runtimeType !== "agentcore" &&
        trusted.runtimeType !== "harness") ||
      trusted.status !== "running" ||
      !trusted.agentId ||
      !trusted.threadId ||
      !trusted.triggeringMessageId ||
      !trusted.participantId
    ) {
      throw new Error(
        "turn assertion mint requires a trusted running Harness turn",
      );
    }

    if (
      event.target === "gateway" &&
      (!event.operation || !event.toolUseId || !event.inputHash)
    ) {
      throw new Error(
        "gateway assertions require operation, toolUseId, and inputHash",
      );
    }
    const nowSeconds = deps.nowSeconds();
    const jti = deps.newJti();
    const token = await signTurnAssertion(
      {
        issuer: deps.issuer,
        audience:
          event.target === "harness"
            ? deps.harnessAudience
            : deps.gatewayAudience,
        subject: trusted.participantId,
        tenantId: trusted.tenantId,
        spaceId: trusted.spaceId,
        agentId: trusted.agentId,
        threadId: trusted.threadId,
        turnId: trusted.turnId,
        participantId: trusted.participantId,
        sessionGeneration: trusted.sessionGeneration,
        purpose:
          event.target === "harness" ? "harness_invoke" : "gateway_operation",
        scopes:
          event.target === "harness" ? ["harness:invoke"] : ["gateway:invoke"],
        ...(event.target === "gateway"
          ? {
              operation: event.operation,
              toolUseId: event.toolUseId,
              inputHash: event.inputHash,
            }
          : {}),
        nowSeconds,
        ttlSeconds: TURN_ASSERTION_MAX_TTL_SECONDS,
        jti,
      },
      deps,
    );
    return {
      token,
      tokenType: "Bearer",
      expiresAt: nowSeconds + TURN_ASSERTION_MAX_TTL_SECONDS,
      jti,
      target: event.target,
    };
  };
}

export async function loadTrustedTurnFromDatabase(args: {
  tenantId: string;
  turnId: string;
}): Promise<TrustedTurnAssertionTuple | null> {
  const db = getDb();
  const [row] = await db
    .select({
      tenantId: threadTurns.tenant_id,
      agentId: threadTurns.agent_id,
      threadAgentId: threads.agent_id,
      threadId: threadTurns.thread_id,
      turnId: threadTurns.id,
      triggeringMessageId: threadTurns.triggering_message_id,
      participantId: messages.sender_id,
      participantType: messages.sender_type,
      messageThreadId: messages.thread_id,
      messageTenantId: messages.tenant_id,
      spaceId: threads.space_id,
      runtimeType: threadTurns.runtime_type,
      status: threadTurns.status,
      retryAttempt: threadTurns.retry_attempt,
    })
    .from(threadTurns)
    .innerJoin(
      threads,
      and(
        eq(threads.id, threadTurns.thread_id),
        eq(threads.tenant_id, threadTurns.tenant_id),
      ),
    )
    .innerJoin(
      messages,
      and(
        eq(messages.id, threadTurns.triggering_message_id),
        eq(messages.thread_id, threadTurns.thread_id),
        eq(messages.tenant_id, threadTurns.tenant_id),
      ),
    )
    .where(
      and(
        eq(threadTurns.id, args.turnId),
        eq(threadTurns.tenant_id, args.tenantId),
      ),
    )
    .limit(1);

  if (
    row?.agentId &&
    row.threadId &&
    row.triggeringMessageId &&
    row.participantId &&
    (row.participantType === "human" || row.participantType === "user") &&
    row.threadAgentId === row.agentId &&
    row.messageThreadId === row.threadId &&
    row.messageTenantId === row.tenantId &&
    Number.isInteger(row.retryAttempt ?? 0) &&
    (row.retryAttempt ?? 0) >= 0
  ) {
    return {
      tenantId: row.tenantId,
      agentId: row.agentId,
      threadId: row.threadId,
      turnId: row.turnId,
      triggeringMessageId: row.triggeringMessageId,
      participantId: row.participantId,
      sessionGeneration: (row.retryAttempt ?? 0) + 1,
      spaceId: row.spaceId,
      runtimeType: row.runtimeType,
      status: row.status,
    };
  }

  const action = await loadCanonicalQuestionAnswerTurn(args);
  if (!action) return null;
  return {
    tenantId: action.tenantId,
    agentId: action.agentId,
    threadId: action.threadId,
    turnId: action.turnId,
    triggeringMessageId: action.anchorMessageId,
    participantId: action.participantUserId,
    sessionGeneration: action.retryAttempt + 1,
    spaceId: action.spaceId,
    runtimeType: action.runtimeType,
    status: action.status,
  };
}

const defaultHandler = createTurnAssertionMintHandler({
  issuer: requiredEnv("AGENTCORE_TURN_ASSERTION_ISSUER"),
  harnessAudience: requiredEnv("AGENTCORE_HARNESS_AUDIENCE"),
  gatewayAudience: requiredEnv("AGENTCORE_GATEWAY_AUDIENCE"),
  keyId: requiredEnv("AGENTCORE_TURN_ASSERTION_KMS_KEY_ID"),
  kid: requiredEnv("AGENTCORE_TURN_ASSERTION_KID"),
  loadTrustedTurn: loadTrustedTurnFromDatabase,
  nowSeconds: () => Math.floor(Date.now() / 1000),
  newJti: randomUUID,
  async sign(message, request) {
    const startedAt = Date.now();
    try {
      const result = await kms.send(
        new SignCommand({
          KeyId: request.keyId,
          Message: message,
          MessageType: "RAW",
          SigningAlgorithm: request.signingAlgorithm,
        }),
      );
      if (!result.Signature?.byteLength) {
        throw new Error("KMS Sign returned no signature");
      }
      emitKmsSigningMetric(Date.now() - startedAt, true);
      return result.Signature;
    } catch (cause) {
      emitKmsSigningMetric(Date.now() - startedAt, false);
      throw cause;
    }
  },
});

export const handler = defaultHandler;

export function buildKmsSigningMetric(
  durationMs: number,
  success: boolean,
  stage = process.env.STAGE?.trim() || "unknown",
  timestamp = Date.now(),
): Record<string, unknown> {
  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: "ThinkWork/AgentCore",
          Dimensions: [["Stage"]],
          Metrics: [
            { Name: "TurnAssertionKmsSignLatency", Unit: "Milliseconds" },
            { Name: "TurnAssertionKmsSignFailures", Unit: "Count" },
          ],
        },
      ],
    },
    Stage: stage,
    TurnAssertionKmsSignLatency: Math.max(0, durationMs),
    TurnAssertionKmsSignFailures: success ? 0 : 1,
  };
}

function emitKmsSigningMetric(durationMs: number, success: boolean): void {
  // EMF contains no token, subject, turn, tenant, key id, or other caller
  // material. It is safe to retain for rotation/capacity evidence.
  console.log(JSON.stringify(buildKmsSigningMetric(durationMs, success)));
}

function validateEvent(raw: TurnAssertionMintEvent): TurnAssertionMintEvent {
  if (!raw || typeof raw !== "object") {
    throw new Error("turn assertion event is required");
  }
  if (!raw.tenantId?.trim() || !raw.turnId?.trim()) {
    throw new Error("tenantId and turnId are required");
  }
  if (raw.target !== "harness" && raw.target !== "gateway") {
    throw new Error("target must be harness or gateway");
  }
  return {
    tenantId: raw.tenantId.trim(),
    turnId: raw.turnId.trim(),
    target: raw.target,
    ...(raw.operation ? { operation: raw.operation.trim() } : {}),
    ...(raw.toolUseId ? { toolUseId: raw.toolUseId.trim() } : {}),
    ...(raw.inputHash ? { inputHash: raw.inputHash.trim() } : {}),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  // Avoid module-import failures in unit tests that exercise only the
  // dependency-injected handler. The default handler fails on invocation.
  return value || `__UNCONFIGURED_${name}__`;
}
