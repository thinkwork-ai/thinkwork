import { randomBytes, createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { domainToASCII } from "node:url";
import {
  authProviderResources,
  pluginComponents,
  pluginInstalls,
  tenantAuthProviderReferences,
  workosAuthBridges,
} from "@thinkwork/database-pg/schema";
import { getApiAuthSecret } from "@thinkwork/runtime-config";
import { db as defaultDb } from "./db.js";
import { createSecretsManagerPluginSecrets } from "./plugins/secrets.js";
import { signObject, verifyObject } from "./mcp-oauth/state.js";

type DbLike = typeof defaultDb;

const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";
const STATE_TTL_SECONDS = 10 * 60;
const BRIDGE_TTL_SECONDS = 5 * 60;
const PROVIDERS = new Set([
  "authkit",
  "AppleOAuth",
  "BitbucketOAuth",
  "GitHubOAuth",
  "GitLabOAuth",
  "GoogleOAuth",
  "IntuitOAuth",
  "LinkedInOAuth",
  "MicrosoftOAuth",
  "SalesforceOAuth",
  "SlackOAuth",
  "VercelMarketplaceOAuth",
  "VercelOAuth",
  "XeroOAuth",
]);

export interface WorkosAuthPublication {
  tenantId: string;
  tenantReferenceId: string;
  authProviderResourceId: string;
  clientId: string;
  clientSecretRef: string;
  authorizeScopes: string;
  hostnames: string[];
  metadata: Record<string, unknown>;
  componentHandlerRef: Record<string, unknown>;
}

export interface WorkosAuthDeps {
  loadPublicationForHost(host: string): Promise<WorkosAuthPublication | null>;
  getSecret(ref: string): Promise<string | null>;
  exchangeCode(args: WorkosCodeExchangeArgs): Promise<WorkosAuthResponse>;
  persistBridge(record: WorkosBridgeRecordInput): Promise<void>;
  signingSecret(): string;
  now(): Date;
  randomToken(bytes?: number): string;
}

export interface WorkosCodeExchangeArgs {
  clientId: string;
  clientSecret: string;
  code: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface WorkosAuthResponse {
  access_token: string;
  refresh_token?: string;
  user: {
    id: string;
    email?: string;
    email_verified?: boolean | string;
    first_name?: string | null;
    last_name?: string | null;
    name?: string;
    [key: string]: unknown;
  };
}

export interface WorkosAuthorizeState extends Record<string, unknown> {
  kind: "workos_authorize_state";
  nonce: string;
  host: string;
  tenantId: string;
  tenantReferenceId: string;
  authProviderResourceId: string;
  redirectUri: string;
  returnTo: string;
}

export interface WorkosBridgeRecordInput {
  tenantId: string;
  tenantReferenceId: string;
  authProviderResourceId: string;
  bridgeCodeDigest: string;
  workosUserId: string;
  workosSessionId: string;
  workosSessionExpiresAt: Date | null;
  workosEmail: string;
  workosEmailVerified: boolean;
  workosProfile: Record<string, unknown>;
  stateNonce: string;
  redirectUri: string;
  returnTo: string;
  expiresAt: Date;
}

export function createDefaultWorkosAuthDeps(
  db: DbLike = defaultDb,
): WorkosAuthDeps {
  const secrets = createSecretsManagerPluginSecrets();
  return {
    loadPublicationForHost: (host) => loadWorkosPublicationForHost(host, db),
    getSecret: (ref) => secrets.getSecret(ref),
    exchangeCode: (args) => exchangeWorkosCode(args),
    persistBridge: (record) => persistWorkosBridge(record, db),
    signingSecret: () => getApiAuthSecret(),
    now: () => new Date(),
    randomToken: (bytes = 32) => randomBytes(bytes).toString("base64url"),
  };
}

export async function createWorkosAuthorizeRedirect(args: {
  trustedDomainName?: string;
  redirectUri?: string;
  returnTo?: string;
  provider?: string;
  prompt?: string;
  deps?: WorkosAuthDeps;
}): Promise<string> {
  const deps = args.deps ?? createDefaultWorkosAuthDeps();
  const host = normalizeTrustedHost(args.trustedDomainName);
  if (!host) throw new WorkosAuthError("trusted host missing", 400);

  const publication = await deps.loadPublicationForHost(host);
  if (!publication || !componentAllowsPublication(publication.componentHandlerRef)) {
    throw new WorkosAuthError("WorkOS auth is not available", 404);
  }

  const redirectUri = normalizeRedirectUriForPublication(
    args.redirectUri,
    publication,
  );
  const returnTo = normalizeReturnTo(args.returnTo);
  const provider = normalizeProvider(args.provider);
  const prompt = normalizePrompt(args.prompt);
  const state = signWorkosAuthorizeState(
    {
      kind: "workos_authorize_state",
      nonce: deps.randomToken(18),
      host,
      tenantId: publication.tenantId,
      tenantReferenceId: publication.tenantReferenceId,
      authProviderResourceId: publication.authProviderResourceId,
      redirectUri,
      returnTo,
    },
    deps.signingSecret(),
  );

  const url = new URL(`${DEFAULT_WORKOS_API_BASE_URL}/user_management/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", publication.clientId);
  url.searchParams.set("redirect_uri", callbackUrlForHost(host));
  url.searchParams.set("state", state);
  url.searchParams.set("scope", publication.authorizeScopes);
  url.searchParams.set("provider", provider ?? "authkit");
  if (prompt) url.searchParams.set("prompt", prompt);
  return url.toString();
}

export async function completeWorkosCallback(args: {
  trustedDomainName?: string;
  code?: string;
  state?: string;
  ipAddress?: string;
  userAgent?: string;
  deps?: WorkosAuthDeps;
}): Promise<string> {
  const deps = args.deps ?? createDefaultWorkosAuthDeps();
  const host = normalizeTrustedHost(args.trustedDomainName);
  if (!host) throw new WorkosAuthError("trusted host missing", 400);
  if (!args.code) throw new WorkosAuthError("WorkOS code missing", 400);
  if (!args.state) throw new WorkosAuthError("WorkOS state missing", 400);

  const state = verifyWorkosAuthorizeState(args.state, deps.signingSecret());
  if (state.host !== host) {
    throw new WorkosAuthError("WorkOS state host mismatch", 400);
  }

  const publication = await deps.loadPublicationForHost(host);
  if (
    !publication ||
    publication.tenantId !== state.tenantId ||
    publication.tenantReferenceId !== state.tenantReferenceId ||
    publication.authProviderResourceId !== state.authProviderResourceId
  ) {
    throw new WorkosAuthError("WorkOS auth is no longer available", 404);
  }

  const secret = await deps.getSecret(publication.clientSecretRef);
  const clientSecret = parseClientSecret(secret);
  if (!clientSecret) {
    throw new WorkosAuthError("WorkOS client secret is not configured", 500);
  }

  const auth = await deps.exchangeCode({
    clientId: publication.clientId,
    clientSecret,
    code: args.code,
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
  });
  const profile = requireVerifiedWorkosProfile(auth);
  const session = extractWorkosSessionClaims(auth.access_token);
  const bridgeCode = deps.randomToken(32);

  await deps.persistBridge({
    tenantId: state.tenantId,
    tenantReferenceId: state.tenantReferenceId,
    authProviderResourceId: state.authProviderResourceId,
    bridgeCodeDigest: digestBridgeCode(bridgeCode),
    workosUserId: profile.id,
    workosSessionId: session.sessionId,
    workosSessionExpiresAt: session.expiresAt,
    workosEmail: profile.email,
    workosEmailVerified: true,
    workosProfile: sanitizeWorkosProfile(auth.user),
    stateNonce: state.nonce,
    redirectUri: state.redirectUri,
    returnTo: state.returnTo,
    expiresAt: new Date(deps.now().getTime() + BRIDGE_TTL_SECONDS * 1000),
  });

  const redirect = new URL(state.redirectUri);
  redirect.searchParams.set("workos_bridge", bridgeCode);
  redirect.searchParams.set("next", state.returnTo);
  return redirect.toString();
}

export function callbackUrlForHost(host: string): string {
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return `http://${host}/api/auth/workos/callback`;
  }
  return `https://${host}/api/auth/workos/callback`;
}

export function signWorkosAuthorizeState(
  state: WorkosAuthorizeState,
  secret: string,
): string {
  return signObject(state, secret, STATE_TTL_SECONDS);
}

export function verifyWorkosAuthorizeState(
  token: string,
  secret: string,
): WorkosAuthorizeState {
  const state = verifyObject<WorkosAuthorizeState>(token, secret);
  if (state.kind !== "workos_authorize_state") {
    throw new WorkosAuthError("invalid WorkOS state kind", 400);
  }
  for (const key of [
    "nonce",
    "host",
    "tenantId",
    "tenantReferenceId",
    "authProviderResourceId",
    "redirectUri",
    "returnTo",
  ] as const) {
    if (typeof state[key] !== "string" || !state[key]) {
      throw new WorkosAuthError("invalid WorkOS state payload", 400);
    }
  }
  return state;
}

export function normalizeTrustedHost(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\.+$/, "");
  if (!trimmed) return null;
  const ascii = domainToASCII(trimmed);
  return ascii ? ascii.toLowerCase() : null;
}

export function normalizeRedirectUri(value: string | undefined): string {
  return normalizeRedirectUriForPublication(value, {
    hostnames: [],
    metadata: {},
  });
}

function normalizeRedirectUriForPublication(
  value: string | undefined,
  publication: Pick<WorkosAuthPublication, "hostnames" | "metadata">,
): string {
  if (!value) throw new WorkosAuthError("redirect_uri is required", 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkosAuthError("redirect_uri is invalid", 400);
  }
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  ) {
    throw new WorkosAuthError("redirect_uri must use https", 400);
  }
  if (url.pathname !== "/auth/callback") {
    throw new WorkosAuthError("redirect_uri path is not allowed", 400);
  }
  url.hash = "";
  const normalized = url.toString();
  if (!redirectUriAllowed(url, normalized, publication)) {
    throw new WorkosAuthError("redirect_uri origin is not allowed", 400);
  }
  return normalized;
}

