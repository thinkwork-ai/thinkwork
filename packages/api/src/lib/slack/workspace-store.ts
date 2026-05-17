import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretCommand,
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

  const secretArn = slackAppCredentialsSecretId();

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

function slackAppCredentialsSecretId(): string {
  const envArn = process.env.SLACK_APP_CREDENTIALS_SECRET_ARN?.trim();
  if (envArn) return envArn;

  const stage = process.env.STAGE?.trim() || "dev";
  return `thinkwork/${stage}/slack/app`;
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

export async function putSlackBotToken(
  secretPath: string,
  botToken: string,
): Promise<string> {
  if (!secretPath) throw new Error("Slack bot token secret path is required.");
  if (!botToken.trim()) throw new Error("Slack bot token is required.");

  const secretString = JSON.stringify({ bot_token: botToken });
  const client = getClient();
  try {
    const created = await client.send(
      new CreateSecretCommand({
        Name: secretPath,
        SecretString: secretString,
      }),
    );
    botTokenCache.set(secretPath, botToken);
    return created.ARN || secretPath;
  } catch (err) {
    if (!isResourceExists(err)) throw err;
    await client.send(
      new UpdateSecretCommand({
        SecretId: secretPath,
        SecretString: secretString,
      }),
    );
    botTokenCache.set(secretPath, botToken);
    return secretPath;
  }
}

export async function deleteSlackBotToken(secretPath: string): Promise<void> {
  if (!secretPath) return;
  botTokenCache.delete(secretPath);
  await getClient().send(
    new DeleteSecretCommand({
      SecretId: secretPath,
      RecoveryWindowInDays: 7,
    }),
  );
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

function isResourceExists(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { name?: string }).name === "ResourceExistsException";
}
