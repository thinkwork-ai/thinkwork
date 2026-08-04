/**
 * Shared Secrets Manager JSON app-credentials loader used by the Slack and
 * Microsoft Teams connector stores. Loads a JSON secret, checks that every
 * required field is a non-empty string, maps it to the caller's credential
 * shape, and caches the result per secretId at module level.
 *
 * Credentials are secret material — never log the values, only the secret id.
 */

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export interface LoadAppCredentialsSecretInput<T> {
  /** Secrets Manager ARN or name. */
  secretId: string;
  /** Human label for error messages, e.g. "Slack" or "Teams". */
  label: string;
  /** Log tag, e.g. "slack-workspace-store" — used on the success log line. */
  logTag: string;
  /** JSON fields that must be present and non-empty. Order is preserved in messages. */
  requiredFields: readonly string[];
  /** Maps the validated JSON fields to the caller's credential shape. */
  map: (fields: Record<string, string>) => T;
}

const credentialsCache = new Map<string, unknown>();

let smClient: SecretsManagerClient | null = null;
function getClient(): SecretsManagerClient {
  if (!smClient) {
    smClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return smClient;
}

export async function loadAppCredentialsSecret<T>({
  secretId,
  label,
  logTag,
  requiredFields,
  map,
}: LoadAppCredentialsSecretInput<T>): Promise<T> {
  const cached = credentialsCache.get(secretId);
  if (cached) return cached as T;

  const res = await getClient().send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!res.SecretString) {
    throw new Error(
      `Secrets Manager returned empty SecretString for ${secretId} - populate it with ${label} app credentials.`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.SecretString) as Record<string, unknown>;
  } catch {
    const shape = requiredFields.map((field) => `"${field}":"..."`).join(",");
    throw new Error(
      `Secrets Manager value for ${secretId} is not valid JSON. Expected {${shape}}.`,
    );
  }

  const fields: Record<string, string> = {};
  for (const field of requiredFields) {
    const value = parsed[field];
    fields[field] = typeof value === "string" ? value : "";
  }
  if (requiredFields.some((field) => !fields[field])) {
    throw new Error(
      `${label} app credentials incomplete at ${secretId}. Secret must contain non-empty ${formatFieldList(
        requiredFields,
      )}.`,
    );
  }

  const credentials = map(fields);
  credentialsCache.set(secretId, credentials);
  console.log(`[${logTag}] Loaded ${label} app credentials from ${secretId}`);
  return credentials;
}

/** Test-only: clear the per-secretId credential cache and lazy client. */
export function resetAppCredentialsSecretCacheForTests(): void {
  credentialsCache.clear();
  smClient = null;
}

function formatFieldList(fields: readonly string[]): string {
  if (fields.length <= 1) return fields.join("");
  if (fields.length === 2) return `${fields[0]} and ${fields[1]}`;
  return `${fields.slice(0, -1).join(", ")}, and ${fields[fields.length - 1]}`;
}