export function normalizeReturnTo(value: string | undefined): string {
  if (!value) return "/new";
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/new";
  }
  try {
    const url = new URL(trimmed, "https://thinkwork.local");
    return `${url.pathname}${url.search}`;
  } catch {
    return "/new";
  }
}

export function digestBridgeCode(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

export function extractWorkosSessionId(accessToken: string): string {
  return extractWorkosSessionClaims(accessToken).sessionId;
}

export function extractWorkosSessionClaims(accessToken: string): {
  sessionId: string;
  expiresAt: Date | null;
} {
  const payload = decodeJwtPayload(accessToken);
  const sid = payload.sid;
  if (typeof sid !== "string" || !sid) {
    throw new WorkosAuthError("WorkOS access token did not include sid", 502);
  }
  const exp = payload.exp;
  return {
    sessionId: sid,
    expiresAt:
      typeof exp === "number" && Number.isFinite(exp) && exp > 0
        ? new Date(exp * 1000)
        : null,
  };
}

export function parseClientSecret(secretValue: string | null): string | null {
  const trimmed = secretValue?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.client_secret === "string") {
      return parsed.client_secret.trim() || null;
    }
    if (typeof parsed.clientSecret === "string") {
      return parsed.clientSecret.trim() || null;
    }
  } catch {
    return trimmed;
  }
  return null;
}

