import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq, sql } from "drizzle-orm";
import { slackWorkspaces } from "@thinkwork/database-pg/schema";
import { db } from "../../lib/db.js";
import { error, json } from "../../lib/response.js";
import {
  slackBotTokenSecretPath,
  getSlackAppCredentials,
  putSlackBotToken,
  deleteSlackBotToken,
  type SlackAppCredentials,
} from "../../lib/slack/workspace-store.js";
import {
  slackOAuthRedirectUri,
  verifySlackInstallState,
  type SlackInstallStatePayload,
} from "../../lib/slack/oauth-state.js";

interface SlackOAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: {
    id?: string;
    name?: string;
  };
}

export interface SlackOAuthInstalledWorkspace {
  id: string;
  tenantId: string;
  slackTeamId: string;
  slackTeamName: string | null;
  botUserId: string;
  botTokenSecretPath: string;
  appId: string;
  installedByUserId: string;
  installedAt: string;
  status: string;
}

interface SlackOAuthInstallDeps {
  getCredentials?: () => Promise<SlackAppCredentials>;
  exchangeCode?: (input: {
    code: string;
    redirectUri: string;
    credentials: SlackAppCredentials;
  }) => Promise<SlackOAuthAccessResponse>;
  findWorkspaceTenant?: (slackTeamId: string) => Promise<string | null>;
  putBotToken?: (secretPath: string, botToken: string) => Promise<string>;
  deleteBotToken?: (secretPath: string) => Promise<void>;
  upsertWorkspace?: (input: {
    state: SlackInstallStatePayload;
    slackTeamId: string;
    slackTeamName: string | null;
    botUserId: string;
    botTokenSecretPath: string;
    appId: string;
  }) => Promise<SlackOAuthInstalledWorkspace>;
  nowMs?: () => number;
  redirectUri?: string;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleSlackOAuthInstall(event);
}

export async function handleSlackOAuthInstall(
  event: APIGatewayProxyEventV2,
  deps: SlackOAuthInstallDeps = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method !== "GET" && method !== "POST") {
    return error("Method not allowed", 405);
  }

  const params = readCallbackParams(event);
  const stateParam = params.get("state") || "";
  const code = params.get("code") || "";
  if (!stateParam) {
    return error("Slack OAuth state is required", 400);
  }

  const getCredentials = deps.getCredentials ?? getSlackAppCredentials;
  const credentials = await getCredentials();

  let state: SlackInstallStatePayload;
  try {
    state = verifySlackInstallState(
      stateParam,
      credentials.clientSecret,
      deps.nowMs,
    );
  } catch (err) {
    return error((err as Error).message, 400);
  }

  if (params.get("error")) {
    return finishInstall(state.returnUrl ?? null, {
      slackInstall: "error",
      error: params.get("error") || "slack_error",
    });
  }
  if (!code) {
    return error("Slack OAuth code is required", 400);
  }

  const redirectUri = deps.redirectUri ?? slackOAuthRedirectUri();
  const exchangeCode = deps.exchangeCode ?? exchangeSlackOAuthCode;
  const exchange = await exchangeCode({ code, redirectUri, credentials });
  if (!exchange.ok) {
    return finishInstall(state.returnUrl ?? null, {
      slackInstall: "error",
      error: exchange.error || "oauth_failed",
    });
  }

  const slackTeamId = exchange.team?.id || "";
  const botToken = exchange.access_token || "";
  const botUserId = exchange.bot_user_id || "";
  const appId = exchange.app_id || "";
  if (!slackTeamId || !botToken || !botUserId || !appId) {
    return finishInstall(state.returnUrl ?? null, {
      slackInstall: "error",
      error: "oauth_response_incomplete",
    });
  }

  const findWorkspaceTenant =
    deps.findWorkspaceTenant ?? defaultFindWorkspaceTenant;
  const existingTenantId = await findWorkspaceTenant(slackTeamId);
  if (existingTenantId && existingTenantId !== state.tenantId) {
    return finishInstall(state.returnUrl ?? null, {
      slackInstall: "error",
      error: "workspace_already_installed",
    });
  }

  const secretPath = slackBotTokenSecretPath(state.tenantId, slackTeamId);
  const putBotToken = deps.putBotToken ?? putSlackBotToken;
  const deleteBotToken = deps.deleteBotToken ?? deleteSlackBotToken;
  const upsertWorkspace = deps.upsertWorkspace ?? defaultUpsertWorkspace;

  await putBotToken(secretPath, botToken);
  try {
    await upsertWorkspace({
      state,
      slackTeamId,
      slackTeamName: exchange.team?.name || null,
      botUserId,
      botTokenSecretPath: secretPath,
      appId,
    });
  } catch (err) {
    await deleteBotToken(secretPath).catch((cleanupErr) => {
      console.error(
        "[slack-oauth-install] Failed to clean up bot token after DB failure",
        cleanupErr,
      );
    });
    throw err;
  }

  return finishInstall(state.returnUrl ?? null, {
    slackInstall: "success",
    team: slackTeamId,
  });
}

