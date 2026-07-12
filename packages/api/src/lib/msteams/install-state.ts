/**
 * Microsoft Teams install-state + account-link token helpers.
 *
 * Mirrors the Slack oauth-state construction: JSON payload, base64url
 * encoded, HMAC-SHA256 signed (base64url), constant-time compare, expiry
 * check. The signing key is the Teams app client_secret loaded from
 * Secrets Manager — transport-only, never logged and never returned.
 */

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MSTEAMS_INSTALL_STATE_TTL_MS = 10 * 60 * 1000;
export const MSTEAMS_LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface MsteamsAppCredentials {
  appId: string;
  clientSecret: string;
}

export interface MsteamsInstallStatePayload {
  tenantId: string;
  adminUserId: string;
  nonce: string;
  expiresAt: number;
}

export interface CreateMsteamsInstallStateInput {
  tenantId: string;
  adminUserId: string;
  signingKey: string;
  nowMs?: () => number;
  nonce?: string;
}

export function createMsteamsInstallState({
  tenantId,
  adminUserId,
  signingKey,
  nowMs = Date.now,
  nonce = randomBytes(16).toString("hex"),
}: CreateMsteamsInstallStateInput): string {
  const payload: MsteamsInstallStatePayload = {
    tenantId,
    adminUserId,
    nonce,
    expiresAt: nowMs() + MSTEAMS_INSTALL_STATE_TTL_MS,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, signingKey)}`;
}

export function verifyMsteamsInstallState(
  state: string,
  signingKey: string,
  nowMs: () => number = Date.now
): MsteamsInstallStatePayload {
  const [encoded, actualSignature, extra] = state.split(".");
  if (!encoded || !actualSignature || extra !== undefined) {
    throw new Error("Teams install state is malformed");
  }

  const expectedSignature = sign(encoded, signingKey);
  if (!constantTimeEqual(actualSignature, expectedSignature)) {
    throw new Error("Teams install state signature is invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(encoded));
  } catch {
    throw new Error("Teams install state payload is invalid");
  }
  if (!isMsteamsInstallStatePayload(parsed)) {
    throw new Error("Teams install state payload is incomplete");
  }
  if (parsed.expiresAt < nowMs()) {
    throw new Error("Teams install state has expired");
  }
  return parsed;
}

export interface MsteamsAccountLinkTokenPayload {
  tenantId: string;
  entraTenantId: string;
  aadObjectId: string;
  nonce: string;
  expiresAt: number;
}

export interface CreateMsteamsAccountLinkTokenInput {
  tenantId: string;
  entraTenantId: string;
  aadObjectId: string;
  signingKey: string;
  nowMs?: () => number;
  nonce?: string;
}

export function createMsteamsAccountLinkToken({
  tenantId,
  entraTenantId,
  aadObjectId,
  signingKey,
  nowMs = Date.now,
  nonce = randomBytes(16).toString("hex"),
}: CreateMsteamsAccountLinkTokenInput): string {
  const payload: MsteamsAccountLinkTokenPayload = {
    tenantId,
    entraTenantId,
    aadObjectId,
    nonce,
    expiresAt: nowMs() + MSTEAMS_LINK_TOKEN_TTL_MS,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, signingKey)}`;
}

export interface VerifyMsteamsAccountLinkTokenOptions {
  /**
   * When provided, the token is rejected unless it was minted for exactly
   * this Entra tenant. The token is bound to the verified Entra identity —
   * callers that already know which Entra tenant/user they are acting for
   * MUST pass the expected values so a token minted for someone else can
   * never be redeemed.
   */
  expectedEntraTenantId?: string;
  /** When provided, the token must be bound to exactly this AAD object id. */
  expectedAadObjectId?: string;
  nowMs?: () => number;
}