export class WorkosAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

async function loadWorkosPublicationForHost(
  host: string,
  db: DbLike,
): Promise<WorkosAuthPublication | null> {
  const rows = await db
    .select({
      tenantId: tenantAuthProviderReferences.tenant_id,
      tenantReferenceId: tenantAuthProviderReferences.id,
      authProviderResourceId: authProviderResources.id,
      clientId: authProviderResources.client_id,
      clientSecretRef: authProviderResources.client_secret_ref,
      authorizeScopes: authProviderResources.authorize_scopes,
      hostnames: tenantAuthProviderReferences.hostnames,
      metadata: tenantAuthProviderReferences.metadata,
      componentHandlerRef: pluginComponents.handler_ref,
    })
    .from(tenantAuthProviderReferences)
    .innerJoin(
      authProviderResources,
      eq(
        tenantAuthProviderReferences.auth_provider_resource_id,
        authProviderResources.id,
      ),
    )
    .innerJoin(
      pluginInstalls,
      eq(tenantAuthProviderReferences.plugin_install_id, pluginInstalls.id),
    )
    .innerJoin(
      pluginComponents,
      and(
        eq(pluginComponents.plugin_install_id, pluginInstalls.id),
        eq(pluginComponents.component_type, "auth-provider"),
      ),
    )
    .where(
      and(
        eq(tenantAuthProviderReferences.status, "enabled"),
        inArray(pluginInstalls.state, ["installed", "partially_installed"]),
        eq(pluginComponents.state, "provisioned"),
        eq(authProviderResources.provider_key, "workos"),
        inArray(authProviderResources.validation_status, [
          "valid",
          "partially_valid",
        ]),
        eq(authProviderResources.public_options_published, true),
      ),
    );

  const matches = rows.filter((row) =>
    row.hostnames.some((candidate) => normalizeTrustedHost(candidate) === host),
  );
  if (matches.length !== 1) return null;
  return matches[0];
}

