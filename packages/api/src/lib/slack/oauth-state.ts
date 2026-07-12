import { getConfig } from "@thinkwork/runtime-config";
import { randomBytes } from "node:crypto";
import { createSignedPayload, verifySignedPayload } from "../signed-payload.js";

export const SLACK_INSTALL_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Minimum bot scopes for the shipped Slack surfaces: mention/DM events,
 * bounded thread-context reads (conversations.replies), attachment file
 * reads, and chat.postMessage acknowledgements/link prompts/final replies.
 * Every scope here maps to a Web API call or event subscription the code
 * actually makes; scopes for removed or forbidden behaviors (slash
 * commands, customized attribution, email-based matching, unused metadata
 * reads) are intentionally absent (THINK-84 U3). Existing installs retain
 * previously granted scopes until the workspace is reinstalled.
 */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  // Powers the ephemeral "is thinking…" typing status in DMs
  // (assistant.threads.setStatus). Existing installs must reinstall the
  // workspace to grant it; until then the DM path falls back to the
  // in-place placeholder message used for channel mentions.
  "assistant:write",
  "channels:history",
  "chat:write",
  "files:read",
  "groups:history",
  "im:history",
  "mpim:history",
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
  return createSignedPayload(payload, clientSecret);
}

export function verifySlackInstallState(
  state: string,
  clientSecret: string,
  nowMs: () => number = Date.now,
): SlackInstallStatePayload {
  return verifySignedPayload(state, clientSecret, {
    validate: isSlackInstallStatePayload,
    errorPrefix: "Slack install state",
    expiresAt: (payload) => payload.expiresAt,
    nowMs,
  });
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
  const apiUrl = getConfig("THINKWORK_API_URL")?.replace(/\/+$/, "");
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
