/**
 * App-level OAuth activation (plan 2026-06-12-001 U6).
 *
 * One consent per (user, plugin install) minting N token records — one
 * per distinct RFC 8707 resource indicator declared by the plugin's
 * `mcp-server` components.
 *
 * Flow:
 *
 *   startActivation     — discovery (RFC 8414 / OIDC against the plugin's
 *                         declared auth domain) + DCR (RFC 7591, cached on
 *                         the mcp-server component row's handler_ref) +
 *                         PKCE + an HMAC-SIGNED state blob. The state binds
 *                         the CANONICAL caller user id resolved from the
 *                         auth context — never a caller-supplied id.
 *   completeActivation  — verifies the state HMAC BEFORE consuming any
 *                         state field, rejects expired state, exchanges
 *                         the code (resource = first indicator), then
 *                         mints additional tokens for the remaining
 *                         indicators via refresh-token grants carrying a
 *                         different `resource` parameter. If the AS
 *                         rejects a multi-resource mint (or issued no
 *                         refresh token), the initial token is stored for
 *                         the remaining resource records with
 *                         `shared_audience: true` in the secret payload
 *                         (the documented v1 fallback — the audit event
 *                         carries `sharedAudience` too; the activation
 *                         table has no metadata column).
 *   deactivateActivation — deletes EVERY token secret (real Secrets
 *                         Manager deletion), deletes token rows, flips
 *                         the activation to 'revoked'. Local-only: no
 *                         provider-side grant revocation in v1.
 *   markActivationNeedsReauth — refresh-failure hook used by dispatch.
 *
 * Multi-resource caveat (documented degradation): authorization servers
 * that ROTATE refresh tokens invalidate earlier-minted records' refresh
 * tokens; those records refresh-fail later and flip the activation to
 * needs_reauth, prompting one reconnect. Single-resource plugins (the
 * common case) are unaffected.
 *
 * Secrets: thinkwork/{stage}/plugin-tokens/{userId}/{pluginInstallId}/{resourceKey}.
 *
 * Compliance: plugin.activation_granted is written transactionally with
 * the activation upsert; plugin.activation_revoked transactionally with
 * the revoke transition.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getApiAuthSecret, getConfig } from "@thinkwork/runtime-config";
import type {
  McpServerComponent,
  PluginVersion,
} from "@thinkwork/plugin-catalog";
import type { EmitAuditEventInput } from "../compliance/emit.js";
import { getPluginVersion } from "./catalog-source.js";
import { pluginEngineError } from "./engine.js";
import {
  createSecretsManagerPluginSecrets,
  type PluginSecretsClient,
} from "./secrets.js";
import {
  createDrizzlePluginEngineStore,
  type PluginEngineStore,
  type PluginInstallRow,
  type UserPluginActivationRow,
} from "./store.js";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface PluginActivationDeps {
  store: PluginEngineStore;
  secrets: PluginSecretsClient;
  resolveVersion: (
    pluginKey: string,
    version?: string | null,
  ) => Promise<{
    plugin: { pluginKey: string };
    versionEntry: {
      version: string;
      payloadSha256: string;
      payload: PluginVersion;
    };
  } | null>;
  fetchFn: typeof fetch;
  /** HMAC key for the signed OAuth state. Empty string fails closed. */
  stateSecret: () => string;
  /** API base URL hosting the plugin-oauth callback route. */
  apiBaseUrl: () => string | null;
  stage: () => string;
  now: () => Date;
}

export function createDefaultPluginActivationDeps(): PluginActivationDeps {
  return {
    store: createDrizzlePluginEngineStore(),
    secrets: createSecretsManagerPluginSecrets(),
    resolveVersion: (pluginKey, version) =>
      getPluginVersion(pluginKey, version),
    fetchFn: fetch,
    stateSecret: () => getApiAuthSecret(),
    apiBaseUrl: () => getConfig("THINKWORK_API_URL") ?? null,
    stage: () => process.env.STAGE || "dev",
    now: () => new Date(),
  };
}

// ---------------------------------------------------------------------------
// HMAC-signed state
// ---------------------------------------------------------------------------

