import {
  createHash,
  randomBytes,
  randomFillSync,
  type BinaryLike,
} from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  DeepLinkCallback,
  OAuthSuccessCallback,
  PendingOAuthCallback,
  SignOutResponse,
  StartOAuthRequest,
  StartOAuthResponse,
} from "@thinkwork/desktop-ipc";
import type { SignOutSession } from "./auth-bridge.js";
import type { ICognitoStorage } from "./cognito-storage.js";
import { resolveDeepLinkScheme } from "./deep-link.js";
import type { DesktopEnvSnapshot } from "./env.js";

const DEFAULT_PKCE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_IN_FLIGHT = 5;
const DEFAULT_EVICTION_INTERVAL_MS = 60 * 1000;
const AUTH_CLIENT_STORAGE_KEY = "thinkwork:auth-client-id";

export interface DesktopAppPathLike {
  getPath(name: "userData"): string;
}

export interface DesktopShellLike {
  openExternal(url: string): Promise<unknown>;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface DesktopOAuthOptions {
  env: DesktopEnvProvider;
  storage: ICognitoStorage;
  app: DesktopAppPathLike;
  shell: DesktopShellLike;
  fetch?: FetchLike;
  now?: () => number;
  logger?: Pick<typeof console, "warn" | "error">;
  pkceTtlMs?: number;
  maxInFlight?: number;
  evictionIntervalMs?: number | null;
}

export interface InFlightAttempt {
  verifierBytes: Buffer;
  challenge: string;
  clientId: string;
  createdAt: number;
  env: DesktopEnvSnapshot;
  next?: string;
}

export interface OAuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

interface PublicOAuthOption {
  key: string;
  label: string;
  route: {
    type: "cognitoHostedUi";
    clientId: string;
    identityProvider: string;
    prompt?: string;
  };
}

interface PublicAuthOptionsResponse {
  oauthOptions?: unknown[];
}

export type DesktopEnvProvider =
  | DesktopEnvSnapshot
  | (() => DesktopEnvSnapshot | Promise<DesktopEnvSnapshot>);

export class DesktopOAuthController {
  readonly pendingRevocationsPath: string;

  private readonly envProvider: DesktopEnvProvider;
  private readonly storage: ICognitoStorage;
  private readonly shell: DesktopShellLike;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly logger: Pick<typeof console, "warn" | "error">;
  private readonly pkceTtlMs: number;
  private readonly maxInFlight: number;
  private readonly inFlight = new Map<string, InFlightAttempt>();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DesktopOAuthOptions) {
    this.envProvider = options.env;
    this.storage = options.storage;
    this.shell = options.shell;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
    this.pkceTtlMs = options.pkceTtlMs ?? DEFAULT_PKCE_TTL_MS;
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    this.pendingRevocationsPath = join(
      options.app.getPath("userData"),
      "pending-revocations.json",
    );

    const interval = options.evictionIntervalMs ?? DEFAULT_EVICTION_INTERVAL_MS;
    if (interval !== null) {
      this.evictionTimer = setInterval(
        () => this.evictExpiredAttempts(),
        interval,
      );
      this.evictionTimer.unref?.();
    }
  }

  async startOAuth(
    request: StartOAuthRequest = undefined,
  ): Promise<StartOAuthResponse> {
    const env = await this.currentEnv();
    const options = await this.fetchPublicAuthOptions(env);
    const option = selectPublicAuthOption(options, request?.authOptionKey);

    const verifierBytes = randomBytes(32);
    const verifier = verifierString(verifierBytes);
    const challenge = sha256Base64Url(verifier);
    const state = randomBytes(16).toString("hex");
    const createdAt = this.now();

    this.evictExpiredAttempts(createdAt);
    this.evictOldestAttempts();
    this.inFlight.set(state, {
      verifierBytes,
      challenge,
      clientId: option.route.clientId,
      createdAt,
      env,
      next: request?.next,
    });

    const url = this.buildAuthorizeUrl({
      challenge,
      clientId: option.route.clientId,
      env,
      identityProvider: option.route.identityProvider,
      prompt: option.route.prompt,
      state,
    });
    try {
      await this.shell.openExternal(url);
    } catch (error) {
      this.deleteAttempt(state);
      throw error;
    }

    return { url, state };
  }

  async completeOAuthCallback(
    callback: OAuthSuccessCallback,
  ): Promise<PendingOAuthCallback> {
    this.evictExpiredAttempts();

    const attempt = this.inFlight.get(callback.state);
    if (!attempt) {
      this.zeroizeInFlightAttempts();
      throw new Error("No in-flight OAuth attempt for callback state");
    }

    this.inFlight.delete(callback.state);
    try {
      const tokens = await this.exchangeCodeForTokens(callback.code, attempt);
      verifyTokenAudience(tokens.id_token, attempt.clientId);
      this.persistTokens(
        tokens,
        resolveCognitoUsername(tokens.id_token),
        attempt.clientId,
      );

      return {
        code: callback.code,
        state: callback.state,
        ...(attempt.next ? { next: attempt.next } : {}),
      };
    } finally {
      randomFillSync(attempt.verifierBytes);
    }
  }

