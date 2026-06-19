import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { getConfig } from "@thinkwork/runtime-config";
import { authenticate } from "../lib/cognito-auth.js";
import { error, handleCors, json, unauthorized } from "../lib/response.js";

const WORKOS_API_BASE_URL = "https://api.workos.com";
const WORKOS_NOT_FOUND = "workos_not_found";

interface CognitoIdentity {
  providerName?: unknown;
  providerType?: unknown;
  userId?: unknown;
}

interface WorkosListSessionsResponse {
  data?: Array<{ id?: unknown; status?: unknown }>;
  list_metadata?: { after?: unknown };
}

interface WorkosLogoutResult {
  revokedSessions: number;
  revokedAuthorizedApplications: number;
}

let cachedApiKey: string | null = null;
let smClient: SecretsManagerClient | null = null;

function getSecretsManagerClient(): SecretsManagerClient {
  if (!smClient) {
    smClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return smClient;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const headers = event.headers as Record<string, string | undefined>;
  const auth = await authenticate(headers);
  if (!auth || auth.authType !== "cognito") {
    return unauthorized("Authentication required");
  }

  const token = extractBearerToken(headers);
  const payload = token ? decodeJwtPayload(token) : null;
  const workosUserId = payload ? findWorkosUserId(payload) : null;
  if (!workosUserId) {
    console.log("[auth-workos-logout] No WorkOS identity in Cognito token");
    return json({ revoked: 0, reason: "no_workos_identity" });
  }
  console.log("[auth-workos-logout] Revoking WorkOS access", {
    workosUserId,
  });

  let apiKey: string;
  try {
    apiKey = await getWorkosApiKey();
  } catch (err) {
    console.error("[auth-workos-logout] WorkOS API key unavailable", {
      message: (err as Error).message,
    });
    return error("WorkOS logout is not configured", 503);
  }

  try {
    const revoked = await revokeWorkosAccess(workosUserId, apiKey);
    console.log("[auth-workos-logout] Revoked WorkOS access", {
      workosUserId,
      ...revoked,
    });
    return json({ revoked, workosUserId });
  } catch (err) {
    console.error("[auth-workos-logout] WorkOS access revocation failed", {
      workosUserId,
      message: (err as Error).message,
    });
    return error("WorkOS session revocation failed", 502);
  }
}

function extractBearerToken(
  headers: Record<string, string | undefined>,
): string | null {
  const authHeader = headers.authorization || headers.Authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function findWorkosUserId(
  claims: Record<string, unknown>,
): string | null {
  const identities = parseIdentities(claims.identities);
  const namedWorkos = identities.find((identity) =>
    String(identity.providerName ?? "").toLowerCase().includes("workos"),
  );
  const fallbackOidc = identities.find(
    (identity) =>
      identity.providerType === "OIDC" &&
      typeof identity.userId === "string" &&
      identity.userId.startsWith("user_"),
  );
  const userId = namedWorkos?.userId ?? fallbackOidc?.userId;
  return typeof userId === "string" && userId.startsWith("user_")
    ? userId
    : null;
}

function parseIdentities(raw: unknown): CognitoIdentity[] {
  if (Array.isArray(raw)) return raw.filter(isObject) as CognitoIdentity[];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed.filter(isObject) as CognitoIdentity[])
      : [];
  } catch {
    return [];
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getWorkosApiKey(): Promise<string> {
  const direct = getConfig("WORKOS_API_KEY") || process.env.WORKOS_API_KEY || "";
  if (direct.trim()) return direct.trim();
  if (cachedApiKey) return cachedApiKey;

  const secretArn =
    process.env.WORKOS_API_KEY_SECRET_ARN ||
    getConfig("WORKOS_API_KEY_SECRET_ARN") ||
    "";
  if (!secretArn) {
    throw new Error("WORKOS_API_KEY or WORKOS_API_KEY_SECRET_ARN is required");
  }

  const result = await getSecretsManagerClient().send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!result.SecretString) {
    throw new Error(`Secrets Manager returned empty SecretString for ${secretArn}`);
  }

  const parsed = parseApiKeySecret(result.SecretString);
  if (!parsed) {
    throw new Error(
      `WorkOS API key secret ${secretArn} must be plaintext or JSON with api_key`,
    );
  }
  cachedApiKey = parsed;
  return parsed;
}

function parseApiKeySecret(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as {
      api_key?: unknown;
      secret_key?: unknown;
      key?: unknown;
    };
    for (const candidate of [parsed.api_key, parsed.secret_key, parsed.key]) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function revokeWorkosAccess(
  workosUserId: string,
  apiKey: string,
): Promise<WorkosLogoutResult> {
  const [revokedSessions, revokedAuthorizedApplications] = await Promise.all([
    revokeActiveWorkosSessions(workosUserId, apiKey),
    deleteWorkosAuthorizedApplication(workosUserId, apiKey),
  ]);
  return { revokedSessions, revokedAuthorizedApplications };
}

async function revokeActiveWorkosSessions(
  workosUserId: string,
  apiKey: string,
): Promise<number> {
  const sessions = await listActiveWorkosSessionIds(workosUserId, apiKey);
  console.log("[auth-workos-logout] Listed WorkOS sessions", {
    workosUserId,
    sessions: sessions.length,
  });
  let revoked = 0;
  for (const sessionId of sessions) {
    await workosFetch("/user_management/sessions/revoke", apiKey, {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
    });
    revoked += 1;
  }
  return revoked;
}

async function deleteWorkosAuthorizedApplication(
  workosUserId: string,
  apiKey: string,
): Promise<number> {
  const applicationId = getWorkosConnectApplicationId();
  if (!applicationId) return 0;

  const deleted = await workosFetch(
    `/user_management/users/${encodeURIComponent(
      workosUserId,
    )}/authorized_applications/${encodeURIComponent(applicationId)}`,
    apiKey,
    { method: "DELETE" },
    { notFoundValue: WORKOS_NOT_FOUND },
  );
  return deleted === WORKOS_NOT_FOUND ? 0 : 1;
}

function getWorkosConnectApplicationId(): string | null {
  const value =
    getConfig("WORKOS_CONNECT_APPLICATION_ID") ||
    process.env.WORKOS_CONNECT_APPLICATION_ID ||
    "";
  const trimmed = value.trim();
  return trimmed.startsWith("connect_app_") ? trimmed : null;
}

async function listActiveWorkosSessionIds(
  workosUserId: string,
  apiKey: string,
): Promise<string[]> {
  const sessionIds: string[] = [];
  let after: string | null = null;

  do {
    const params = new URLSearchParams({ order: "desc", limit: "100" });
    if (after) params.set("after", after);
    const response = (await workosFetch(
      `/user_management/users/${encodeURIComponent(
        workosUserId,
      )}/sessions?${params.toString()}`,
      apiKey,
      { method: "GET" },
    )) as WorkosListSessionsResponse;

    for (const session of response.data ?? []) {
      if (typeof session.id === "string") sessionIds.push(session.id);
    }
    after =
      typeof response.list_metadata?.after === "string"
        ? response.list_metadata.after
        : null;
  } while (after);

  return sessionIds;
}

async function workosFetch(
  path: string,
  apiKey: string,
  init: RequestInit,
  options: { notFoundValue?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(`${WORKOS_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? tryParseJson(text) : null;
  if (response.status === 404 && "notFoundValue" in options) {
    return options.notFoundValue;
  }
  if (!response.ok) {
    throw new Error(
      `WorkOS API ${response.status}: ${typeof body === "string" ? body : text}`,
    );
  }
  return body;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function __resetWorkosLogoutCacheForTest(): void {
  cachedApiKey = null;
  smClient = null;
}
