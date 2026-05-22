import {
  createHash,
  randomBytes,
  randomFillSync,
  type BinaryLike,
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DeepLinkCallback,
  PendingOAuthCallback,
  SignOutResponse,
  StartOAuthRequest,
  StartOAuthResponse,
} from "@thinkwork/desktop-ipc";
import type { ICognitoStorage } from "./cognito-storage.js";
import { resolveDeepLinkScheme } from "./deep-link.js";
import type { DesktopEnvSnapshot } from "./env.js";

const DEFAULT_PKCE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_IN_FLIGHT = 5;
const DEFAULT_EVICTION_INTERVAL_MS = 60 * 1000;
const DEFAULT_REVOKE_ATTEMPTS = 3;
const DEFAULT_REVOKE_BUDGET_MS = 5_000;

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
  env: DesktopEnvSnapshot;
  storage: ICognitoStorage;
  app: DesktopAppPathLike;
  shell: DesktopShellLike;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<typeof console, "warn" | "error">;
  pkceTtlMs?: number;
  maxInFlight?: number;
  evictionIntervalMs?: number | null;
  revokeAttempts?: number;
  revokeBudgetMs?: number;
}

export interface InFlightAttempt {
  verifierBytes: Buffer;
  challenge: string;
  createdAt: number;
  next?: string;
}

export interface OAuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

export class DesktopOAuthController {
  readonly pendingRevocationsPath: string;

  private readonly env: DesktopEnvSnapshot;
  private readonly storage: ICognitoStorage;
  private readonly shell: DesktopShellLike;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: Pick<typeof console, "warn" | "error">;
  private readonly pkceTtlMs: number;
  private readonly maxInFlight: number;
  private readonly revokeAttempts: number;
  private readonly revokeBudgetMs: number;
  private readonly inFlight = new Map<string, InFlightAttempt>();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DesktopOAuthOptions) {
    this.env = options.env;
    this.storage = options.storage;
    this.shell = options.shell;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.logger = options.logger ?? console;
    this.pkceTtlMs = options.pkceTtlMs ?? DEFAULT_PKCE_TTL_MS;
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    this.revokeAttempts = options.revokeAttempts ?? DEFAULT_REVOKE_ATTEMPTS;
    this.revokeBudgetMs = options.revokeBudgetMs ?? DEFAULT_REVOKE_BUDGET_MS;
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
    const clientId = requireConfig(this.env.cognito.clientId, "client id");
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
      createdAt,
      next: request?.next,
    });

    const url = this.buildAuthorizeUrl({ challenge, clientId, state });
    try {
      await this.shell.openExternal(url);
    } catch (error) {
      this.deleteAttempt(state);
      throw error;
    }

    return { url, state };
  }

  async completeOAuthCallback(
    callback: DeepLinkCallback,
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
      this.persistTokens(tokens, resolveCognitoUsername(tokens.id_token));

      return {
        code: callback.code,
        state: callback.state,
        ...(attempt.next ? { next: attempt.next } : {}),
      };
    } finally {
      randomFillSync(attempt.verifierBytes);
    }
  }

  async signOut(refreshToken: string | null): Promise<SignOutResponse> {
    if (!refreshToken) {
      return { ok: true, revokeFailed: false };
    }

    try {
      await this.revokeRefreshTokenWithRetry(refreshToken);
      return { ok: true, revokeFailed: false };
    } catch (error) {
      this.logger.warn("[desktop:oauth] refresh-token revoke failed", error);
      await this.queuePendingRevocation(refreshToken);
      return { ok: true, revokeFailed: true };
    }
  }

  async drainPendingRevocations(): Promise<void> {
    const pending = await this.readPendingRevocations();
    if (pending.length === 0) return;

    const stillPending: string[] = [];
    for (const token of pending) {
      try {
        await this.revokeRefreshTokenWithRetry(token);
      } catch (error) {
        this.logger.warn("[desktop:oauth] pending revoke retry failed", error);
        stillPending.push(token);
      }
    }

    await this.writePendingRevocations(stillPending);
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
    state: string;
  }): string {
    const params = new URLSearchParams({
      identity_provider: "Google",
      response_type: "code",
      client_id: options.clientId,
      redirect_uri: this.redirectUri(),
      scope: "openid email profile aws.cognito.signin.user.admin",
      code_challenge: options.challenge,
      code_challenge_method: "S256",
      state: options.state,
      prompt: "select_account",
    });
    return `${this.cognitoDomainBase()}/oauth2/authorize?${params.toString()}`;
  }

  private async exchangeCodeForTokens(
    code: string,
    attempt: InFlightAttempt,
  ): Promise<OAuthTokens> {
    const clientId = requireConfig(this.env.cognito.clientId, "client id");
    const response = await this.fetchImpl(
      `${this.cognitoDomainBase()}/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: this.redirectUri(),
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

  private persistTokens(tokens: OAuthTokens, username: string): void {
    const clientId = requireConfig(this.env.cognito.clientId, "client id");
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
  }

  private async revokeRefreshTokenWithRetry(
    refreshToken: string,
  ): Promise<void> {
    const startedAt = this.now();
    let lastError: unknown;

    for (let attempt = 0; attempt < this.revokeAttempts; attempt += 1) {
      try {
        await this.revokeRefreshToken(refreshToken);
        return;
      } catch (error) {
        lastError = error;
        const elapsed = this.now() - startedAt;
        if (
          attempt === this.revokeAttempts - 1 ||
          elapsed >= this.revokeBudgetMs
        ) {
          break;
        }
        await this.sleep(
          Math.min(250 * 2 ** attempt, this.revokeBudgetMs - elapsed),
        );
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Token revoke failed");
  }

  private async revokeRefreshToken(refreshToken: string): Promise<void> {
    const clientId = requireConfig(this.env.cognito.clientId, "client id");
    const response = await this.fetchImpl(
      `${this.cognitoDomainBase()}/oauth2/revoke`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          token: refreshToken,
        }),
      },
    );

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

  private async queuePendingRevocation(refreshToken: string): Promise<void> {
    const pending = await this.readPendingRevocations();
    if (!pending.includes(refreshToken)) pending.push(refreshToken);
    await this.writePendingRevocations(pending);
  }

  private async readPendingRevocations(): Promise<string[]> {
    try {
      const parsed = JSON.parse(
        await readFile(this.pendingRevocationsPath, "utf8"),
      );
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (value): value is string => typeof value === "string",
      );
    } catch {
      return [];
    }
  }

  private async writePendingRevocations(tokens: string[]): Promise<void> {
    await writeFile(
      this.pendingRevocationsPath,
      JSON.stringify([...new Set(tokens)], null, 2),
    );
  }

  private redirectUri(): string {
    return `${resolveDeepLinkScheme(this.env.stage)}://oauth/callback`;
  }

  private cognitoDomainBase(): string {
    const raw = requireConfig(
      this.env.cognito.domain,
      "Cognito domain",
    ).replace(/\/$/, "");
    if (raw.startsWith("https://")) return raw;
    return `https://${raw}.auth.us-east-1.amazoncognito.com`;
  }
}

function verifierString(bytes: Buffer): string {
  return bytes.toString("base64url");
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