async function exchangeWorkosCode(
  args: WorkosCodeExchangeArgs,
): Promise<WorkosAuthResponse> {
  const response = await fetch(
    `${DEFAULT_WORKOS_API_BASE_URL}/user_management/authenticate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: args.clientId,
        client_secret: args.clientSecret,
        code: args.code,
        ...(args.ipAddress ? { ip_address: args.ipAddress } : {}),
        ...(args.userAgent ? { user_agent: args.userAgent } : {}),
      }),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WorkosAuthError(`WorkOS authentication failed`, 502);
  }
  return requireWorkosAuthResponse(body);
}

async function persistWorkosBridge(
  record: WorkosBridgeRecordInput,
  db: DbLike,
): Promise<void> {
  await db.insert(workosAuthBridges).values({
    tenant_id: record.tenantId,
    tenant_auth_provider_reference_id: record.tenantReferenceId,
    auth_provider_resource_id: record.authProviderResourceId,
    bridge_code_digest: record.bridgeCodeDigest,
    workos_user_id: record.workosUserId,
    workos_session_id: record.workosSessionId,
    workos_session_expires_at: record.workosSessionExpiresAt,
    workos_email: record.workosEmail,
    workos_email_verified: record.workosEmailVerified,
    workos_profile: record.workosProfile,
    state_nonce: record.stateNonce,
    redirect_uri: record.redirectUri,
    return_to: record.returnTo,
    status: "pending",
    expires_at: record.expiresAt,
  });
}

function componentAllowsPublication(handlerRef: Record<string, unknown>) {
  return (
    handlerRef.status === "valid" && handlerRef.publicOptionsPublished === true
  );
}

function normalizeProvider(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return PROVIDERS.has(trimmed) ? trimmed : null;
}

function normalizePrompt(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9 _.-]{1,80}$/.test(trimmed) ? trimmed : null;
}

function redirectUriAllowed(
  url: URL,
  normalized: string,
  publication: Pick<WorkosAuthPublication, "hostnames" | "metadata">,
): boolean {
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return true;
  }

  const redirectHost = normalizeTrustedHost(url.host);
  if (
    redirectHost &&
    publication.hostnames.some(
      (candidate) => normalizeTrustedHost(candidate) === redirectHost,
    )
  ) {
    return true;
  }

  const allowedUris = metadataStringArray(
    publication.metadata.allowedRedirectUris,
  );
  if (allowedUris.some((candidate) => normalizeAllowedUri(candidate) === normalized)) {
    return true;
  }

  const allowedOrigins = metadataStringArray(
    publication.metadata.allowedRedirectOrigins,
  );
  return allowedOrigins.some(
    (candidate) => normalizeAllowedOrigin(candidate) === url.origin,
  );
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeAllowedUri(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeAllowedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function requireVerifiedWorkosProfile(auth: WorkosAuthResponse): {
  id: string;
  email: string;
} {
  const user = auth.user;
  if (!user.id || typeof user.email !== "string" || !user.email.trim()) {
    throw new WorkosAuthError("WorkOS profile missing verified email", 502);
  }
  if (user.email_verified !== true && user.email_verified !== "true") {
    throw new WorkosAuthError("WorkOS email is not verified", 403);
  }
  return { id: user.id, email: user.email.trim().toLowerCase() };
}

function sanitizeWorkosProfile(
  user: WorkosAuthResponse["user"],
): Record<string, unknown> {
  return {
    id: user.id,
    email: typeof user.email === "string" ? user.email.toLowerCase() : null,
    email_verified: user.email_verified,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    name: user.name ?? null,
  };
}

function requireWorkosAuthResponse(body: unknown): WorkosAuthResponse {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).access_token !== "string" ||
    !isRecord((body as Record<string, unknown>).user) ||
    typeof ((body as Record<string, unknown>).user as Record<string, unknown>)
      .id !== "string"
  ) {
    throw new WorkosAuthError("WorkOS response missing access_token/user", 502);
  }
  return body as WorkosAuthResponse;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) throw new WorkosAuthError("JWT payload missing", 502);
  try {
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new WorkosAuthError("JWT payload was not valid JSON", 502);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
