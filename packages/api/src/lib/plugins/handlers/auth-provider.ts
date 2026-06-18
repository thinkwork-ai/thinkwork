/**
 * Auth-provider component handler (THNK-43 U3).
 *
 * U3 validates the WorkOS-to-Cognito bridge state without mutating Cognito.
 * The handler reads the deployment auth resource + tenant reference, verifies
 * WorkOS OIDC discovery/JWKS with egress guardrails, and confirms Cognito
 * already has the expected IdP attached to every configured app client.
 *
 * Runtime Cognito creation/update remains a deployment-control-plane concern;
 * this handler records only sanitized, fail-closed component state.
 */

import {
  CognitoIdentityProviderClient,
  DescribeIdentityProviderCommand,
  DescribeUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { and, eq } from "drizzle-orm";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  authProviderResources,
  tenantAuthProviderReferences,
} from "@thinkwork/database-pg/schema";
import type { AuthProviderComponent } from "@thinkwork/plugin-catalog";
import { db as defaultDb } from "../../../graphql/utils.js";

type DbLike = typeof defaultDb;

export type AuthProviderValidationStatus =
  | "unconfigured"
  | "validating"
  | "valid"
  | "partially_valid"
  | "invalid"
  | "rotating_secret"
  | "disabled";

export interface AuthProviderConfigSnapshot {
  tenantReferenceId: string;
  authProviderResourceId: string;
  tenantReferenceStatus: "disabled" | "enabled" | "invalid" | string;
  providerKey: string;
  displayName: string;
  cognitoUserPoolId: string;
  cognitoAppClientIds: string[];
  cognitoIdentityProviderName: string;
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  authorizeScopes: string;
  providerOptions: Array<Record<string, unknown>>;
  publicOptionsPublished: boolean;
}

export interface AuthProviderHandlerRef extends Record<string, unknown> {
  status: AuthProviderValidationStatus;
  provider: string;
  cognitoIdentityProviderName: string | null;
  issuerHost: string | null;
  authProviderResourceId: string | null;
  tenantAuthProviderReferenceId: string | null;
  publicOptionsPublished: boolean;
  providerOptions: Array<Record<string, unknown>>;
  lastValidatedAt: string | null;
  diagnosticCode: string | null;
}

export interface OidcDiscoveryDocument {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  userinfo_endpoint?: unknown;
  jwks_uri?: unknown;
  token_endpoint_auth_methods_supported?: unknown;
  id_token_signing_alg_values_supported?: unknown;
}

export interface JwksDocument {
  keys?: unknown;
}

export interface CognitoIdentityProviderSnapshot {
  providerName: string;
  providerType: string;
  providerDetails: Record<string, string>;
}

export interface CognitoUserPoolClientSnapshot {
  clientId: string;
  supportedIdentityProviders: string[];
  callbackUrls: string[];
  logoutUrls: string[];
}

export interface AuthProviderHandlerDeps {
  loadConfig(args: {
    tenantId: string;
    pluginInstallId: string;
    provider: string;
  }): Promise<AuthProviderConfigSnapshot | null>;
  fetchDiscovery(issuerUrl: string): Promise<OidcDiscoveryDocument>;
  fetchJwks(jwksUri: string, issuerUrl: string): Promise<JwksDocument>;
  describeIdentityProvider(args: {
    userPoolId: string;
    providerName: string;
  }): Promise<CognitoIdentityProviderSnapshot | null>;
  describeUserPoolClient(args: {
    userPoolId: string;
    clientId: string;
  }): Promise<CognitoUserPoolClientSnapshot | null>;
  now(): Date;
}

type SafeFetch = (
  input: string,
  init: {
    redirect: "manual";
    signal: AbortSignal;
    headers: Record<string, string>;
  },
) => Promise<Response>;

