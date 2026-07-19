import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { getConfig, getSecret } from "@thinkwork/runtime-config";

export const SUBSCRIPTION_TICKET_PREFIX = "twsub1_";
export const SUBSCRIPTION_TICKET_DOMAIN = "thinkwork.appsync.subscription.v1";
export const SUBSCRIPTION_TICKET_ALGORITHM = "Ed25519";
export const SUBSCRIPTION_TICKET_ISSUER = "thinkwork-auth";

export type SubscriptionTicketKind = "connect" | "registration";

export interface SubscriptionTicketClaims {
  version: 1;
  domain: typeof SUBSCRIPTION_TICKET_DOMAIN;
  algorithm: typeof SUBSCRIPTION_TICKET_ALGORITHM;
  keyId: string;
  issuer: typeof SUBSCRIPTION_TICKET_ISSUER;
  stage: string;
  audience: string;
  kind: SubscriptionTicketKind;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  cognitoIssuer: string;
  cognitoSub: string;
  userId: string;
  tenantId: string;
  routeClientId: string;
  appClientId: string;
  operationName?: string;
  operationHash?: string;
  resourceKind?: string;
  resourceId?: string;
}

interface SubscriptionTicketEnvelope {
  claims: SubscriptionTicketClaims;
  signature: string;
}

export interface SubscriptionTicketSigner {
  keyId: string;
  sign(claims: Omit<SubscriptionTicketClaims, "keyId">): string;
}

export interface SubscriptionTicketVerificationKey {
  keyId: string;
  publicKey: string | KeyObject;
  /** Emergency deny or completed rotation. */
  revoked?: boolean;
  /** Old overlap keys cannot verify tickets after this epoch second. */
  verifyUntil?: number;
}

export class SubscriptionTicketError extends Error {
  constructor(public readonly code: string) {
    super("Subscription ticket rejected");
    this.name = "SubscriptionTicketError";
  }
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) result[key] = sortValue(source[key]);
    }
    return result;
  }
  return value;
}

export function subscriptionTicketNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function subscriptionTicketNonceDigest(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

export function subscriptionOperationHash(input: {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        operationName: input.operationName,
        query: input.query.replace(/\s+/g, " ").trim(),
        variables: input.variables,
      }),
    )
    .digest("hex");
}

export function createSubscriptionTicketSigner(
  keyId: string,
  privateKey: string | KeyObject,
): SubscriptionTicketSigner {
  const key =
    typeof privateKey === "string"
      ? createPrivateKey(normalizePem(privateKey))
      : privateKey;
  return {
    keyId,
    sign(unsignedClaims) {
      const claims: SubscriptionTicketClaims = {
        ...unsignedClaims,
        keyId,
      };
      validateClaimShape(claims);
      const signature = edSign(
        null,
        Buffer.from(canonicalize(claims), "utf8"),
        key,
      ).toString("base64url");
      const envelope: SubscriptionTicketEnvelope = { claims, signature };
      return `${SUBSCRIPTION_TICKET_PREFIX}${Buffer.from(
        JSON.stringify(envelope),
        "utf8",
      ).toString("base64url")}`;
    },
  };
}