export function verifyMsteamsAccountLinkToken(
  token: string,
  signingKey: string,
  options: VerifyMsteamsAccountLinkTokenOptions = {}
): MsteamsAccountLinkTokenPayload {
  const [encoded, actualSignature, extra] = token.split(".");
  if (!encoded || !actualSignature || extra !== undefined) {
    throw new Error("Teams account-link token is malformed");
  }

  const expectedSignature = sign(encoded, signingKey);
  if (!constantTimeEqual(actualSignature, expectedSignature)) {
    throw new Error("Teams account-link token signature is invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(encoded));
  } catch {
    throw new Error("Teams account-link token payload is invalid");
  }
  if (!isMsteamsAccountLinkTokenPayload(parsed)) {
    throw new Error("Teams account-link token payload is incomplete");
  }
  const nowMs = options.nowMs ?? Date.now;
  if (parsed.expiresAt < nowMs()) {
    throw new Error("Teams account-link token has expired");
  }
  if (
    options.expectedEntraTenantId !== undefined &&
    parsed.entraTenantId !== options.expectedEntraTenantId
  ) {
    throw new Error(
      "Teams account-link token is bound to a different Entra tenant"
    );
  }
  if (
    options.expectedAadObjectId !== undefined &&
    parsed.aadObjectId !== options.expectedAadObjectId
  ) {
    throw new Error(
      "Teams account-link token is bound to a different Teams user"
    );
  }
  return parsed;
}

let appCredentialsCache: MsteamsAppCredentials | null = null;

let smClient: SecretsManagerClient | null = null;
function getClient(): SecretsManagerClient {
  if (!smClient) {
    smClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return smClient;
}

/**
 * Loads the Teams app credentials from Secrets Manager. The client_secret
 * is the HMAC signing key for install state and account-link tokens —
 * transport-only material: never log it and never include it in responses.
 */
export async function getMsteamsAppCredentials(): Promise<MsteamsAppCredentials> {
  if (appCredentialsCache) return appCredentialsCache;

  const secretArn = msteamsAppCredentialsSecretId();

  const res = await getClient().send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  if (!res.SecretString) {
    throw new Error(
      `Secrets Manager returned empty SecretString for ${secretArn} - populate it with Teams app credentials.`
    );
  }

  let parsed: {
    app_id?: string;
    client_secret?: string;
  };
  try {
    parsed = JSON.parse(res.SecretString);
  } catch {
    throw new Error(
      `Secrets Manager value for ${secretArn} is not valid JSON. Expected {"app_id":"...","client_secret":"..."}.`
    );
  }

  const appId = parsed.app_id || "";
  const clientSecret = parsed.client_secret || "";
  if (!appId || !clientSecret) {
    throw new Error(
      `Teams app credentials incomplete at ${secretArn}. Secret must contain non-empty app_id and client_secret.`
    );
  }

  appCredentialsCache = { appId, clientSecret };
  console.log(
    `[msteams-install-state] Loaded Teams app credentials from ${secretArn}`
  );
  return appCredentialsCache;
}

/** Test-only: clear the module-level credential cache. */
export function resetMsteamsAppCredentialsCacheForTests(): void {
  appCredentialsCache = null;
  smClient = null;
}

function msteamsAppCredentialsSecretId(): string {
  const envArn = process.env.MSTEAMS_APP_CREDENTIALS_SECRET_ARN?.trim();
  if (envArn) return envArn;

  const stage = process.env.STAGE?.trim() || "dev";
  return `thinkwork/${stage}/msteams/app`;
}

function sign(encodedPayload: string, signingKey: string): string {
  return createHmac("sha256", signingKey)
    .update(encodedPayload)
    .digest("base64url");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function isMsteamsInstallStatePayload(
  value: unknown
): value is MsteamsInstallStatePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<MsteamsInstallStatePayload>;
  return (
    typeof payload.tenantId === "string" &&
    payload.tenantId.length > 0 &&
    typeof payload.adminUserId === "string" &&
    payload.adminUserId.length > 0 &&
    typeof payload.nonce === "string" &&
    payload.nonce.length > 0 &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt)
  );
}

function isMsteamsAccountLinkTokenPayload(
  value: unknown
): value is MsteamsAccountLinkTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<MsteamsAccountLinkTokenPayload>;
  return (
    typeof payload.tenantId === "string" &&
    payload.tenantId.length > 0 &&
    typeof payload.entraTenantId === "string" &&
    payload.entraTenantId.length > 0 &&
    typeof payload.aadObjectId === "string" &&
    payload.aadObjectId.length > 0 &&
    typeof payload.nonce === "string" &&
    payload.nonce.length > 0 &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt)
  );
}
