import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";

export type TenantCredentialKind =
  | "api_key"
  | "bearer_token"
  | "basic_auth"
  | "soap_partner"
  | "webhook_signing_secret"
  | "json";

export type TenantCredentialStatus = "active" | "disabled" | "deleted";

export type TenantCredentialSecretPayload = Record<string, unknown>;

const REQUIRED_FIELDS: Record<TenantCredentialKind, readonly string[]> = {
  api_key: ["apiKey"],
  bearer_token: ["token"],
  basic_auth: ["username", "password"],
  soap_partner: ["apiUrl", "username", "password", "partnerId"],
  webhook_signing_secret: ["secret"],
  json: [],
};

let smClient: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
  if (!smClient) {
    smClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return smClient;
}

export function tenantCredentialSecretName(input: {
  stage?: string | null;
  tenantId: string;
  credentialId: string;
}): string {
  const stage = input.stage || process.env.STAGE || "dev";
  return `thinkwork/${stage}/routines/${input.tenantId}/credentials/${input.credentialId}`;
}

export function normalizeCredentialSecret(
  kind: TenantCredentialKind,
  raw: unknown,
): TenantCredentialSecretPayload {
  const payload = parseAwsJsonObject(raw, "secretJson");
  const missing = REQUIRED_FIELDS[kind].filter((field) => {
    const value = payload[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `Credential secret for ${kind} is missing required field(s): ${missing.join(
        ", ",
      )}`,
    );
  }
  return payload;
}

export function parseAwsJsonObject(
  raw: unknown,
  fieldName: string,
): Record<string, unknown> {
  let parsed = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `${fieldName} must be valid JSON: ${(err as Error).message}`,
      );
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export async function putTenantCredentialSecret(input: {
  secretName: string;
  payload: TenantCredentialSecretPayload;
}): Promise<string> {
  const secretString = JSON.stringify(input.payload);
  const client = getClient();
  try {
    const created = await client.send(
      new CreateSecretCommand({
        Name: input.secretName,
        SecretString: secretString,
      }),
    );
    return created.ARN || input.secretName;
  } catch (err) {
    if (!isResourceExists(err)) throw err;
    await client.send(
      new UpdateSecretCommand({
        SecretId: input.secretName,
        SecretString: secretString,
      }),
    );
    return input.secretName;
  }
}

export async function rotateTenantCredentialSecret(input: {
  secretRef: string;
  payload: TenantCredentialSecretPayload;
}): Promise<void> {
  await getClient().send(
    new UpdateSecretCommand({
      SecretId: input.secretRef,
      SecretString: JSON.stringify(input.payload),
    }),
  );
}

export async function readTenantCredentialSecret(
  secretRef: string,
): Promise<TenantCredentialSecretPayload> {
  const result = await getClient().send(
    new GetSecretValueCommand({ SecretId: secretRef }),
  );
  if (!result.SecretString) {
    throw new Error(`Secrets Manager returned empty SecretString for ${secretRef}`);
  }
  return parseAwsJsonObject(result.SecretString, "SecretString");
}

export async function scheduleTenantCredentialSecretDeletion(
  secretRef: string,
): Promise<void> {
  await getClient().send(
    new DeleteSecretCommand({
      SecretId: secretRef,
      RecoveryWindowInDays: 7,
    }),
  );
}

export function __resetTenantCredentialSecretStoreForTest(): void {
  smClient = null;
}

function isResourceExists(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { name?: string }).name === "ResourceExistsException";
}