export function verifySubscriptionTicket(
  token: string,
  input: {
    stage: string;
    audience: string;
    keys: SubscriptionTicketVerificationKey[];
    now?: number;
  },
): SubscriptionTicketClaims {
  if (!token.startsWith(SUBSCRIPTION_TICKET_PREFIX)) {
    throw new SubscriptionTicketError("prefix_invalid");
  }
  let envelope: SubscriptionTicketEnvelope;
  try {
    envelope = JSON.parse(
      Buffer.from(
        token.slice(SUBSCRIPTION_TICKET_PREFIX.length),
        "base64url",
      ).toString("utf8"),
    ) as SubscriptionTicketEnvelope;
  } catch {
    throw new SubscriptionTicketError("encoding_invalid");
  }
  const claims = envelope?.claims;
  validateClaimShape(claims);
  if (claims.stage !== input.stage)
    throw new SubscriptionTicketError("stage_invalid");
  if (claims.audience !== input.audience)
    throw new SubscriptionTicketError("audience_invalid");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (claims.issuedAt > now + 5)
    throw new SubscriptionTicketError("issued_at_invalid");
  if (claims.expiresAt <= now) throw new SubscriptionTicketError("expired");
  const keyRecord = input.keys.find(
    (candidate) => candidate.keyId === claims.keyId,
  );
  if (!keyRecord) throw new SubscriptionTicketError("key_unknown");
  if (keyRecord.revoked) throw new SubscriptionTicketError("key_revoked");
  if (keyRecord.verifyUntil !== undefined && keyRecord.verifyUntil < now) {
    throw new SubscriptionTicketError("key_overlap_expired");
  }
  const publicKey =
    typeof keyRecord.publicKey === "string"
      ? createPublicKey(normalizePem(keyRecord.publicKey))
      : keyRecord.publicKey;
  let signature: Buffer;
  try {
    signature = Buffer.from(envelope.signature, "base64url");
  } catch {
    throw new SubscriptionTicketError("signature_invalid");
  }
  if (
    !edVerify(
      null,
      Buffer.from(canonicalize(claims), "utf8"),
      publicKey,
      signature,
    )
  ) {
    throw new SubscriptionTicketError("signature_invalid");
  }
  return claims;
}

function validateClaimShape(
  value: unknown,
): asserts value is SubscriptionTicketClaims {
  if (!value || typeof value !== "object")
    throw new SubscriptionTicketError("claims_invalid");
  const claims = value as Partial<SubscriptionTicketClaims>;
  if (
    claims.version !== 1 ||
    claims.domain !== SUBSCRIPTION_TICKET_DOMAIN ||
    claims.algorithm !== SUBSCRIPTION_TICKET_ALGORITHM ||
    claims.issuer !== SUBSCRIPTION_TICKET_ISSUER ||
    !isString(claims.keyId) ||
    !isString(claims.stage) ||
    !isString(claims.audience) ||
    !isString(claims.nonce) ||
    !isString(claims.cognitoIssuer) ||
    !isString(claims.cognitoSub) ||
    !isString(claims.userId) ||
    !isString(claims.tenantId) ||
    !isString(claims.routeClientId) ||
    !isString(claims.appClientId) ||
    !Number.isInteger(claims.issuedAt) ||
    !Number.isInteger(claims.expiresAt) ||
    (claims.kind !== "connect" && claims.kind !== "registration") ||
    claims.expiresAt! <= claims.issuedAt!
  ) {
    throw new SubscriptionTicketError("claims_invalid");
  }
  const registration = claims.kind === "registration";
  if (
    registration !==
    (isString(claims.operationName) && isString(claims.operationHash))
  ) {
    throw new SubscriptionTicketError("claims_invalid");
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizePem(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

export async function resolveSubscriptionTicketSigner(): Promise<SubscriptionTicketSigner | null> {
  const keyId = getConfig("SUBSCRIPTION_TICKET_SIGNING_KEY_ID", "").trim();
  const secretName = getConfig(
    "SUBSCRIPTION_TICKET_PRIVATE_KEY_SECRET",
    "",
  ).trim();
  if (!keyId || !secretName) return null;
  try {
    const pem = await getSecret(secretName);
    return pem ? createSubscriptionTicketSigner(keyId, pem) : null;
  } catch {
    return null;
  }
}

export function configuredSubscriptionTicketVerificationKeys(): SubscriptionTicketVerificationKey[] {
  const raw = getConfig("SUBSCRIPTION_TICKET_PUBLIC_KEYS", "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      keyId?: unknown;
      publicKey?: unknown;
      revoked?: unknown;
      verifyUntil?: unknown;
    }>;
    return parsed.flatMap((entry) =>
      isString(entry.keyId) && isString(entry.publicKey)
        ? [
            {
              keyId: entry.keyId,
              publicKey: entry.publicKey,
              revoked: entry.revoked === true,
              ...(typeof entry.verifyUntil === "number"
                ? { verifyUntil: entry.verifyUntil }
                : {}),
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}