async function exchangeSlackOAuthCode(input: {
  code: string;
  redirectUri: string;
  credentials: SlackAppCredentials;
}): Promise<SlackOAuthAccessResponse> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.credentials.clientId,
    client_secret: input.credentials.clientSecret,
    redirect_uri: input.redirectUri,
  });
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return (await response.json()) as SlackOAuthAccessResponse;
}

async function defaultFindWorkspaceTenant(
  slackTeamId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: slackWorkspaces.tenant_id })
    .from(slackWorkspaces)
    .where(eq(slackWorkspaces.slack_team_id, slackTeamId))
    .limit(1);
  return row?.tenantId ?? null;
}

async function defaultUpsertWorkspace(input: {
  state: SlackInstallStatePayload;
  slackTeamId: string;
  slackTeamName: string | null;
  botUserId: string;
  botTokenSecretPath: string;
  appId: string;
}): Promise<SlackOAuthInstalledWorkspace> {
  const [row] = await db
    .insert(slackWorkspaces)
    .values({
      tenant_id: input.state.tenantId,
      slack_team_id: input.slackTeamId,
      slack_team_name: input.slackTeamName,
      bot_user_id: input.botUserId,
      bot_token_secret_path: input.botTokenSecretPath,
      app_id: input.appId,
      installed_by_user_id: input.state.adminUserId,
      status: "active",
      installed_at: sql`now()`,
      uninstalled_at: null,
    })
    .onConflictDoUpdate({
      target: slackWorkspaces.slack_team_id,
      set: {
        slack_team_name: input.slackTeamName,
        bot_user_id: input.botUserId,
        bot_token_secret_path: input.botTokenSecretPath,
        app_id: input.appId,
        installed_by_user_id: input.state.adminUserId,
        status: "active",
        installed_at: sql`now()`,
        uninstalled_at: null,
        updated_at: sql`now()`,
      },
      where: and(
        eq(slackWorkspaces.slack_team_id, input.slackTeamId),
        eq(slackWorkspaces.tenant_id, input.state.tenantId),
      ),
    })
    .returning();

  if (!row) {
    throw new Error("Slack workspace install could not be persisted");
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slackTeamId: row.slack_team_id,
    slackTeamName: row.slack_team_name,
    botUserId: row.bot_user_id,
    botTokenSecretPath: row.bot_token_secret_path,
    appId: row.app_id,
    installedByUserId: row.installed_by_user_id || input.state.adminUserId,
    installedAt: row.installed_at.toISOString(),
    status: row.status,
  };
}

function readCallbackParams(event: APIGatewayProxyEventV2): URLSearchParams {
  if (event.requestContext.http.method === "GET") {
    return new URLSearchParams(event.rawQueryString ?? "");
  }
  const body = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";
  return new URLSearchParams(body);
}

function finishInstall(
  returnUrl: string | null,
  params: Record<string, string>,
): APIGatewayProxyStructuredResultV2 {
  if (returnUrl) {
    const target = new URL(returnUrl);
    for (const [key, value] of Object.entries(params)) {
      target.searchParams.set(key, value);
    }
    return {
      statusCode: 302,
      headers: { Location: target.toString() },
      body: "",
    };
  }
  return json(params);
}
