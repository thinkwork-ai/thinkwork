/**
 * Revoke the current Cognito route's refresh token.
 *
 * POST /api/auth/revoke
 * body: { refreshToken: string }
 *
 * The authenticated ID token supplies the exact admitted app client. The
 * caller cannot choose a different client id, and the opaque refresh token is
 * never logged or stored.
 */

import {
  CognitoIdentityProviderClient,
  RevokeTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { authenticate } from "../lib/cognito-auth.js";
import { error, handleCors, json, unauthorized } from "../lib/response.js";

const cognito = new CognitoIdentityProviderClient({});
const WINDOW_MS = 60_000;
const attempts = new Map<string, { count: number; expiresAt: number }>();

function limitPerMinute(): number {
  const configured = Number.parseInt(
    process.env.AUTH_REVOKE_RATE_LIMIT_PER_MINUTE ?? "12",
    10,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 12;
}

function rateLimitAllows(key: string, now = Date.now()): boolean {
  const current = attempts.get(key);
  if (!current || current.expiresAt <= now) {
    attempts.set(key, { count: 1, expiresAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= limitPerMinute()) return false;
  current.count += 1;
  return true;
}

function parseRefreshToken(event: APIGatewayProxyEventV2): string | null {
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const body = JSON.parse(raw) as { refreshToken?: unknown };
    if (
      typeof body.refreshToken !== "string" ||
      body.refreshToken.length === 0 ||
      body.refreshToken.length > 4096
    ) {
      return null;
    }
    return body.refreshToken;
  } catch {
    return null;
  }
}

function errorName(value: unknown): string {
  return typeof value === "object" && value !== null && "name" in value
    ? String(value.name)
    : "UnknownError";
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (
    !auth ||
    auth.authType !== "cognito" ||
    !auth.principalId ||
    !auth.cognitoIssuer ||
    !auth.route
  ) {
    return unauthorized("Authentication required");
  }

  const refreshToken = parseRefreshToken(event);
  if (!refreshToken) return error("A valid refresh token is required", 400);

  const rateKey = `${auth.cognitoIssuer}|${auth.principalId}|${auth.route.appClientId}`;
  if (!rateLimitAllows(rateKey)) {
    return error("Too many revocation requests", 429);
  }

  try {
    await cognito.send(
      new RevokeTokenCommand({
        ClientId: auth.route.appClientId,
        Token: refreshToken,
      }),
    );
    return json({ revoked: true }, 200);
  } catch (cause) {
    const name = errorName(cause);
    // A missing, expired, or already-revoked refresh token is already in the
    // desired terminal state. Keep the endpoint idempotent and reveal no token
    // validity detail to the caller.
    if (name === "NotAuthorizedException") {
      return json({ revoked: true }, 200);
    }
    if (name === "TooManyRequestsException") {
      return error("Too many revocation requests", 429);
    }
    console.error("[auth-revoke] Cognito revocation failed", { name });
    return error("Unable to revoke session", 502);
  }
}

export function __resetAuthRevokeRateLimitForTests(): void {
  attempts.clear();
}
