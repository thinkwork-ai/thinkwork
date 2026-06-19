const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";

export interface WorkosAuthenticationResponse {
  access_token: string;
  refresh_token?: string;
  user: WorkosUserInfo;
  organization_id?: string;
  authkit_authorization_code?: string;
  authentication_method?: string;
  oauth_tokens?: Record<string, unknown>;
}

export interface WorkosUserInfo {
  id: string;
  email?: string;
  email_verified?: boolean | string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string;
  [key: string]: unknown;
}

export interface WorkosPrimaryAuthProof {
  authentication: WorkosAuthenticationResponse;
  user: WorkosUserInfo;
  workosUserId: string;
  sessionId: string;
}

export interface CognitoCustomAuthStartInput {
  AuthFlow: "CUSTOM_AUTH";
  UserPoolId: string;
  ClientId: string;
  AuthParameters: {
    USERNAME: string;
    CHALLENGE_NAME: "CUSTOM_CHALLENGE";
  };
  ClientMetadata: Record<string, string>;
}

export interface CognitoCustomAuthChallengeInput {
  UserPoolId: string;
  ClientId: string;
  ChallengeName: "CUSTOM_CHALLENGE";
  Session: string;
  ChallengeResponses: {
    USERNAME: string;
    ANSWER: string;
  };
  ClientMetadata: Record<string, string>;
}

export interface CognitoBridgeClaimsCheck {
  ok: boolean;
  missing: string[];
}

export function normalizeWorkosApiBase(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("WorkOS API base URL is required");
  }
  const url = new URL(trimmed);
  if (url.protocol !== "https:") {
    throw new Error("WorkOS API base URL must use https");
  }
  return url.toString().replace(/\/$/, "");
}

export function workosAuthorizeEndpoint(apiBase = DEFAULT_WORKOS_API_BASE_URL) {
  return `${normalizeWorkosApiBase(apiBase)}/user_management/authorize`;
}

export function workosAuthenticateEndpoint(
  apiBase = DEFAULT_WORKOS_API_BASE_URL,
) {
  return `${normalizeWorkosApiBase(apiBase)}/user_management/authenticate`;
}

export function buildWorkosAuthorizeUrl(args: {
  apiBase?: string;
  clientId: string;
  redirectUri: string;
  state: string;
  provider?: string;
  prompt?: string;
  scope?: string;
}): string {
  const url = new URL(workosAuthorizeEndpoint(args.apiBase));
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", args.scope || "openid email profile");
  url.searchParams.set("state", args.state);
  if (args.provider) url.searchParams.set("provider", args.provider);
  if (args.prompt) url.searchParams.set("prompt", args.prompt);
  return url.toString();
}

export async function authenticateWorkosAuthorizationCode(args: {
  apiBase?: string;
  clientId: string;
  clientSecret: string;
  code: string;
  ipAddress?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}): Promise<WorkosAuthenticationResponse> {
  const fetcher = args.fetchImpl ?? fetch;
  const response = await fetcher(workosAuthenticateEndpoint(args.apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      ...(args.ipAddress ? { ip_address: args.ipAddress } : {}),
      ...(args.userAgent ? { user_agent: args.userAgent } : {}),
    }),
  });
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(`WorkOS authentication failed: ${response.status}`);
  }
  return requireWorkosAuthenticationResponse(body);
}

export async function proveWorkosPrimaryExchange(args: {
  apiBase?: string;
  clientId: string;
  clientSecret: string;
  code: string;
  ipAddress?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}): Promise<WorkosPrimaryAuthProof> {
  const authentication = await authenticateWorkosAuthorizationCode(args);
  const sessionId = extractWorkosSessionId(authentication.access_token);
  return {
    authentication,
    user: authentication.user,
    workosUserId: authentication.user.id,
    sessionId,
  };
}

export function extractWorkosSessionId(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken);
  const sid = payload.sid;
  if (typeof sid !== "string" || !sid) {
    throw new Error("WorkOS access token did not include sid");
  }
  return sid;
}

