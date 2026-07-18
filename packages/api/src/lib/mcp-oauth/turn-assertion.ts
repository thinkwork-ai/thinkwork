import { createPublicKey, randomUUID } from "node:crypto";

export const TURN_ASSERTION_MAX_TTL_SECONDS = 5 * 60;
const MAX_KMS_RAW_MESSAGE_BYTES = 4096;

export type TurnAssertionPurpose = "harness_invoke" | "gateway_operation";

export interface TurnAssertionInput {
  issuer: string;
  audience: string;
  subject: string;
  tenantId: string;
  spaceId?: string | null;
  agentId: string;
  threadId: string;
  turnId: string;
  participantId: string;
  sessionGeneration: number;
  purpose: TurnAssertionPurpose;
  scopes: string[];
  operation?: string;
  toolUseId?: string;
  inputHash?: string;
  nowSeconds?: number;
  ttlSeconds?: number;
  jti?: string;
}

export interface TurnAssertionClaims {
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  tenant_id: string;
  space_id?: string;
  agent_id: string;
  thread_id: string;
  turn_id: string;
  participant_id: string;
  session_generation: number;
  purpose: TurnAssertionPurpose;
  scope: string;
  operation?: string;
  tool_use_id?: string;
  input_hash?: string;
}

export interface TurnAssertionSigner {
  keyId: string;
  kid: string;
  sign(
    message: Uint8Array,
    request: {
      keyId: string;
      signingAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256";
    },
  ): Promise<Uint8Array>;
}

export class TurnAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnAssertionError";
  }
}

export function buildTurnAssertionClaims(
  input: TurnAssertionInput,
): TurnAssertionClaims {
  const issuer = requiredString(input.issuer, "issuer");
  let parsedIssuer: URL;
  try {
    parsedIssuer = new URL(issuer);
  } catch {
    throw new TurnAssertionError("issuer must be a valid URL");
  }
  if (parsedIssuer.protocol !== "https:") {
    throw new TurnAssertionError("issuer must use https");
  }

  const ttlSeconds = input.ttlSeconds ?? TURN_ASSERTION_MAX_TTL_SECONDS;
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > TURN_ASSERTION_MAX_TTL_SECONDS
  ) {
    throw new TurnAssertionError(
      `ttlSeconds must be an integer between 1 and ${TURN_ASSERTION_MAX_TTL_SECONDS}`,
    );
  }
  if (
    !Number.isInteger(input.sessionGeneration) ||
    input.sessionGeneration < 1
  ) {
    throw new TurnAssertionError(
      "sessionGeneration must be a positive integer",
    );
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(nowSeconds) || nowSeconds < 1) {
    throw new TurnAssertionError("nowSeconds must be a positive integer");
  }
  const scopes = [...new Set(input.scopes.map((scope) => scope.trim()))]
    .filter(Boolean)
    .sort();
  if (scopes.length === 0) {
    throw new TurnAssertionError("at least one scope is required");
  }

  const base: TurnAssertionClaims = {
    iss: issuer.replace(/\/+$/, ""),
    aud: requiredString(input.audience, "audience"),
    sub: requiredString(input.subject, "subject"),
    jti: requiredString(input.jti ?? randomUUID(), "jti"),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    tenant_id: requiredString(input.tenantId, "tenantId"),
    ...(input.spaceId
      ? { space_id: requiredString(input.spaceId, "spaceId") }
      : {}),
    agent_id: requiredString(input.agentId, "agentId"),
    thread_id: requiredString(input.threadId, "threadId"),
    turn_id: requiredString(input.turnId, "turnId"),
    participant_id: requiredString(input.participantId, "participantId"),
    session_generation: input.sessionGeneration,
    purpose: input.purpose,
    scope: scopes.join(" "),
  };

  if (input.purpose === "gateway_operation") {
    if (!input.operation || !input.toolUseId || !input.inputHash) {
      throw new TurnAssertionError(
        "gateway_operation assertions require operation, toolUseId, and inputHash",
      );
    }
    return {
      ...base,
      operation: requiredString(input.operation, "operation"),
      tool_use_id: requiredString(input.toolUseId, "toolUseId"),
      input_hash: requiredString(input.inputHash, "inputHash"),
    };
  }
  if (input.purpose !== "harness_invoke") {
    throw new TurnAssertionError("purpose is not supported");
  }
  if (input.operation || input.toolUseId || input.inputHash) {
    throw new TurnAssertionError(
      "operation binding is valid only for gateway_operation assertions",
    );
  }
  return base;
}

export async function signTurnAssertion(
  input: TurnAssertionInput,
  signer: TurnAssertionSigner,
): Promise<string> {
  const kid = requiredString(signer.kid, "kid");
  const keyId = requiredString(signer.keyId, "keyId");
  const header = { alg: "RS256", kid, typ: "JWT" } as const;
  const claims = buildTurnAssertionClaims(input);
  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(claims);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const message = Buffer.from(signingInput, "utf8");
  if (message.byteLength > MAX_KMS_RAW_MESSAGE_BYTES) {
    throw new TurnAssertionError(
      `assertion signing input exceeds ${MAX_KMS_RAW_MESSAGE_BYTES} bytes`,
    );
  }
  const signature = await signer.sign(message, {
    keyId,
    signingAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
  });
  if (signature.byteLength === 0) {
    throw new TurnAssertionError("signer returned an empty signature");
  }
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

export function publicKeyDerToJwk(
  publicKeyDer: Uint8Array,
  kid: string,
): Record<string, string> {
  if (publicKeyDer.byteLength === 0) {
    throw new TurnAssertionError("public key is empty");
  }
  const exported = createPublicKey({
    key: Buffer.from(publicKeyDer),
    format: "der",
    type: "spki",
  }).export({ format: "jwk" });
  if (exported.kty !== "RSA" || !exported.n || !exported.e) {
    throw new TurnAssertionError("public key is not an RSA signing key");
  }
  return {
    alg: "RS256",
    e: exported.e,
    kid: requiredString(kid, "kid"),
    kty: "RSA",
    n: exported.n,
    use: "sig",
  };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function requiredString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TurnAssertionError(`${field} is required`);
  return normalized;
}