const SAFE_JSON_LIMIT_BYTES = 128 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const REQUIRED_SCOPES = ["openid", "email", "profile"];
const DEFAULT_ALLOWED_SUFFIXES = [".authkit.app", ".workos.com"];
const DEFAULT_ALLOWED_HOSTS = ["authkit.app", "workos.com"];

export function createDefaultAuthProviderHandlerDeps(
  db: DbLike = defaultDb,
): AuthProviderHandlerDeps {
  const cognito = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  return {
    loadConfig: (args) => loadAuthProviderConfig(args, db),
    fetchDiscovery: (issuerUrl) => fetchOidcDiscovery(issuerUrl),
    fetchJwks: (jwksUri, issuerUrl) => fetchOidcJwks(jwksUri, issuerUrl),
    async describeIdentityProvider(args) {
      try {
        const response = await cognito.send(
          new DescribeIdentityProviderCommand({
            UserPoolId: args.userPoolId,
            ProviderName: args.providerName,
          }),
        );
        const provider = response.IdentityProvider;
        if (!provider?.ProviderName || !provider.ProviderType) return null;
        return {
          providerName: provider.ProviderName,
          providerType: provider.ProviderType,
          providerDetails: provider.ProviderDetails ?? {},
        };
      } catch {
        return null;
      }
    },
    async describeUserPoolClient(args) {
      try {
        const response = await cognito.send(
          new DescribeUserPoolClientCommand({
            UserPoolId: args.userPoolId,
            ClientId: args.clientId,
          }),
        );
        const client = response.UserPoolClient;
        if (!client?.ClientId) return null;
        return {
          clientId: client.ClientId,
          supportedIdentityProviders:
            client.SupportedIdentityProviders ?? [],
          callbackUrls: client.CallbackURLs ?? [],
          logoutUrls: client.LogoutURLs ?? [],
        };
      } catch {
        return null;
      }
    },
    now: () => new Date(),
  };
}

export async function provisionPluginAuthProviderComponent(args: {
  tenantId: string;
  pluginInstallId: string;
  component: AuthProviderComponent;
  handlerRef?: Record<string, unknown>;
  deps?: AuthProviderHandlerDeps;
}): Promise<AuthProviderHandlerRef> {
  const deps = args.deps ?? createDefaultAuthProviderHandlerDeps();
  const config = await deps.loadConfig({
    tenantId: args.tenantId,
    pluginInstallId: args.pluginInstallId,
    provider: args.component.provider,
  });
  if (!config) {
    return handlerRef({
      component: args.component,
      config: null,
      status: "unconfigured",
      diagnosticCode: "AUTH_PROVIDER_CONFIG_MISSING",
      now: deps.now(),
    });
  }
  if (config.tenantReferenceStatus === "disabled") {
    return handlerRef({
      component: args.component,
      config,
      status: "disabled",
      diagnosticCode: "TENANT_AUTH_PROVIDER_DISABLED",
      now: deps.now(),
    });
  }

  const validation = await validateAuthProviderBridge({
    component: args.component,
    config,
    deps,
  });

  return handlerRef({
    component: args.component,
    config,
    status: validation.ok ? "valid" : "invalid",
    diagnosticCode: validation.ok ? null : validation.code,
    now: deps.now(),
  });
}

