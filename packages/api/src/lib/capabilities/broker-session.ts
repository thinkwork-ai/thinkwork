/**
 * Trusted capability-broker session opener (THINK-280 U3).
 *
 * This runs in the API control plane — the TRUSTED session-control path. It is
 * strictly separated from the PoP invocation path: it mints an ephemeral
 * Ed25519 keypair, registers ONLY the public key in the DynamoDB session, and
 * hands the private key back to the trusted caller inside a
 * {@link SessionBootstrap}. The private key is NEVER persisted server-side.
 * The sandbox holds only the bootstrap and can therefore invoke within the
 * session's bounds but can never mint or widen one.
 *
 * TTL is capped at {@link SESSION_MAX_TTL_SECONDS} (15 minutes). Endpoint
 * placeholders (VPCE DNS + private REST API id — THINK-144: private DNS is
 * disabled) are env-sourced through functions, per the vitest env-capture rule.
 */

import { generateKeyPairSync, randomUUID } from "node:crypto";

import {
  SESSION_MAX_TTL_SECONDS,
  type SessionBootstrap,
  type PrincipalMode,
} from "@thinkwork/capability-contracts";
import {
  createSession,
  type DynamoPort,
} from "@thinkwork/lambda/capability-broker/sessions";

/** Wrapped env reads (vitest env-capture rule — never read at module load). */
export function getBrokerVpceEndpoint(): string {
  return process.env.CAPABILITY_BROKER_VPCE_DNS ?? "";
}
export function getBrokerApiId(): string {
  return process.env.CAPABILITY_BROKER_API_ID ?? "";
}
export function getBrokerAudience(): string {
  return process.env.CAPABILITY_BROKER_AUDIENCE ?? "";
}

/** Generate an ephemeral Ed25519 keypair as base64 SPKI/PKCS8 DER. */
export function generateEphemeralKeypair(): {
  publicKeyB64: string;
  privateKeyB64: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyB64: publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    privateKeyB64: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
  };
}

export interface OpenBrokerSessionInput {
  tenantId: string;
  contextFingerprint: string;
  principal: { mode: PrincipalMode; subjectId?: string };
  grantSnapshot?: Record<string, unknown>;
  budgets?: Record<string, unknown>;
  /** Durable pg capability_broker_sessions.id for evidence linkage. */
  brokerSessionRowId: string;
  routineExecutionId?: string | null;
  threadTurnId?: string | null;
  /** Requested TTL; clamped to SESSION_MAX_TTL_SECONDS. */
  ttlSeconds?: number;
  /** Overrides (else env). */
  audience?: string;
  brokerEndpoint?: string;
  brokerApiId?: string;
  sessionId?: string;
  now?: () => number;
  /** Injected DynamoDB session store + table (the API builds these from the SDK). */
  store: DynamoPort;
  tableName: string;
}

export interface OpenBrokerSessionResult {
  sessionId: string;
  /** Base64 SPKI-DER Ed25519 public key registered in DynamoDB. */
  publicKey: string;
  expiresAt: string;
  /** Handed to the trusted caller ONLY — carries the private key. */
  bootstrap: SessionBootstrap;
}

/**
 * Open a bounded broker session. Fails closed if the endpoint placeholders are
 * unavailable (a bootstrap without an endpoint is useless and a session minted
 * without one is dead weight).
 */
export async function openBrokerSession(
  input: OpenBrokerSessionInput,
): Promise<OpenBrokerSessionResult> {
  const nowMs = (input.now ?? Date.now)();
  const audience = input.audience ?? getBrokerAudience();
  const brokerEndpoint = input.brokerEndpoint ?? getBrokerVpceEndpoint();
  const brokerApiId = input.brokerApiId ?? getBrokerApiId();
  if (!audience) throw new Error("broker-session: audience unavailable");
  if (!brokerEndpoint) {
    throw new Error("broker-session: CAPABILITY_BROKER_VPCE_DNS unavailable");
  }
  if (!brokerApiId) {
    throw new Error("broker-session: CAPABILITY_BROKER_API_ID unavailable");
  }

  const ttlSeconds = Math.min(
    Math.max(1, Math.floor(input.ttlSeconds ?? SESSION_MAX_TTL_SECONDS)),
    SESSION_MAX_TTL_SECONDS,
  );
  const sessionId = input.sessionId ?? randomUUID();
  const expiresEpochSeconds = Math.floor(nowMs / 1000) + ttlSeconds;
  const expiresAt = new Date(expiresEpochSeconds * 1000).toISOString();

  const { publicKeyB64, privateKeyB64 } = generateEphemeralKeypair();

  // Register ONLY the public key. The private key never touches DynamoDB or
  // any server-side store — it lives only in the bootstrap returned below.
  const created = await createSession(input.store, input.tableName, {
    sessionId,
    tenantId: input.tenantId,
    audience,
    publicKey: publicKeyB64,
    contextFingerprint: input.contextFingerprint,
    principalMode: input.principal.mode,
    subjectId: input.principal.subjectId ?? "",
    grantSnapshot: input.grantSnapshot ?? {},
    budgets: input.budgets ?? {},
    brokerSessionRowId: input.brokerSessionRowId,
    routineExecutionId: input.routineExecutionId ?? null,
    threadTurnId: input.threadTurnId ?? null,
    createdEpochMs: nowMs,
    expiresEpochSeconds,
  });
  if (!created.ok) {
    throw new Error(`broker-session: session id ${sessionId} already exists`);
  }

  const bootstrap: SessionBootstrap = {
    sessionId,
    audience,
    brokerEndpoint,
    brokerApiId,
    privateKey: privateKeyB64,
    nextSequence: 0,
    expiresAt,
  };

  return { sessionId, publicKey: publicKeyB64, expiresAt, bootstrap };
}