/** Reject state older than this — bounds replay of an abandoned consent. */
export const MAX_STATE_AGE_MS = 10 * 60 * 1000;
/** Tolerated forward clock skew between signer and verifier. */
const STATE_CLOCK_SKEW_MS = 60 * 1000;

export interface PluginOAuthState {
  v: 1;
  userId: string;
  tenantId: string;
  pluginInstallId: string;
  pluginKey: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  /** Distinct RFC 8707 resource indicators, stable order. */
  resources: string[];
  scope: string;
  returnTo: string | null;
  nonce: string;
  /** Issued-at, epoch ms. */
  iat: number;
}

export function signPluginOAuthState(
  payload: PluginOAuthState,
  secret: string,
): string {
  if (!secret) {
    throw pluginEngineError(
      "PLUGIN_OAUTH_STATE_SECRET_MISSING",
      "Plugin OAuth state signing secret is not configured",
    );
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

/**
 * Verify-then-parse. The HMAC is checked over the OPAQUE encoded blob
 * before any field is decoded or consumed; expired state is rejected
 * after signature verification.
 */
export function verifyPluginOAuthState(
  state: string,
  secret: string,
  now: Date,
): { ok: true; payload: PluginOAuthState } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: "state_secret_missing" };
  const separator = state.lastIndexOf(".");
  if (separator <= 0) return { ok: false, reason: "invalid_state" };
  const encoded = state.slice(0, separator);
  const providedSig = state.slice(separator + 1);
  const expectedSig = createHmac("sha256", secret)
    .update(encoded)
    .digest("hex");
  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return { ok: false, reason: "invalid_state_signature" };
  }

  // Signature verified — NOW the payload may be decoded and consumed.
  let payload: PluginOAuthState;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_state" };
  }
  if (
    payload?.v !== 1 ||
    typeof payload.userId !== "string" ||
    typeof payload.tenantId !== "string" ||
    typeof payload.pluginInstallId !== "string" ||
    typeof payload.pluginKey !== "string" ||
    typeof payload.tokenEndpoint !== "string" ||
    typeof payload.clientId !== "string" ||
    typeof payload.redirectUri !== "string" ||
    typeof payload.codeVerifier !== "string" ||
    !Array.isArray(payload.resources) ||
    payload.resources.length === 0 ||
    typeof payload.iat !== "number"
  ) {
    return { ok: false, reason: "invalid_state" };
  }
  const age = now.getTime() - payload.iat;
  if (age > MAX_STATE_AGE_MS || age < -STATE_CLOCK_SKEW_MS) {
    return { ok: false, reason: "expired_state" };
  }
  return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeResource(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Stable slug of a resource indicator for the secret path segment. */
export function resourceKeyFor(resourceIndicator: string): string {
  const normalized = normalizeResource(resourceIndicator);
  const slug = normalized
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const digest = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 8);
  return slug ? `${slug}-${digest}` : digest;
}

export function pluginTokenSecretName(args: {
  stage: string;
  userId: string;
  pluginInstallId: string;
  resourceIndicator: string;
}): string {
  return `thinkwork/${args.stage}/plugin-tokens/${args.userId}/${args.pluginInstallId}/${resourceKeyFor(args.resourceIndicator)}`;
}

function oauthMcpComponents(payload: PluginVersion): McpServerComponent[] {
  return payload.components.filter(
    (component): component is McpServerComponent =>
      component.type === "mcp-server" &&
      (component.auth.mode === "oauth" ||
        component.auth.mode === "oauth-per-instance"),
  );
}

/**
 * Per-component OAuth binding: the auth domain to run discovery/DCR
 * against and the RFC 8707 resource indicator to mint for.
 *
 *   - `mode: "oauth"` — both come straight from the manifest.
 *   - `mode: "oauth-per-instance"` (U10, Twenty) — the resource is the
 *     provisioned row's resolved endpoint (component handler_ref
 *     `resolvedEndpointUrl`) and the auth domain is discovered from that
 *     endpoint's RFC 9728 protected-resource metadata
 *     (`authorization_servers[0]`) — exactly how the legacy per-server
 *     connect flow resolved Twenty's authorization server.
 */
