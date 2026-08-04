/**
 * Microsoft Teams install-state + account-link token helpers.
 *
 * Mirrors the Slack oauth-state construction: JSON payload, base64url
 * encoded, HMAC-SHA256 signed (base64url), constant-time compare, expiry
 * check. The signing key is the Teams app client_secret loaded from
 * Secrets Manager — transport-only, never logged and never returned.
 */

import { randomBytes } from "node:crypto";
import {
  loadAppCredentialsSecret,
  resetAppCredentialsSecretCacheForTests,
} from "../app-credentials-secret.js";
import { createSignedPayload, verifySignedPayload } from "../signed-payload.js";

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
  return createSignedPayload(payload, signingKey);
}

export function verifyMsteamsInstallState(
  state: string,
  signingKey: string,
  nowMs: () => number = Date.now,
): MsteamsInstallStatePayload {
  return verifySignedPayload(state, signingKey, {
    validate: isMsteamsInstallStatePayload,
    errorPrefix: "Teams install state",
    expiresAt: (payload) => payload.expiresAt,
    nowMs,
  });
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
  return createSignedPayload(payload, signingKey);
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
  options: VerifyMsteamsAccountLinkTokenOptions = {},
): MsteamsAccountLinkTokenPayload {
  const parsed = verifySignedPayload(token, signingKey, {
    validate: isMsteamsAccountLinkTokenPayload,
    errorPrefix: "Teams account-link token",
    expiresAt: (payload) => payload.expiresAt,
    nowMs: options.nowMs,
  });
  if (
    options.expectedEntraTenantId !== undefined &&
    parsed.entraTenantId !== options.expectedEntraTenantId
  ) {
    throw new Error(
      "Teams account-link token is bound to a different Entra tenant",
    );
  }
  if (
    options.expectedAadObjectId !== undefined &&
    parsed.aadObjectId !== options.expectedAadObjectId
  ) {
    throw new Error(
      "Teams account-link token is bound to a different Teams user",
    );
  }
  return parsed;
}

/**
 * Loads the Teams app credentials from Secrets Manager. The client_secret
 * is the HMAC signing key for install state and account-link tokens —
 * transport-only material: never log it and never include it in responses.
 */
export async function getMsteamsAppCredentials(): Promise<MsteamsAppCredentials> {
  return loadAppCredentialsSecret({
    secretId: msteamsAppCredentialsSecretId(),
    label: "Teams",
    logTag: "msteams-install-state",
    requiredFields: ["app_id", "client_secret"],
    map: (fields) => ({
      appId: fields.app_id,
      clientSecret: fields.client_secret,
    }),
  });
}

/** Test-only: clear the module-level credential cache. */
export function resetMsteamsAppCredentialsCacheForTests(): void {
  resetAppCredentialsSecretCacheForTests();
}

export type MsteamsConsentVerification =
  | { granted: true }
  | { granted: false; reason: string };

/**
 * Verify with Microsoft that admin consent was actually granted for the
 * ThinkWork application in the reported Entra tenant. The consent-callback
 * query parameters (admin_consent, tenant) are attacker-forgeable — anyone
 * holding the consent URL can fabricate them — so activation must be gated
 * on a real client-credentials token grant against that tenant: it succeeds
 * only when the application has been consented there.
 *
 * The acquired token is discarded; only the grant outcome matters.
 */
export async function verifyMsteamsAdminConsent(input: {
  entraTenantId: string;
  appId: string;
  clientSecret: string;
  fetchFn?: typeof fetch;
}): Promise<MsteamsConsentVerification> {
  const doFetch = input.fetchFn ?? fetch;
  if (!/^[0-9a-zA-Z.-]+$/.test(input.entraTenantId)) {
    return { granted: false, reason: "invalid_tenant_id" };
  }
  const url = `https://login.microsoftonline.com/${encodeURIComponent(
    input.entraTenantId,
  )}/oauth2/v2.0/token`;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: input.appId,
        client_secret: input.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
    });
  } catch {
    return { granted: false, reason: "token_endpoint_unreachable" };
  }

  if (response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { granted: false, reason: "malformed_token_response" };
    }
    const accessToken = (body as { access_token?: unknown }).access_token;
    return typeof accessToken === "string" && accessToken.length > 0
      ? { granted: true }
      : { granted: false, reason: "malformed_token_response" };
  }

  // AADSTS65001 (consent required) / AADSTS700016 (app not found in tenant)
  // and friends all arrive as OAuth error bodies; surface only the error
  // code, never the description (it can echo attacker-controlled input).
  try {
    const body = (await response.json()) as { error?: unknown };
    return {
      granted: false,
      reason: typeof body.error === "string" ? body.error : "consent_denied",
    };
  } catch {
    return { granted: false, reason: `http_${response.status}` };
  }
}

function msteamsAppCredentialsSecretId(): string {
  const envArn = process.env.MSTEAMS_APP_CREDENTIALS_SECRET_ARN?.trim();
  if (envArn) return envArn;

  const stage = process.env.STAGE?.trim() || "dev";
  return `thinkwork/${stage}/msteams/app`;
}

function isMsteamsInstallStatePayload(
  value: unknown,
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
  value: unknown,
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