export function buildWorkosLogoutUrl(args: {
  apiBase?: string;
  sessionId: string;
  returnTo?: string;
}): string {
  const url = new URL(
    `${normalizeWorkosApiBase(args.apiBase ?? DEFAULT_WORKOS_API_BASE_URL)}/user_management/sessions/logout`,
  );
  url.searchParams.set("session_id", args.sessionId);
  if (args.returnTo) url.searchParams.set("return_to", args.returnTo);
  return url.toString();
}

export function buildCognitoCustomAuthStartInput(args: {
  userPoolId: string;
  clientId: string;
  username: string;
  bridgeId: string;
  workosUserId: string;
  workosSessionId: string;
}): CognitoCustomAuthStartInput {
  return {
    AuthFlow: "CUSTOM_AUTH",
    UserPoolId: args.userPoolId,
    ClientId: args.clientId,
    AuthParameters: {
      USERNAME: args.username,
      CHALLENGE_NAME: "CUSTOM_CHALLENGE",
    },
    ClientMetadata: bridgeMetadata(args),
  };
}

export function buildCognitoCustomAuthChallengeInput(args: {
  userPoolId: string;
  clientId: string;
  username: string;
  bridgeId: string;
  bridgeAnswer: string;
  workosUserId: string;
  workosSessionId: string;
  session: string;
}): CognitoCustomAuthChallengeInput {
  return {
    UserPoolId: args.userPoolId,
    ClientId: args.clientId,
    ChallengeName: "CUSTOM_CHALLENGE",
    Session: args.session,
    ChallengeResponses: {
      USERNAME: args.username,
      ANSWER: args.bridgeAnswer,
    },
    ClientMetadata: bridgeMetadata(args),
  };
}

export function validateCognitoBridgeClaims(
  token: string,
  expected: {
    issuer: string;
    audience: string;
    email?: string;
    tenantId?: string;
  },
): CognitoBridgeClaimsCheck {
  const claims = decodeJwtPayload(token);
  const missing: string[] = [];
  requireClaim(missing, claims.iss === expected.issuer, "iss");
  requireClaim(missing, claims.aud === expected.audience, "aud");
  requireClaim(missing, typeof claims.sub === "string", "sub");
  requireClaim(missing, typeof claims.email === "string", "email");
  requireClaim(
    missing,
    claims.email_verified === true || claims.email_verified === "true",
    "email_verified",
  );
  requireClaim(missing, typeof claims.name === "string", "name");
  if (expected.email) {
    requireClaim(
      missing,
      String(claims.email).toLowerCase() === expected.email.toLowerCase(),
      "email_match",
    );
  }
  if (expected.tenantId) {
    requireClaim(
      missing,
      claims["custom:tenant_id"] === expected.tenantId,
      "custom:tenant_id",
    );
  }
  return { ok: missing.length === 0, missing };
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("JWT payload missing");
  try {
    return JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
  } catch {
    throw new Error("JWT payload was not valid JSON");
  }
}

function bridgeMetadata(args: {
  bridgeId: string;
  workosUserId: string;
  workosSessionId: string;
}): Record<string, string> {
  return {
    bridge_id: args.bridgeId,
    workos_user_id: args.workosUserId,
    workos_session_id: args.workosSessionId,
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`Response was not JSON: ${response.status}`);
  }
}

function requireWorkosAuthenticationResponse(
  body: unknown,
): WorkosAuthenticationResponse {
  if (
    !isRecord(body) ||
    typeof body.access_token !== "string" ||
    !isRecord(body.user) ||
    typeof body.user.id !== "string"
  ) {
    throw new Error("WorkOS authentication response missing access_token/user");
  }
  return body as unknown as WorkosAuthenticationResponse;
}

function requireClaim(missing: string[], condition: boolean, name: string) {
  if (!condition) missing.push(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}
