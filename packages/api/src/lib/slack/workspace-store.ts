import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export interface SlackAppCredentials {
  signingSecret: string;
  clientId: string;
  clientSecret: string;
}

let appCredentialsCache: SlackAppCredentials | null = null;
const botTokenCache = new Map<string, string>();

let smClient: SecretsManagerClient | null = null;
function getClient(): SecretsManagerClient {
  if (!smClient) {
    smClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return smClient;
}

export function slackBotTokenSecretPath(
  tenantId: string,
  slackTeamId: string,
): string {
  return `thinkwork/tenants/${tenantId}/slack/workspaces/${slackTeamId}/bot-token`;
}

export async function getSlackAppCredentials(): Promise<SlackAppCredentials> {
  if (appCredentialsCache) return appCredentialsCache;

  const secretArn = process.env.SLACK_APP_CREDENTIALS_SECRET_ARN || "";
  if (!secretArn) {
    throw new Error(
      "SLACK_APP_CREDENTIALS_SECRET_ARN not set - the Lambda environment is missing the Slack app credentials secret ARN.",
    );
  }

  const res = await getClient().send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!res.SecretString) {
    throw new Error(
      `Secrets Manager returned empty SecretString for ${secretArn} - populate it with Slack app credentials.`,
    );
  }

  let parsed: {
    signing_secret?: string;
    client_id?: string;
    client_secret?: string;
  };
  try {
    parsed = JSON.parse(res.SecretString);
  } catch {
    throw new Error(
      `Secrets Manager value for ${secretArn} is not valid JSON. Expected {"signing_secret":"...","client_id":"...","client_secret":"..."}.`,
    );
  }

  const signingSecret = parsed.signing_secret || "";
  const clientId = parsed.client_id || "";
  const clientSecret = parsed.client_secret || "";
  if (!signingSecret || !clientId || !clientSecret) {
    throw new Error(
      `Slack app credentials incomplete at ${secretArn}. Secret must contain non-empty signing_secret, client_id, and client_secret.`,
    );
  }

  appCredentialsCache = { signingSecret, clientId, clientSecret };
  console.log(
    `[slack-workspace-store] Loaded Slack app credentials from ${secretArn}`,
  );
  return appCredentialsCache;
}

export async function getSlackBotToken(secretPath: string): Promise<string> {
  const cached = botTokenCache.get(secretPath);
  if (cached) return cached;
  if (!secretPath) {
    throw new Error("Slack bot token secret path is required.");
  }

  const res = await getClient().send(
    new GetSecretValueCommand({ SecretId: secretPath }),
  );
  if (!res.SecretString) {
    throw new Error(
      `Secrets Manager returned empty SecretString for ${secretPath} - reinstall or repair the Slack workspace.`,
    );
  }

  const token = parseBotTokenSecret(res.SecretString);
  if (!token) {
    throw new Error(
      `Slack bot token secret at ${secretPath} is missing bot_token.`,
    );
  }

  botTokenCache.set(secretPath, token);
  return token;
}

function parseBotTokenSecret(secretString: string): string {
  const trimmed = secretString.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { bot_token?: string };
    return parsed.bot_token || "";
  } catch {
    return "";
  }
}

export function __resetSlackWorkspaceStoreCacheForTest(): void {
  appCredentialsCache = null;
  botTokenCache.clear();
  smClient = null;
}