  async signOut(session: SignOutSession): Promise<SignOutResponse> {
    if (!session.refreshToken) return { ok: true, revokeFailed: false };
    if (!session.idToken) return { ok: true, revokeFailed: true };

    try {
      await this.revokeNativeSession(session.idToken, session.refreshToken);
      return { ok: true, revokeFailed: false };
    } catch (error) {
      this.logger.warn("[desktop:oauth] refresh-token revoke failed", error);
      return { ok: true, revokeFailed: true };
    }
  }

  async drainPendingRevocations(): Promise<void> {
    // Retire any credential-bearing retry file left by a pre-native build.
    await unlink(this.pendingRevocationsPath).catch(() => undefined);
  }

  zeroizeInFlightAttempts(): void {
    for (const attempt of this.inFlight.values()) {
      randomFillSync(attempt.verifierBytes);
    }
    this.inFlight.clear();
  }

  dispose(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    this.zeroizeInFlightAttempts();
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  private buildAuthorizeUrl(options: {
    challenge: string;
    clientId: string;
    env: DesktopEnvSnapshot;
    identityProvider: string;
    prompt?: string;
    state: string;
  }): string {
    const params = new URLSearchParams({
      identity_provider: options.identityProvider,
      response_type: "code",
      client_id: options.clientId,
      redirect_uri: this.redirectUri(options.env),
      scope: "openid email profile",
      code_challenge: options.challenge,
      code_challenge_method: "S256",
      state: options.state,
    });
    if (options.prompt) params.set("prompt", options.prompt);
    return `${this.cognitoDomainBase(
      options.env,
    )}/oauth2/authorize?${params.toString()}`;
  }

  private async fetchPublicAuthOptions(
    env: DesktopEnvSnapshot,
  ): Promise<PublicOAuthOption[]> {
    const apiBaseUrl = apiBaseUrlForEnv(env);
    if (!apiBaseUrl) throw new Error("Missing desktop API URL");

    try {
      const url = new URL(`${apiBaseUrl}/api/auth/options`);
      url.searchParams.set("platform", "desktop");
      const response = await this.fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response?.ok) throw new Error(`HTTP ${response.status}`);
      const raw = (await response.json()) as PublicAuthOptionsResponse;
      const options = Array.isArray(raw.oauthOptions) ? raw.oauthOptions : [];
      return options.flatMap((entry) => {
        const option = parsePublicOAuthOption(entry);
        return option ? [option] : [];
      });
    } catch (error) {
      this.logger.warn(
        "[desktop:oauth] public auth options unavailable",
        error,
      );
      throw new Error("Desktop login options are unavailable");
    }
  }

  private async exchangeCodeForTokens(
    code: string,
    attempt: InFlightAttempt,
  ): Promise<OAuthTokens> {
    const clientId = attempt.clientId;
    const response = await this.fetchImpl(
      `${this.cognitoDomainBase(attempt.env)}/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: this.redirectUri(attempt.env),
          code,
          code_verifier: verifierString(attempt.verifierBytes),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${await response.text()}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    if (
      typeof raw.id_token !== "string" ||
      typeof raw.access_token !== "string" ||
      typeof raw.refresh_token !== "string"
    ) {
      throw new Error("Token exchange returned an unexpected response shape");
    }

    return {
      id_token: raw.id_token,
      access_token: raw.access_token,
      refresh_token: raw.refresh_token,
    };
  }

  private persistTokens(
    tokens: OAuthTokens,
    username: string,
    clientId: string,
  ): void {
    const prefix = `CognitoIdentityServiceProvider.${clientId}`;
    this.storage.setItem(`${prefix}.${username}.idToken`, tokens.id_token);
    this.storage.setItem(
      `${prefix}.${username}.accessToken`,
      tokens.access_token,
    );
    this.storage.setItem(
      `${prefix}.${username}.refreshToken`,
      tokens.refresh_token,
    );
    this.storage.setItem(`${prefix}.${username}.clockDrift`, "0");
    this.storage.setItem(`${prefix}.LastAuthUser`, username);
    this.storage.setItem(AUTH_CLIENT_STORAGE_KEY, clientId);
  }

  private async revokeNativeSession(
    idToken: string,
    refreshToken: string,
  ): Promise<void> {
    const env = await this.currentEnv();
    const apiBaseUrl = requireConfig(apiBaseUrlForEnv(env), "API URL");
    const response = await this.fetchImpl(`${apiBaseUrl}/api/auth/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      throw new Error(`Token revoke failed: ${await response.text()}`);
    }
  }