export async function resolveOauthComponentBindings(args: {
  pluginKey: string;
  components: McpServerComponent[];
  componentRows: Array<{
    component_key: string;
    handler_ref: Record<string, unknown> | null;
  }>;
  fetchFn: typeof fetch;
}): Promise<Array<{ authDomain: string; resource: string }>> {
  const bindings: Array<{ authDomain: string; resource: string }> = [];
  for (const component of args.components) {
    if (component.auth.mode === "oauth") {
      bindings.push({
        authDomain: component.auth.authDomain,
        resource: normalizeResource(component.auth.resourceIndicator),
      });
      continue;
    }
    if (component.auth.mode !== "oauth-per-instance") continue;
    const row = args.componentRows.find(
      (candidate) => candidate.component_key === component.key,
    );
    const resolved = (row?.handler_ref ?? {}).resolvedEndpointUrl;
    if (typeof resolved !== "string" || !resolved) {
      throw pluginEngineError(
        "PLUGIN_COMPONENT_NOT_PROVISIONED",
        `Plugin ${args.pluginKey} MCP component "${component.key}" has no resolved endpoint yet; finish the install before activating`,
      );
    }
    bindings.push({
      authDomain: await discoverResourceAuthDomain(resolved, args.fetchFn),
      resource: normalizeResource(resolved),
    });
  }
  return bindings;
}

/**
 * RFC 9728 protected-resource discovery: fetch
 * `<origin>/.well-known/oauth-protected-resource[/<path>]` for the
 * resolved endpoint and return its first authorization server.
 */
