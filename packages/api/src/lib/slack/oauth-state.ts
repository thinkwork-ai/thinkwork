import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SLACK_INSTALL_STATE_TTL_MS = 10 * 60 * 1000;

export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "chat:write.customize",
  "commands",
  "files:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "mpim:read",
  "users:read",
  "users:read.email",
] as const;

export interface SlackInstallStatePayload {
  tenantId: string;
  adminUserId: string;
  nonce: string;
  expiresAt: number;
  returnUrl?: string | null;
}

export interface CreateSlackInstallStateInput {
  tenantId: string;
  adminUserId: string;
  clientSecret: string;
  returnUrl?: string | null;
  nowMs?: () => number;
  nonce?: string;
}

export function createSlackInstallState({
  tenantId,
  adminUserId,
  clientSecret,
  returnUrl = null,
  nowMs = Date.now,
  nonce = randomBytes(16).toString("hex"),
}: CreateSlackInstallStateInput): string {
  const payload: SlackInstallStatePayload = {
    tenantId,
    adminUserId,
    nonce,
    expiresAt: nowMs() + SLACK_INSTALL_STATE_TTL_MS,
    returnUrl,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, clientSecret)}`;
}

export function verifySlackInstallState(
  state: string,
  clientSecret: string,
  nowMs: () => number = Date.now,
): SlackInstallStatePayload {
  const [encoded, actualSignature, extra] = state.split(".");
  if (!encoded || !actualSignature || extra !== undefined) {
    throw new Error("Slack install state is malformed");
  }

  const expectedSignature = sign(encoded, clientSecret);
  if (!constantTimeEqual(actualSignature, expectedSignature)) {
    throw new Error("Slack install state signature is invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(encoded));
  } catch {
    throw new Error("Slack install state payload is invalid");
  }
  if (!isSlackInstallStatePayload(parsed)) {
    throw new Error("Slack install state payload is incomplete");
  }
  if (parsed.expiresAt < nowMs()) {
    throw new Error("Slack install state has expired");
  }
  return parsed;
}

export function buildSlackAuthorizeUrl(input: {
  clientId: string;
  state: string;
  redirectUri: string;
  scopes?: readonly string[];
}): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", (input.scopes ?? SLACK_BOT_SCOPES).join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function slackOAuthRedirectUri(): string {
  const configured = process.env.SLACK_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  const apiUrl = process.env.THINKWORK_API_URL?.replace(/\/+$/, "");
  if (!apiUrl) {
    throw new Error(
      "THINKWORK_API_URL or SLACK_OAUTH_REDIRECT_URI is required to start Slack install.",
    );
  }
  return `${apiUrl}/slack/oauth/install`;
}

export function sanitizeSlackInstallReturnUrl(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("returnUrl must be an absolute URL");
  }
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && isLocalhost)
  ) {
    throw new Error(
      "returnUrl must use https, except localhost development URLs",
    );
  }
  return parsed.toString();
}

function sign(encodedPayload: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret)
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

function isSlackInstallStatePayload(
  value: unknown,
): value is SlackInstallStatePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SlackInstallStatePayload>;
  return (
    typeof payload.tenantId === "string" &&
    payload.tenantId.length > 0 &&
    typeof payload.adminUserId === "string" &&
    payload.adminUserId.length > 0 &&
    typeof payload.nonce === "string" &&
    payload.nonce.length > 0 &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt) &&
    (payload.returnUrl === null ||
      payload.returnUrl === undefined ||
      typeof payload.returnUrl === "string")
  );
}
