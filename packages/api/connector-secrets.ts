import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";

interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

type StoredConnectorSecret =
  | { type: "apiKey"; apiKey: string }
  | { type: "basic"; username: string; password: string }
  | { type: "skillEnv"; env: Record<string, string> };

type VaultAction = "put" | "get" | "delete";

type VaultRequest = {
  action?: VaultAction;
  secretRef?: string;
  payload?: StoredConnectorSecret;
};

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function authToken(headers?: Record<string, string | undefined>) {
  const auth = headers?.authorization || headers?.Authorization;
  if (!auth) return null;
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

function isStoredConnectorSecret(value: unknown): value is StoredConnectorSecret {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.type === "apiKey") return typeof v.apiKey === "string";
  if (v.type === "basic") return typeof v.username === "string" && typeof v.password === "string";
  if (v.type === "skillEnv") return typeof v.env === "object" && v.env !== null;
  return false;
}

async function putSecret(secretRef: string, payload: StoredConnectorSecret): Promise<void> {
  const secretString = JSON.stringify(payload);
  try {
    await client.send(
      new UpdateSecretCommand({
        SecretId: secretRef,
        SecretString: secretString,
      }),
    );
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      await client.send(
        new CreateSecretCommand({
          Name: secretRef,
          SecretString: secretString,
        }),
      );
      return;
    }
    throw err;
  }
}

async function getSecret(secretRef: string): Promise<StoredConnectorSecret | null> {
  try {
    const result = await client.send(new GetSecretValueCommand({ SecretId: secretRef }));
    if (!result.SecretString) return null;

    const parsed = JSON.parse(result.SecretString);
    return isStoredConnectorSecret(parsed) ? parsed : null;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return null;
    throw err;
  }
}

async function deleteSecret(secretRef: string): Promise<void> {
  try {
    await client.send(
      new DeleteSecretCommand({
        SecretId: secretRef,
        ForceDeleteWithoutRecovery: true,
      }),
    );
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return;
    throw err;
  }
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown error";
  const name = (error as { name?: string }).name || "Error";
  const message = (error as { message?: string }).message || "";
  return message ? `${name}: ${message}` : name;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const expectedSecret = process.env.API_AUTH_SECRET;
  const token = authToken(event.headers);
  if (!expectedSecret || !token || token !== expectedSecret) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  let body: VaultRequest;
  try {
    body = event.body ? (JSON.parse(event.body) as VaultRequest) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const action = body.action;
  const secretRef = body.secretRef;
  if (!action || !secretRef) {
    return json(400, { ok: false, error: "action and secretRef are required" });
  }

  try {
    if (action === "put") {
      if (!isStoredConnectorSecret(body.payload)) {
        return json(400, { ok: false, error: "payload is required for put" });
      }
      await putSecret(secretRef, body.payload);
      return json(200, { ok: true });
    }

    if (action === "get") {
      const secret = await getSecret(secretRef);
      return json(200, { ok: true, secret });
    }

    if (action === "delete") {
      await deleteSecret(secretRef);
      return json(200, { ok: true });
    }

    return json(400, { ok: false, error: "Unsupported action" });
  } catch (error: unknown) {
    return json(500, { ok: false, error: `Vault operation failed: ${errorMessage(error)}` });
  }
}