async function discoverResourceAuthDomain(
  endpointUrl: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const endpoint = new URL(endpointUrl);
  const path = endpoint.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const metadataUrl = path
    ? `${endpoint.origin}/.well-known/oauth-protected-resource/${path}`
    : `${endpoint.origin}/.well-known/oauth-protected-resource`;
  const response = await fetchFn(metadataUrl, {
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response?.ok) {
    throw pluginEngineError(
      "PLUGIN_OAUTH_DISCOVERY_FAILED",
      `Protected-resource metadata discovery failed for ${endpointUrl}${response ? ` (${response.status})` : ""}`,
    );
  }
  const metadata = (await response.json()) as {
    authorization_servers?: unknown;
  };
  const servers = Array.isArray(metadata.authorization_servers)
    ? metadata.authorization_servers.filter(
        (server): server is string =>
          typeof server === "string" && server.length > 0,
      )
    : [];
  if (servers.length === 0) {
    throw pluginEngineError(
      "PLUGIN_OAUTH_DISCOVERY_FAILED",
      `Protected-resource metadata for ${endpointUrl} declares no authorization server`,
    );
  }
  return servers[0]!.replace(/\/+$/, "");
}

async function resolvePinnedPayload(
  install: PluginInstallRow,
  deps: PluginActivationDeps,
): Promise<PluginVersion> {
  const resolved = await deps.resolveVersion(
    install.plugin_key,
    install.pinned_version,
  );
  if (!resolved) {
    throw pluginEngineError(
      "PLUGIN_VERSION_NOT_FOUND",
      `Pinned version ${install.plugin_key}@${install.pinned_version} is no longer in the catalog`,
    );
  }
  if (resolved.versionEntry.payloadSha256 !== install.pinned_payload_sha256) {
    throw pluginEngineError(
      "PLUGIN_VERSION_DIGEST_MISMATCH",
      `Catalog payload digest for ${install.plugin_key}@${install.pinned_version} no longer matches the install pin`,
    );
  }
  return resolved.versionEntry.payload;
}

interface AuthServerEndpoints {
  authorizeEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
}

async function discoverAuthServer(
  authDomain: string,
  fetchFn: typeof fetch,
): Promise<AuthServerEndpoints> {
  const base = authDomain.replace(/\/+$/, "");
  const rfc8414 = await fetchFn(
    `${base}/.well-known/oauth-authorization-server`,
    { signal: AbortSignal.timeout(10000) },
  ).catch(() => null);
  const response = rfc8414?.ok
    ? rfc8414
    : await fetchFn(`${base}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
  if (!response?.ok) {
    throw pluginEngineError(
      "PLUGIN_OAUTH_DISCOVERY_FAILED",
      `OAuth discovery failed against auth domain ${authDomain}`,
    );
  }
  const meta = (await response.json()) as {
    authorization_endpoint?: string;
    token_endpoint?: string;
    registration_endpoint?: string;
  };
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw pluginEngineError(
      "PLUGIN_OAUTH_DISCOVERY_FAILED",
      `Auth domain ${authDomain} metadata is missing authorize/token endpoints`,
    );
  }
  return {
    authorizeEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint ?? null,
  };
}

interface CachedOAuthClient {
  authDomain: string;
  clientId: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
}

/**
 * DCR client cache lives on the first oauth mcp-server component row's
 * handler_ref (`oauthClient` key) — NOT on tenant_mcp_servers.auth_config,
 * which is url_hash-pinned (writing there without recomputing the hash
 * would self-revoke the server in buildMcpConfigs' SI-5 check). A
 * re-provision overwrites handler_ref and simply re-registers next time.
 */
async function readCachedOAuthClient(
  installId: string,
  authDomain: string,
  store: PluginEngineStore,
): Promise<CachedOAuthClient | null> {
  const components = await store.listComponents(installId);
  for (const component of components) {
    const cached = (component.handler_ref ?? {}).oauthClient as
      | CachedOAuthClient
      | undefined;
    if (
      cached &&
      cached.authDomain === authDomain &&
      typeof cached.clientId === "string" &&
      typeof cached.authorizeEndpoint === "string" &&
      typeof cached.tokenEndpoint === "string"
    ) {
      return cached;
    }
  }
  return null;
}

async function writeCachedOAuthClient(
  installId: string,
  cached: CachedOAuthClient,
  store: PluginEngineStore,
): Promise<void> {
  const components = await store.listComponents(installId);
  const target = components.find(
    (component) => component.component_type === "mcp-server",
  );
  if (!target) return;
  await store.updateComponent(target.id, {
    handlerRef: { ...(target.handler_ref ?? {}), oauthClient: cached },
  });
}

const DEFAULT_OAUTH_SCOPE = "openid email profile offline_access";

// ---------------------------------------------------------------------------
// startActivation
// ---------------------------------------------------------------------------

export interface StartActivationArgs {
  /** Canonical caller user id — resolved from the auth context, never input. */
  userId: string;
  tenantId: string;
  pluginInstallId: string;
  returnTo?: string | null;
  /** Override for route callers that know their own host. */
  apiBaseUrl?: string;
}

export async function startActivation(
  args: StartActivationArgs,
  deps: PluginActivationDeps = createDefaultPluginActivationDeps(),
): Promise<{ authorizeUrl: string }> {
  const install = await deps.store.getInstallById(
    args.tenantId,
    args.pluginInstallId,
  );
  if (!install) {
    throw pluginEngineError("NOT_FOUND", "Plugin install not found");
  }
  if (install.state === "uninstalling") {
    throw pluginEngineError(
      "FAILED_PRECONDITION",
      "Plugin is uninstalling; activation is unavailable",
    );
  }

  const payload = await resolvePinnedPayload(install, deps);
  const oauthComponents = oauthMcpComponents(payload);
  if (oauthComponents.length === 0) {
    throw pluginEngineError(
      "PLUGIN_NO_OAUTH_COMPONENTS",
      `Plugin ${install.plugin_key} declares no OAuth MCP servers; there is nothing to activate`,
    );
  }

  const bindings = await resolveOauthComponentBindings({
    pluginKey: install.plugin_key,
    components: oauthComponents,
    componentRows: await deps.store.listComponents(install.id),
    fetchFn: deps.fetchFn,
  });
  const authDomains = [
    ...new Set(bindings.map((binding) => binding.authDomain)),
  ];
  if (authDomains.length !== 1) {
    throw pluginEngineError(
      "PLUGIN_MULTIPLE_AUTH_DOMAINS",
      `Plugin ${install.plugin_key} declares ${authDomains.length} auth domains; v1 activation supports exactly one`,
    );
  }
  const authDomain = authDomains[0]!;

  // Distinct resource indicators, in manifest order.
  const resources: string[] = [];
  for (const binding of bindings) {
    if (!resources.includes(binding.resource)) resources.push(binding.resource);
  }

  const apiBaseUrl = (args.apiBaseUrl ?? deps.apiBaseUrl())?.replace(
    /\/+$/,
    "",
  );
  if (!apiBaseUrl) {
    throw pluginEngineError(
      "PLUGIN_OAUTH_CALLBACK_UNRESOLVED",
      "API base URL for the plugin OAuth callback could not be resolved",
    );
  }
  const redirectUri = `${apiBaseUrl}/api/skills/plugin-oauth/callback`;

  // Discovery + DCR (cached per install on the component handler_ref).
  let client = await readCachedOAuthClient(install.id, authDomain, deps.store);
  if (!client) {
    const endpoints = await discoverAuthServer(authDomain, deps.fetchFn);
    let clientId = "";
    if (endpoints.registrationEndpoint) {
      const dcrRes = await deps.fetchFn(endpoints.registrationEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: `Thinkwork (${install.plugin_key})`,
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!dcrRes.ok) {
        const body = await dcrRes.text().catch(() => "");
        throw pluginEngineError(
          "PLUGIN_OAUTH_DCR_FAILED",
          `Dynamic Client Registration failed: ${dcrRes.status} ${body}`,
        );
      }
      const dcrData = (await dcrRes.json()) as { client_id?: string };
      clientId = dcrData.client_id ?? "";
    }
    if (!clientId) {
      throw pluginEngineError(
        "PLUGIN_OAUTH_NO_CLIENT",
        `Auth domain ${authDomain} offers no registration endpoint and no client is configured`,
      );
    }
    client = {
      authDomain,
      clientId,
      authorizeEndpoint: endpoints.authorizeEndpoint,
      tokenEndpoint: endpoints.tokenEndpoint,
    };
    await writeCachedOAuthClient(install.id, client, deps.store);
  }

  // PKCE
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const scope =
    payload.requiredOauthScopes.length > 0
      ? payload.requiredOauthScopes.join(" ")
      : DEFAULT_OAUTH_SCOPE;

  const state = signPluginOAuthState(
    {
      v: 1,
      userId: args.userId,
      tenantId: args.tenantId,
      pluginInstallId: install.id,
      pluginKey: install.plugin_key,
      tokenEndpoint: client.tokenEndpoint,
      clientId: client.clientId,
      redirectUri,
      codeVerifier,
      resources,
      scope,
      returnTo: args.returnTo ?? null,
      nonce: randomBytes(16).toString("hex"),
      iat: deps.now().getTime(),
    },
    deps.stateSecret(),
  );

  const authorizeUrl = new URL(client.authorizeEndpoint);
  authorizeUrl.searchParams.set("client_id", client.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", scope);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  // RFC 8707 permits repeating `resource` in the authorization request;
  // each token exchange then names the single resource it wants.
  for (const resource of resources) {
    authorizeUrl.searchParams.append("resource", resource);
  }

  return { authorizeUrl: authorizeUrl.toString() };
}

// ---------------------------------------------------------------------------
// completeActivation
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

export type PluginOAuthCompletionResult =
  | { ok: true; pluginKey: string; returnTo: string | null }
  | {
      ok: false;
      reason: string;
      pluginKey?: string;
      returnTo?: string | null;
    };

export async function completeActivation(
  params: {
    state?: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  },
  deps: PluginActivationDeps = createDefaultPluginActivationDeps(),
): Promise<PluginOAuthCompletionResult> {
  if (!params.state) {
    return { ok: false, reason: "missing_state" };
  }
  // MANDATORY ordering: signature verification precedes any consumption
  // of state-embedded fields (incl. the error/denial branch below).
  const verified = verifyPluginOAuthState(
    params.state,
    deps.stateSecret(),
    deps.now(),
  );
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const state = verified.payload;

  if (params.error) {
    // OAuth denial/abandonment: no activation row, no secrets.
    console.warn(
      `[plugin-oauth] consent denied for plugin ${state.pluginKey}: ${params.error} ${params.errorDescription ?? ""}`,
    );
    return {
      ok: false,
      reason: "denied",
      pluginKey: state.pluginKey,
      returnTo: state.returnTo,
    };
  }
  if (!params.code) {
    return {
      ok: false,
      reason: "missing_code",
      pluginKey: state.pluginKey,
      returnTo: state.returnTo,
    };
  }

  // Re-validate the install still exists in the tenant the state binds.
  const install = await deps.store.getInstallById(
    state.tenantId,
    state.pluginInstallId,
  );
  if (!install) {
    return {
      ok: false,
      reason: "install_not_found",
      pluginKey: state.pluginKey,
      returnTo: state.returnTo,
    };
  }

  // Initial exchange — resource = first indicator (RFC 8707 per-exchange).
  const initialRes = await deps.fetchFn(state.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: state.redirectUri,
      client_id: state.clientId,
      code_verifier: state.codeVerifier,
      resource: state.resources[0]!,
    }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!initialRes.ok) {
    const body = await initialRes.text().catch(() => "");
    console.error(
      `[plugin-oauth] token exchange failed for ${state.pluginKey}: ${initialRes.status} ${body}`,
    );
    return {
      ok: false,
      reason: "token_exchange_failed",
      pluginKey: state.pluginKey,
      returnTo: state.returnTo,
    };
  }
  const initial = (await initialRes.json()) as TokenResponse;

  // Additional mints: refresh-token grant per remaining resource. A
  // single authorization code is single-use (sequential code exchanges
  // are not possible), so the refresh token from the initial exchange
  // is the only same-session mint vehicle.
  const minted: Array<{
    resource: string;
    token: TokenResponse;
    sharedAudience: boolean;
  }> = [
    { resource: state.resources[0]!, token: initial, sharedAudience: false },
  ];
  let chainRefreshToken = initial.refresh_token ?? null;
  let sharedAudience = false;

  for (const resource of state.resources.slice(1)) {
    if (sharedAudience || !chainRefreshToken) {
      sharedAudience = true;
      minted.push({ resource, token: initial, sharedAudience: true });
      continue;
    }
    const mintRes = await deps
      .fetchFn(state.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: chainRefreshToken,
          client_id: state.clientId,
          resource,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      })
      .catch(() => null);
    if (mintRes?.ok) {
      const token = (await mintRes.json()) as TokenResponse;
      minted.push({ resource, token, sharedAudience: false });
      chainRefreshToken = token.refresh_token ?? chainRefreshToken;
    } else {
      const body = mintRes
        ? await mintRes.text().catch(() => "")
        : "fetch failed";
      console.warn(
        `[plugin-oauth] multi-resource mint rejected for ${state.pluginKey} resource ${resource} (${body}); falling back to sharedAudience`,
      );
      sharedAudience = true;
      minted.push({ resource, token: initial, sharedAudience: true });
    }
  }

  const grantedScopes =
    typeof initial.scope === "string" && initial.scope.trim()
      ? initial.scope.trim().split(/\s+/)
      : state.scope.split(/\s+/).filter((scope) => scope.length > 0);

  const audit: EmitAuditEventInput = {
    tenantId: state.tenantId,
    actorId: state.userId,
    actorType: "user",
    eventType: "plugin.activation_granted",
    source: "lambda",
    payload: {
      pluginInstallId: install.id,
      pluginKey: install.plugin_key,
      tokenCount: minted.length,
      sharedAudience,
    },
    resourceType: "plugin_install",
    resourceId: install.id,
    action: "activate",
    outcome: "success",
  };

  const activation = await deps.store.upsertActivation(
    {
      userId: state.userId,
      pluginInstallId: install.id,
      grantedScopes,
    },
    audit,
  );

  const stage = deps.stage();
  for (const record of minted) {
    const secretName = pluginTokenSecretName({
      stage,
      userId: state.userId,
      pluginInstallId: install.id,
      resourceIndicator: record.resource,
    });
    await deps.secrets.putSecret(
      secretName,
      JSON.stringify({
        access_token: record.token.access_token,
        refresh_token: record.token.refresh_token ?? null,
        token_type: record.token.token_type ?? "Bearer",
        scope: record.token.scope ?? null,
        obtained_at: deps.now().toISOString(),
        client_id: state.clientId,
        token_endpoint: state.tokenEndpoint,
        resource: record.resource,
        shared_audience: record.sharedAudience,
      }),
    );
    await deps.store.upsertActivationToken({
      activationId: activation.id,
      resourceIndicator: record.resource,
      secretRef: secretName,
      expiresAt: record.token.expires_in
        ? new Date(deps.now().getTime() + record.token.expires_in * 1000)
        : null,
    });
  }

  console.log(
    `[plugin-oauth] activation granted: user ${state.userId}, plugin ${install.plugin_key}, ${minted.length} token record(s)${sharedAudience ? " (sharedAudience fallback)" : ""}`,
  );
  return { ok: true, pluginKey: install.plugin_key, returnTo: state.returnTo };
}

// ---------------------------------------------------------------------------
// deactivateActivation
// ---------------------------------------------------------------------------

export async function deactivateActivation(
  args: { userId: string; tenantId: string; pluginInstallId: string },
  deps: PluginActivationDeps = createDefaultPluginActivationDeps(),
): Promise<UserPluginActivationRow> {
  const install = await deps.store.getInstallById(
    args.tenantId,
    args.pluginInstallId,
  );
  if (!install) {
    throw pluginEngineError("NOT_FOUND", "Plugin install not found");
  }
  const activation = await deps.store.getActivationByUserAndInstall(
    args.userId,
    install.id,
  );
  if (!activation) {
    throw pluginEngineError(
      "NOT_FOUND",
      "No activation exists for this plugin",
    );
  }

  // Real Secrets Manager deletion FIRST — a failure here aborts before
  // the rows flip, so a retry re-drives the remaining deletions.
  const tokens = await deps.store.listActivationTokens(activation.id);
  for (const token of tokens) {
    if (token.secret_ref) {
      await deps.secrets.deleteSecret(token.secret_ref);
    }
  }
  await deps.store.deleteActivationTokens(activation.id);

  const audit: EmitAuditEventInput = {
    tenantId: args.tenantId,
    actorId: args.userId,
    actorType: "user",
    eventType: "plugin.activation_revoked",
    source: "graphql",
    payload: {
      pluginInstallId: install.id,
      pluginKey: install.plugin_key,
    },
    resourceType: "plugin_install",
    resourceId: install.id,
    action: "deactivate",
    outcome: "success",
  };
  const revoked = await deps.store.updateActivationStatus(
    activation.id,
    "revoked",
    audit,
  );
  return revoked ?? { ...activation, status: "revoked" };
}

// ---------------------------------------------------------------------------
// markActivationNeedsReauth
// ---------------------------------------------------------------------------

export async function markActivationNeedsReauth(
  activationId: string,
  deps: Pick<PluginActivationDeps, "store"> = {
    store: createDrizzlePluginEngineStore(),
  },
): Promise<void> {
  await deps.store.updateActivationStatus(activationId, "needs_reauth");
}

// ---------------------------------------------------------------------------
// Dispatch-time token resolution (consumed by buildMcpConfigs)
// ---------------------------------------------------------------------------

export interface PluginDispatchAuthResolver {
  /** Gate for non-OAuth plugin servers: requester must hold an active grant. */
  hasActiveActivation(
    requesterUserId: string,
    pluginInstallId: string,
  ): Promise<boolean>;
  /**
   * Resolve the bearer token for one plugin server. Returns null (and
   * logs) on any failure — never throws. Refresh failure flips the
   * activation to needs_reauth and poisons the install for the rest of
   * this resolver's lifetime so the plugin's remaining servers skip.
   */
  resolveToken(args: {
    requesterUserId: string;
    pluginInstallId: string;
    resource: string;
    slug: string;
    logPrefix: string;
  }): Promise<string | null>;
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function createPluginDispatchAuthResolver(
  deps: Pick<PluginActivationDeps, "store" | "secrets" | "fetchFn" | "now"> = {
    store: createDrizzlePluginEngineStore(),
    secrets: createSecretsManagerPluginSecrets(),
    fetchFn: fetch,
    now: () => new Date(),
  },
): PluginDispatchAuthResolver {
  const activationCache = new Map<string, UserPluginActivationRow | null>();
  const failedInstalls = new Set<string>();

  async function getActivation(
    requesterUserId: string,
    pluginInstallId: string,
  ): Promise<UserPluginActivationRow | null> {
    const key = `${requesterUserId}:${pluginInstallId}`;
    if (!activationCache.has(key)) {
      activationCache.set(
        key,
        await deps.store.getActivationByUserAndInstall(
          requesterUserId,
          pluginInstallId,
        ),
      );
    }
    return activationCache.get(key) ?? null;
  }

  return {
    async hasActiveActivation(requesterUserId, pluginInstallId) {
      if (failedInstalls.has(pluginInstallId)) return false;
      const activation = await getActivation(requesterUserId, pluginInstallId);
      return activation?.status === "active";
    },

    async resolveToken({
      requesterUserId,
      pluginInstallId,
      resource,
      slug,
      logPrefix,
    }) {
      try {
        if (failedInstalls.has(pluginInstallId)) return null;
        const activation = await getActivation(
          requesterUserId,
          pluginInstallId,
        );
        if (!activation || activation.status !== "active") {
          console.warn(
            `${logPrefix} Skipping plugin MCP ${slug}: no active activation for user ${requesterUserId}`,
          );
          return null;
        }

        const tokens = await deps.store.listActivationTokens(activation.id);
        const wanted = normalizeResource(resource);
        const tokenRow = tokens.find(
          (row) =>
            normalizeResource(row.resource_indicator) === wanted &&
            row.status === "active",
        );
        if (!tokenRow?.secret_ref) {
          console.warn(
            `${logPrefix} Skipping plugin MCP ${slug}: no token record for resource ${wanted}`,
          );
          return null;
        }

        const secretString = await deps.secrets.getSecret(tokenRow.secret_ref);
        if (!secretString) {
          console.warn(
            `${logPrefix} Skipping plugin MCP ${slug}: token secret missing`,
          );
          return null;
        }
        const parsed = JSON.parse(secretString) as {
          access_token?: string;
          refresh_token?: string | null;
          token_type?: string;
          client_id?: string;
          token_endpoint?: string;
          resource?: string;
          shared_audience?: boolean;
        };

        const nowMs = deps.now().getTime();
        const isExpired =
          tokenRow.expires_at &&
          new Date(tokenRow.expires_at).getTime() - nowMs <
            TOKEN_EXPIRY_BUFFER_MS;
        if (!isExpired) {
          return typeof parsed.access_token === "string"
            ? parsed.access_token
            : null;
        }

        // Refresh-on-expiry per token record. Any failure → needs_reauth
        // + skip the plugin's servers (log, never throw).
        const failReauth = async (detail: string): Promise<null> => {
          console.warn(
            `${logPrefix} Plugin MCP ${slug} token refresh failed (${detail}); marking activation needs_reauth and skipping plugin install ${pluginInstallId}`,
          );
          failedInstalls.add(pluginInstallId);
          await deps.store.updateActivationStatus(
            activation.id,
            "needs_reauth",
          );
          return null;
        };

        if (
          !parsed.refresh_token ||
          !parsed.token_endpoint ||
          !parsed.client_id
        ) {
          return failReauth("no refresh token or refresh metadata");
        }

        const refreshRes = await deps
          .fetchFn(parsed.token_endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: parsed.refresh_token,
              // WorkOS public-client refresh REQUIRES client_id in the body.
              client_id: parsed.client_id,
              resource: parsed.resource ?? wanted,
            }).toString(),
            signal: AbortSignal.timeout(10000),
          })
          .catch(() => null);
        if (!refreshRes?.ok) {
          const detail = refreshRes
            ? `${refreshRes.status} ${await refreshRes.text().catch(() => "")}`
            : "request failed";
          return failReauth(detail);
        }
        const refreshed = (await refreshRes.json()) as TokenResponse;
        await deps.secrets.putSecret(
          tokenRow.secret_ref,
          JSON.stringify({
            ...parsed,
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token ?? parsed.refresh_token,
            obtained_at: deps.now().toISOString(),
          }),
        );
        await deps.store.updateActivationToken(tokenRow.id, {
          expiresAt: refreshed.expires_in
            ? new Date(nowMs + refreshed.expires_in * 1000)
            : null,
        });
        console.log(`${logPrefix} Plugin MCP token refreshed for ${slug}`);
        return refreshed.access_token;
      } catch (error) {
        console.warn(
          `${logPrefix} Plugin MCP token resolution error for ${slug}:`,
          error,
        );
        return null;
      }
    },
  };
}