export async function validateAuthProviderBridge(args: {
  component: AuthProviderComponent;
  config: AuthProviderConfigSnapshot;
  deps: AuthProviderHandlerDeps;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const staticCheck = validateStaticConfig(args.component, args.config);
  if (!staticCheck.ok) return staticCheck;

  let discovery: OidcDiscoveryDocument;
  try {
    discovery = await args.deps.fetchDiscovery(args.config.issuerUrl);
  } catch (error) {
    return {
      ok: false,
      code: diagnosticCode(error, "WORKOS_DISCOVERY_FAILED"),
    };
  }
  const discoveryCheck = validateDiscoveryDocument(
    args.config.issuerUrl,
    discovery,
  );
  if (!discoveryCheck.ok) return discoveryCheck;

  try {
    await args.deps.fetchJwks(
      stringValue(discovery.jwks_uri),
      args.config.issuerUrl,
    );
  } catch (error) {
    return { ok: false, code: diagnosticCode(error, "WORKOS_JWKS_FAILED") };
  }

  const idp = await args.deps.describeIdentityProvider({
    userPoolId: args.config.cognitoUserPoolId,
    providerName: args.config.cognitoIdentityProviderName,
  });
  const idpCheck = validateCognitoIdentityProvider(args.config, idp);
  if (!idpCheck.ok) return idpCheck;

  for (const clientId of args.config.cognitoAppClientIds) {
    const client = await args.deps.describeUserPoolClient({
      userPoolId: args.config.cognitoUserPoolId,
      clientId,
    });
    if (!client) {
      return { ok: false, code: "COGNITO_APP_CLIENT_MISSING" };
    }
    if (
      !client.supportedIdentityProviders.includes(
        args.config.cognitoIdentityProviderName,
      )
    ) {
      return { ok: false, code: "COGNITO_APP_CLIENT_IDP_MISSING" };
    }
  }

  return { ok: true };
}

function validateStaticConfig(
  component: AuthProviderComponent,
  config: AuthProviderConfigSnapshot,
): { ok: true } | { ok: false; code: string } {
  if (config.providerKey !== component.provider) {
    return { ok: false, code: "AUTH_PROVIDER_KEY_MISMATCH" };
  }
  if (
    config.cognitoIdentityProviderName !== component.cognitoIdentityProviderName
  ) {
    return { ok: false, code: "COGNITO_IDP_NAME_MISMATCH" };
  }
  if (!config.clientId.trim() || !config.clientSecretRef.trim()) {
    return { ok: false, code: "WORKOS_CREDENTIAL_REF_MISSING" };
  }
  const scopes = new Set(config.authorizeScopes.split(/\s+/).filter(Boolean));
  for (const scope of REQUIRED_SCOPES) {
    if (!scopes.has(scope)) return { ok: false, code: "WORKOS_SCOPE_MISSING" };
  }
  if (config.cognitoAppClientIds.length === 0) {
    return { ok: false, code: "COGNITO_APP_CLIENTS_MISSING" };
  }
  return { ok: true };
}

function validateDiscoveryDocument(
  issuerUrl: string,
  discovery: OidcDiscoveryDocument,
): { ok: true } | { ok: false; code: string } {
  const normalizedIssuer = normalizeUrl(issuerUrl);
  if (normalizeUrl(stringValue(discovery.issuer)) !== normalizedIssuer) {
    return { ok: false, code: "WORKOS_DISCOVERY_ISSUER_MISMATCH" };
  }
  for (const key of [
    "authorization_endpoint",
    "token_endpoint",
    "userinfo_endpoint",
    "jwks_uri",
  ] as const) {
    const value = stringValue(discovery[key]);
    if (!value || !isHttpsUrl(value)) {
      return {
        ok: false,
        code: `WORKOS_DISCOVERY_${key.toUpperCase()}_INVALID`,
      };
    }
  }
  const authMethods = stringArray(
    discovery.token_endpoint_auth_methods_supported,
  );
  if (!authMethods.includes("client_secret_post")) {
    return { ok: false, code: "WORKOS_DISCOVERY_CLIENT_SECRET_POST_MISSING" };
  }
  const algs = stringArray(discovery.id_token_signing_alg_values_supported);
  if (!algs.includes("RS256")) {
    return { ok: false, code: "WORKOS_DISCOVERY_RS256_MISSING" };
  }
  return { ok: true };
}

function validateCognitoIdentityProvider(
  config: AuthProviderConfigSnapshot,
  idp: CognitoIdentityProviderSnapshot | null,
): { ok: true } | { ok: false; code: string } {
  if (!idp) return { ok: false, code: "COGNITO_IDP_MISSING" };
  if (idp.providerType !== "OIDC") {
    return { ok: false, code: "COGNITO_IDP_TYPE_MISMATCH" };
  }
  if (idp.providerDetails.client_id !== config.clientId) {
    return { ok: false, code: "COGNITO_IDP_CLIENT_ID_MISMATCH" };
  }
  if (
    normalizeUrl(idp.providerDetails.oidc_issuer) !==
    normalizeUrl(config.issuerUrl)
  ) {
    return { ok: false, code: "COGNITO_IDP_ISSUER_MISMATCH" };
  }
  if (idp.providerDetails.token_request_method !== "POST") {
    return { ok: false, code: "COGNITO_IDP_TOKEN_METHOD_INVALID" };
  }
  return { ok: true };
}

function handlerRef(args: {
  component: AuthProviderComponent;
  config: AuthProviderConfigSnapshot | null;
  status: AuthProviderValidationStatus;
  diagnosticCode: string | null;
  now: Date;
}): AuthProviderHandlerRef {
  return {
    status: args.status,
    provider: args.component.provider,
    cognitoIdentityProviderName:
      args.config?.cognitoIdentityProviderName ??
      args.component.cognitoIdentityProviderName,
    issuerHost: args.config ? safeUrlHost(args.config.issuerUrl) : null,
    authProviderResourceId: args.config?.authProviderResourceId ?? null,
    tenantAuthProviderReferenceId: args.config?.tenantReferenceId ?? null,
    publicOptionsPublished:
      args.status === "valid" && args.config?.publicOptionsPublished === true,
    providerOptions:
      args.status === "valid" ? sanitizeProviderOptions(args.config) : [],
    lastValidatedAt:
      args.status === "unconfigured" ? null : args.now.toISOString(),
    diagnosticCode: args.diagnosticCode,
  };
}

function sanitizeProviderOptions(
  config: AuthProviderConfigSnapshot | null,
): Array<Record<string, unknown>> {
  if (!config) return [];
  return config.providerOptions.map((option) => {
    const safe: Record<string, unknown> = {};
    for (const key of [
      "key",
      "displayName",
      "providerSpecific",
      "recommended",
    ]) {
      if (option[key] !== undefined) safe[key] = option[key];
    }
    return safe;
  });
}

async function loadAuthProviderConfig(
  args: { tenantId: string; pluginInstallId: string; provider: string },
  db: DbLike,
): Promise<AuthProviderConfigSnapshot | null> {
  const [row] = await db
    .select({
      tenantReferenceId: tenantAuthProviderReferences.id,
      tenantReferenceStatus: tenantAuthProviderReferences.status,
      authProviderResourceId: authProviderResources.id,
      providerKey: authProviderResources.provider_key,
      displayName: authProviderResources.display_name,
      cognitoUserPoolId: authProviderResources.cognito_user_pool_id,
      cognitoAppClientIds: authProviderResources.cognito_app_client_ids,
      cognitoIdentityProviderName:
        authProviderResources.cognito_identity_provider_name,
      issuerUrl: authProviderResources.issuer_url,
      clientId: authProviderResources.client_id,
      clientSecretRef: authProviderResources.client_secret_ref,
      authorizeScopes: authProviderResources.authorize_scopes,
      providerOptions: authProviderResources.provider_options,
      publicOptionsPublished: authProviderResources.public_options_published,
    })
    .from(tenantAuthProviderReferences)
    .innerJoin(
      authProviderResources,
      eq(
        tenantAuthProviderReferences.auth_provider_resource_id,
        authProviderResources.id,
      ),
    )
    .where(
      and(
        eq(tenantAuthProviderReferences.tenant_id, args.tenantId),
        eq(
          tenantAuthProviderReferences.plugin_install_id,
          args.pluginInstallId,
        ),
        eq(authProviderResources.provider_key, args.provider),
      ),
    )
    .limit(1);
  if (!row) return null;
  return row;
}

export async function fetchOidcDiscovery(
  issuerUrl: string,
  options: { fetch?: SafeFetch; allowedHosts?: string[] } = {},
): Promise<OidcDiscoveryDocument> {
  const issuer = normalizeIssuerUrl(issuerUrl);
  await assertSafeHttpsUrl(issuer, options.allowedHosts);
  const discoveryUrl = new URL(issuer);
  discoveryUrl.pathname = `${discoveryUrl.pathname.replace(
    /\/$/,
    "",
  )}/.well-known/openid-configuration`;
  discoveryUrl.search = "";
  discoveryUrl.hash = "";
  return fetchJson(discoveryUrl.toString(), options.fetch);
}

export async function fetchOidcJwks(
  jwksUri: string,
  issuerUrl: string,
  options: { fetch?: SafeFetch; allowedHosts?: string[] } = {},
): Promise<JwksDocument> {
  const issuerHost = new URL(normalizeIssuerUrl(issuerUrl)).hostname;
  const jwks = new URL(jwksUri);
  if (jwks.hostname !== issuerHost) {
    throw diagnostic("WORKOS_JWKS_HOST_MISMATCH");
  }
  await assertSafeHttpsUrl(jwks.toString(), options.allowedHosts);
  const document = await fetchJson(jwks.toString(), options.fetch);
  const keys = Array.isArray(document.keys) ? document.keys : [];
  if (
    !keys.some(
      (key) =>
        key &&
        typeof key === "object" &&
        typeof (key as Record<string, unknown>).kid === "string",
    )
  ) {
    throw diagnostic("WORKOS_JWKS_KID_MISSING");
  }
  return document;
}

async function fetchJson(
  url: string,
  fetchImpl?: SafeFetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await (fetchImpl ?? fetch)(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (response.status >= 300 && response.status < 400) {
      throw diagnostic("WORKOS_FETCH_REDIRECT_REJECTED");
    }
    if (!response.ok) throw diagnostic("WORKOS_FETCH_HTTP_ERROR");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > SAFE_JSON_LIMIT_BYTES) {
      throw diagnostic("WORKOS_FETCH_RESPONSE_TOO_LARGE");
    }
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw diagnostic("WORKOS_FETCH_INVALID_JSON");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw diagnostic("WORKOS_FETCH_INVALID_JSON");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function assertSafeHttpsUrl(
  value: string,
  extraAllowedHosts: string[] = [],
): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw diagnostic("WORKOS_URL_INVALID");
  }
  if (url.protocol !== "https:") throw diagnostic("WORKOS_URL_NOT_HTTPS");
  const hostname = url.hostname.toLowerCase();
  if (!isAllowedIssuerHost(hostname, extraAllowedHosts)) {
    throw diagnostic("WORKOS_URL_HOST_NOT_ALLOWED");
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw diagnostic("WORKOS_URL_DNS_EMPTY");
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw diagnostic("WORKOS_URL_PRIVATE_ADDRESS");
    }
  }
}

function isAllowedIssuerHost(
  hostname: string,
  extraAllowedHosts: string[],
): boolean {
  const exactHosts = new Set([
    ...DEFAULT_ALLOWED_HOSTS,
    ...extraAllowedHosts.map((host) => host.toLowerCase()),
    ...envAllowedIssuerHosts(),
  ]);
  if (exactHosts.has(hostname)) return true;
  return DEFAULT_ALLOWED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function envAllowedIssuerHosts(): string[] {
  return (process.env.WORKOS_AUTH_ALLOWED_ISSUER_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map((part) => Number(part));
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }
  return true;
}

function diagnostic(code: string): Error {
  const error = new Error(code);
  error.name = "AuthProviderDiagnostic";
  return error;
}

function diagnosticCode(error: unknown, fallback: string): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return fallback;
}

function normalizeIssuerUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return normalizeIssuerUrl(value);
  } catch {
    return null;
  }
}

function safeUrlHost(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