  private evictExpiredAttempts(now = this.now()): void {
    for (const [state, attempt] of this.inFlight.entries()) {
      if (now - attempt.createdAt > this.pkceTtlMs) {
        this.deleteAttempt(state);
      }
    }
  }

  private evictOldestAttempts(): void {
    while (this.inFlight.size >= this.maxInFlight) {
      const [oldestState] = [...this.inFlight.entries()].sort(
        ([, a], [, b]) => a.createdAt - b.createdAt,
      )[0] ?? [null];
      if (!oldestState) return;
      this.deleteAttempt(oldestState);
    }
  }

  private deleteAttempt(state: string): void {
    const attempt = this.inFlight.get(state);
    if (attempt) randomFillSync(attempt.verifierBytes);
    this.inFlight.delete(state);
  }

  private async currentEnv(): Promise<DesktopEnvSnapshot> {
    if (typeof this.envProvider === "function") {
      return this.envProvider();
    }
    return this.envProvider;
  }

  private redirectUri(env: DesktopEnvSnapshot): string {
    return `${resolveDeepLinkScheme(
      env.deepLinkScheme ?? env.stage,
    )}://oauth/callback`;
  }

  private cognitoDomainBase(env: DesktopEnvSnapshot): string {
    const raw = requireConfig(env.cognito.domain, "Cognito domain").replace(
      /\/$/,
      "",
    );
    if (raw.startsWith("https://")) return raw;
    const userPoolId = requireConfig(
      env.cognito.userPoolId,
      "Cognito user pool ID",
    );
    const region = userPoolId.split("_", 1)[0];
    if (!region || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
      throw new Error("Cognito user pool ID does not contain a valid region");
    }
    return `https://${raw}.auth.${region}.amazoncognito.com`;
  }
}

function verifierString(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function apiBaseUrlForEnv(env: DesktopEnvSnapshot): string | null {
  const explicit = trimTrailingSlash(env.apiUrl);
  if (explicit) return explicit;
  const graphqlHttp = trimTrailingSlash(env.graphqlHttpUrl);
  if (graphqlHttp) return graphqlHttp.replace(/\/graphql\/?$/, "");
  return null;
}

function trimTrailingSlash(value: string | null): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  return trimmed || null;
}

function parsePublicOAuthOption(raw: unknown): PublicOAuthOption | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const route = record.route;
  if (!route || typeof route !== "object" || Array.isArray(route)) return null;

  const routeRecord = route as Record<string, unknown>;
  const key = safeString(record.key);
  const label = safeString(record.label);
  const clientId = safeString(routeRecord.clientId);
  const identityProvider = safeString(routeRecord.identityProvider);
  const prompt = safeString(routeRecord.prompt);
  if (
    key &&
    label &&
    clientId &&
    record.providerSpecific === true &&
    routeRecord.type === "cognitoHostedUi" &&
    identityProvider
  ) {
    return {
      key,
      label,
      route: {
        type: "cognitoHostedUi",
        clientId,
        identityProvider,
        ...(prompt ? { prompt } : {}),
      },
    };
  }

  return null;
}

function selectPublicAuthOption(
  options: PublicOAuthOption[],
  requestedKey: string | undefined,
): PublicOAuthOption {
  if (requestedKey) {
    const selected = options.find((option) => option.key === requestedKey);
    if (selected) return selected;
    throw new Error(
      `The selected login option "${requestedKey}" is unavailable`,
    );
  }
  if (options.length === 1) return options[0];
  if (options.length === 0) {
    throw new Error("The deployment published no desktop OAuth routes");
  }
  throw new Error("Select a desktop login option before starting OAuth");
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sha256Base64Url(value: BinaryLike): string {
  return createHash("sha256").update(value).digest("base64url");
}

function requireConfig(value: string | null, label: string): string {
  if (!value) throw new Error(`Missing Cognito ${label}`);
  return value;
}

function resolveCognitoUsername(idToken: string): string {
  const [, payloadSegment] = idToken.split(".");
  if (!payloadSegment) {
    throw new Error("ID token is not a JWT");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString());
  } catch {
    throw new Error("ID token payload could not be decoded");
  }

  const username = payload["cognito:username"] ?? payload.sub;
  if (typeof username !== "string" || username.length === 0) {
    throw new Error("ID token did not include a Cognito username");
  }
  return username;
}

function verifyTokenAudience(idToken: string, expectedClientId: string): void {
  const [, payloadSegment] = idToken.split(".");
  if (!payloadSegment) throw new Error("ID token is not a JWT");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString());
  } catch {
    throw new Error("ID token payload could not be decoded");
  }
  if (payload.aud !== expectedClientId) {
    throw new Error(
      "ID token audience did not match the selected desktop route",
    );
  }
}
