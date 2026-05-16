import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { slackWorkspaces } from "@thinkwork/database-pg/schema";
import { db } from "../../lib/db.js";
import { error, json } from "../../lib/response.js";
import {
  getSlackAppCredentials,
  getSlackBotToken,
} from "../../lib/slack/workspace-store.js";

const SLACK_SIGNATURE_VERSION = "v0";
const REPLAY_WINDOW_SECONDS = 5 * 60;

export interface SlackWorkspaceContext {
  tenantId: string;
  slackTeamId: string;
  slackTeamName: string | null;
  botUserId: string;
  botTokenSecretPath: string;
  appId: string;
  status: string;
}

export interface SlackHandlerArgs {
  event: APIGatewayProxyEventV2;
  headers: Record<string, string>;
  rawBody: Buffer;
  rawBodyText: string;
  workspace: SlackWorkspaceContext;
  botToken: string;
}

export interface SlackHandlerConfig {
  name: string;
  extractTeamId(args: {
    event: APIGatewayProxyEventV2;
    headers: Record<string, string>;
    rawBody: Buffer;
    rawBodyText: string;
  }): string | null;
  preDispatch?(args: {
    event: APIGatewayProxyEventV2;
    headers: Record<string, string>;
    rawBody: Buffer;
    rawBodyText: string;
  }): Promise<APIGatewayProxyStructuredResultV2 | null>;
  dispatch(args: SlackHandlerArgs): Promise<APIGatewayProxyStructuredResultV2>;
  allowedMethods?: string[];
}

export interface SlackSignatureVerificationInput {
  headers: Record<string, string>;
  rawBody: Buffer;
  signingSecret: string;
  nowMs?: () => number;
  timingSafeEqualFn?: typeof timingSafeEqual;
}

export type SlackSignatureVerificationResult =
  | { ok: true }
  | { ok: false; status: 401; message: string };

export interface SlackHandlerDeps {
  getRawBody?: typeof getRawBody;
  verifySignature?: (
    input: SlackSignatureVerificationInput,
  ) => SlackSignatureVerificationResult;
  lookupWorkspace?: (
    slackTeamId: string,
  ) => Promise<SlackWorkspaceContext | null>;
  loadBotToken?: (secretPath: string) => Promise<string>;
  loadSigningSecret?: () => Promise<string>;
  nowMs?: () => number;
}

export function createSlackHandler(
  config: SlackHandlerConfig,
  deps: SlackHandlerDeps = {},
) {
  const allowedMethods = new Set(config.allowedMethods ?? ["POST"]);
  const readRawBody = deps.getRawBody ?? getRawBody;
  const verifySignature = deps.verifySignature ?? verifySlackSignature;
  const lookupWorkspace = deps.lookupWorkspace ?? defaultLookupWorkspace;
  const loadBotToken = deps.loadBotToken ?? getSlackBotToken;
  const loadSigningSecret =
    deps.loadSigningSecret ??
    (async () => (await getSlackAppCredentials()).signingSecret);

  return async function handleSlack(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const method = event.requestContext.http.method;
    if (!allowedMethods.has(method)) {
      return error("Method not allowed", 405);
    }

    const headers = normalizeHeaders(event.headers);
    const rawBody = readRawBody(event);
    const rawBodyText = rawBody.toString("utf8");
    const signingSecret = await loadSigningSecret();
    const signatureResult = verifySignature({
      headers,
      rawBody,
      signingSecret,
      nowMs: deps.nowMs,
    });
    if (!signatureResult.ok) {
      return error(signatureResult.message, signatureResult.status);
    }

    if (headers["x-slack-retry-num"]) {
      console.log(
        `[slack:${config.name}] retry short-circuit retry=${headers["x-slack-retry-num"]} reason=${headers["x-slack-retry-reason"] ?? "unknown"}`,
      );
      return json({ ok: true, retried: true });
    }

    const earlyResponse = await config.preDispatch?.({
      event,
      headers,
      rawBody,
      rawBodyText,
    });
    if (earlyResponse) return earlyResponse;

    const slackTeamId = config.extractTeamId({
      event,
      headers,
      rawBody,
      rawBodyText,
    });
    if (!slackTeamId) {
      return error("Slack team_id is required", 400);
    }

    const workspace = await lookupWorkspace(slackTeamId);
    if (!workspace) {
      return error("Slack workspace is not installed", 404);
    }

    const botToken = await loadBotToken(workspace.botTokenSecretPath);
    return config.dispatch({
      event,
      headers,
      rawBody,
      rawBodyText,
      workspace,
      botToken,
    });
  };
}

export function getRawBody(event: APIGatewayProxyEventV2): Buffer {
  if (event.isBase64Encoded) {
    return Buffer.from(event.body || "", "base64");
  }
  return Buffer.from(event.body || "", "utf8");
}

export function normalizeHeaders(
  headers: APIGatewayProxyEventV2["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
  }
  return out;
}

export function computeSlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: Buffer,
): string {
  return `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", signingSecret)
    .update(`${SLACK_SIGNATURE_VERSION}:${timestamp}:`)
    .update(rawBody)
    .digest("hex")}`;
}

export function verifySlackSignature({
  headers,
  rawBody,
  signingSecret,
  nowMs = Date.now,
  timingSafeEqualFn = timingSafeEqual,
}: SlackSignatureVerificationInput): SlackSignatureVerificationResult {
  const timestamp = headers["x-slack-request-timestamp"] ?? "";
  const signature = headers["x-slack-signature"] ?? "";
  if (!timestamp || !signature) {
    return { ok: false, status: 401, message: "Slack signature is required" };
  }
  if (!signature.startsWith(`${SLACK_SIGNATURE_VERSION}=`)) {
    return { ok: false, status: 401, message: "Slack signature is invalid" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds)) {
    return { ok: false, status: 401, message: "Slack timestamp is invalid" };
  }

  const nowSeconds = Math.floor(nowMs() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > REPLAY_WINDOW_SECONDS) {
    return {
      ok: false,
      status: 401,
      message: "Slack request timestamp is outside the replay window",
    };
  }

  const expected = computeSlackSignature(signingSecret, timestamp, rawBody);
  if (!constantTimeEqual(signature, expected, timingSafeEqualFn)) {
    return { ok: false, status: 401, message: "Slack signature is invalid" };
  }
  return { ok: true };
}

function constantTimeEqual(
  actual: string,
  expected: string,
  timingSafeEqualFn: typeof timingSafeEqual,
): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqualFn(actualBuffer, expectedBuffer);
}

async function defaultLookupWorkspace(
  slackTeamId: string,
): Promise<SlackWorkspaceContext | null> {
  const [row] = await db
    .select({
      tenantId: slackWorkspaces.tenant_id,
      slackTeamId: slackWorkspaces.slack_team_id,
      slackTeamName: slackWorkspaces.slack_team_name,
      botUserId: slackWorkspaces.bot_user_id,
      botTokenSecretPath: slackWorkspaces.bot_token_secret_path,
      appId: slackWorkspaces.app_id,
      status: slackWorkspaces.status,
    })
    .from(slackWorkspaces)
    .where(
      and(
        eq(slackWorkspaces.slack_team_id, slackTeamId),
        eq(slackWorkspaces.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}
