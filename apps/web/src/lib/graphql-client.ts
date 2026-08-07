import {
  Client,
  cacheExchange,
  fetchExchange,
  subscriptionExchange,
} from "@urql/core";
import { print, type DocumentNode } from "graphql";
import { readRuntimeEnv } from "@/lib/runtime-config";

// HTTP endpoint for queries/mutations (API Gateway). apps/web Phase 1
// AppSync carries the subscription-only realtime schema.
// Collapse accidental double slashes in the path (the api_endpoint terraform
// output carries a trailing slash, so `${base}/graphql` yields `…com//graphql`)
// while preserving the `https://` scheme separator.
function graphqlHttpUrl(): string {
  return readRuntimeEnv("VITE_GRAPHQL_HTTP_URL").replace(/([^:]\/)\/+/g, "$1");
}

function graphqlAppsyncUrl(): string {
  return readRuntimeEnv("VITE_GRAPHQL_URL");
}

function graphqlWsUrl(): string {
  return readRuntimeEnv("VITE_GRAPHQL_WS_URL");
}

// Token provider — called on every request so Cognito can refresh expired tokens.
// AuthContext sets this to auth.getIdToken after sign-in.
let tokenProvider: (() => Promise<string | null>) | null = null;
let cachedToken: string | null = null;
let currentTenantId: string | null = null;
const TOKEN_REFRESH_INTERVAL_MS = 15_000;

export function setAuthToken(token: string | null) {
  if (token !== cachedToken) clearConnectTicketCache();
  cachedToken = token;
}

export function setGraphqlTenantId(tenantId: string | null) {
  currentTenantId = tenantId;
}

export function setTokenProvider(
  provider: (() => Promise<string | null>) | null,
) {
  tokenProvider = provider;
}

// Eagerly refresh the cached token in the background so fetchOptions
// (which must be synchronous) always has a fresh value.
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startTokenRefresh() {
  if (refreshTimer) return;
  void refreshCachedToken();
  refreshTimer = setInterval(async () => {
    await refreshCachedToken();
  }, TOKEN_REFRESH_INTERVAL_MS);
}

export function stopTokenRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Force a one-shot token refresh and update the cached token immediately.
 * The provider (auth.getIdToken) renews an expired id token via the Cognito /
 * OAuth refresh-token path, so this recovers the "[GraphQL] Requester user
 * identity required" error without a full sign-out. Wired to the header refresh
 * control. Best-effort: resolves false if there's no provider or it fails.
 */
export async function refreshAuthTokenNow(): Promise<boolean> {
  return refreshCachedToken();
}

async function refreshCachedToken(): Promise<boolean> {
  if (!tokenProvider) return false;
  try {
    const fresh = await tokenProvider();
    if (fresh) {
      cachedToken = fresh;
      return true;
    }
  } catch {
    /* best-effort — leave the existing cached token in place */
  }
  return false;
}

export function buildGraphqlAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (currentTenantId) {
    headers["x-tenant-id"] = currentTenantId;
  }
  if (cachedToken && !isExpiredJwt(cachedToken)) {
    headers.Authorization = cachedToken;
    return headers;
  }
  return headers;
}

function isExpiredJwt(token: string, skewMs = 0): boolean {
  const [, payload] = token.split(".");
  if (!payload) return false;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { exp?: number };
    return (
      typeof decoded.exp === "number" &&
      decoded.exp * 1000 <= Date.now() + skewMs
    );
  } catch {
    return false;
  }
}

export function buildAppSyncAuthHost(
  graphqlUrl = graphqlAppsyncUrl(),
  realtimeUrl = graphqlWsUrl(),
): string {
  const sourceUrl =
    graphqlUrl ||
    realtimeUrl
      .replace("appsync-realtime-api", "appsync-api")
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:");
  if (!sourceUrl) return "";
  return new URL(sourceUrl).host;
}

export function buildAppSyncRealtimeUrl(
  graphqlUrl = graphqlAppsyncUrl(),
  realtimeUrl = graphqlWsUrl(),
  authorizationToken = "",
): string {
  const host = buildAppSyncAuthHost(graphqlUrl, realtimeUrl);
  const websocketUrl = realtimeUrl
    ? normalizeWebSocketUrl(realtimeUrl)
    : deriveRealtimeUrl(graphqlUrl);
  if (!host || !websocketUrl || !authorizationToken) return "";

  const header = btoa(
    JSON.stringify({
      host,
      Authorization: authorizationToken,
    }),
  );

  return `${websocketUrl}?header=${encodeURIComponent(header)}&payload=e30=`;
}

function normalizeWebSocketUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  return `${url.protocol}//${url.host}${url.pathname || "/graphql"}`;
}

function deriveRealtimeUrl(graphqlUrl: string): string {
  if (!graphqlUrl) return "";
  const url = new URL(graphqlUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.host = url.host.replace("appsync-api", "appsync-realtime-api");
  return `${url.protocol}//${url.host}${url.pathname || "/graphql"}`;
}

/**
 * True when both halves of the realtime endpoint (the AppSync auth host and a
 * websocket URL) resolve from runtime config. Checked *before* minting a
 * connect ticket — an unconfigured endpoint used to mint one ticket per
 * reconnect attempt forever.
 */
export function isRealtimeEndpointConfigured(
  graphqlUrl = graphqlAppsyncUrl(),
  realtimeUrl = graphqlWsUrl(),
): boolean {
  try {
    const host = buildAppSyncAuthHost(graphqlUrl, realtimeUrl);
    const websocketUrl = realtimeUrl
      ? normalizeWebSocketUrl(realtimeUrl)
      : deriveRealtimeUrl(graphqlUrl);
    return Boolean(host && websocketUrl);
  } catch {
    return false;
  }
}

/** 3s → 6s → 12s → 24s → 48s → 60s (capped), ±15% jitter. */
export const RECONNECT_BASE_DELAY_MS = 3_000;
export const RECONNECT_MAX_DELAY_MS = 60_000;
/** Consecutive failed connect attempts before the client goes dormant. */
export const MAX_CONSECUTIVE_CONNECT_FAILURES = 10;
/** Connect tickets live 60s server-side; reuse inside this window. */
export const CONNECT_TICKET_REUSE_MS = 45_000;

export function reconnectDelayMs(
  failureCount: number,
  random: number = Math.random(),
): number {
  const exponent = Math.max(0, failureCount - 1);
  const base = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** exponent,
    RECONNECT_MAX_DELAY_MS,
  );
  const jittered = Math.round(base * (0.85 + random * 0.3));
  return Math.min(jittered, RECONNECT_MAX_DELAY_MS);
}

type Sink<T = unknown> = {
  next: (value: T) => void;
  error: (error: unknown) => void;
  complete: () => void;
};

const REALTIME_UNCONFIGURED_REASON =
  "Realtime endpoint is not configured; live updates are unavailable";

/**
 * Logged at most once per page session — an unconfigured endpoint does not heal
 * on a timer, so repeating the message per attempt is pure noise.
 */
let realtimeConfigErrorLogged = false;

export function resetRealtimeConfigWarningForTest() {
  realtimeConfigErrorLogged = false;
}

export class AppSyncSubscriptionClient {
  private ws: WebSocket | null = null;
  private subs = new Map<
    string,
    { query: string; variables: Record<string, unknown>; sink: Sink }
  >();
  private subCounter = 0;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private kaTimer: ReturnType<typeof setTimeout> | null = null;

  private connecting = false;
  /** Consecutive failures since the last `connection_ack`. */
  private failureCount = 0;
  /** Dormant = no reconnects are scheduled until an explicit wake trigger. */
  private dormant = false;

  constructor() {
    this.bindWakeListeners();
  }

  /** Test/inspection surface — not used by production code paths. */
  get state() {
    return {
      dormant: this.dormant,
      failureCount: this.failureCount,
      subscriptionCount: this.subs.size,
      reconnectScheduled: this.reconnectTimer !== null,
    };
  }

  private onOnline = () => this.wake("online");
  private onVisibilityChange = () => {
    if (document.visibilityState === "visible") this.wake("visible");
  };

  private bindWakeListeners() {
    if (typeof window === "undefined") return;
    window.addEventListener("online", this.onOnline);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  /** Detach wake listeners. Used by tests; the app client lives for the tab. */
  dispose() {
    if (typeof window === "undefined") return;
    window.removeEventListener("online", this.onOnline);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.dormant = true;
  }

  /**
   * Leave dormancy and retry. Resets the failure counter so the backoff ladder
   * starts over, and re-runs the config check by way of `connect()`.
   */
  wake(_reason: "online" | "visible" | "subscribe") {
    if (!this.dormant) return;
    this.dormant = false;
    this.failureCount = 0;
    if (this.subs.size === 0) return;
    void this.connect();
  }

  async connect() {
    if (this.dormant) return;
    if (this.reconnectTimer) return;
    if (
      this.connecting ||
      this.ws?.readyState === WebSocket.CONNECTING ||
      this.ws?.readyState === WebSocket.OPEN
    )
      return;

    // Validate *before* minting: a ticket burned on an unreachable endpoint is
    // the whole runaway-loop bug.
    if (!isRealtimeEndpointConfigured()) {
      if (!realtimeConfigErrorLogged) {
        realtimeConfigErrorLogged = true;
        console.error(
          "[graphql-client] realtime endpoint is not configured (VITE_GRAPHQL_URL / VITE_GRAPHQL_WS_URL). Subscriptions are disabled for this session.",
        );
      }
      this.goDormant(REALTIME_UNCONFIGURED_REASON, { log: false });
      return;
    }

    this.connecting = true;
    let url: string;
    try {
      const ticket = await requestConnectTicket();
      url = buildAppSyncRealtimeUrl(undefined, undefined, ticket);
      if (!url) throw new Error(REALTIME_UNCONFIGURED_REASON);
    } catch (cause) {
      this.connecting = false;
      this.handleConnectFailure(cause);
      return;
    }

    try {
      this.ws = new WebSocket(url, ["graphql-ws"]);
    } catch (cause) {
      this.connecting = false;
      this.handleConnectFailure(cause);
      return;
    }

    this.ws.onopen = () => {
      this.connecting = false;
      this.ws?.send(JSON.stringify({ type: "connection_init" }));
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "connection_ack": {
          this.connected = true;
          this.failureCount = 0;
          this.resetKaTimer(msg.payload?.connectionTimeoutMs || 300000);
          for (const [id, sub] of this.subs) {
            void this.sendStart(id, sub.query, sub.variables);
          }
          break;
        }
        case "ka":
          this.resetKaTimer(300000);
          break;
        case "data": {
          const sub = this.subs.get(msg.id);
          if (sub && msg.payload?.data) {
            sub.sink.next({ data: msg.payload.data });
          }
          break;
        }
        case "error": {
          const sub = this.subs.get(msg.id);
          if (sub) {
            sub.sink.error(msg.payload?.errors || msg.payload);
          }
          break;
        }
        case "complete": {
          const sub = this.subs.get(msg.id);
          if (sub) {
            sub.sink.complete();
            this.subs.delete(msg.id);
          }
          break;
        }
      }
    };

    this.ws.onclose = () => {
      this.connecting = false;
      this.connected = false;
      this.ws = null;
      this.handleConnectFailure(new Error("Realtime socket closed"));
    };

    this.ws.onerror = () => {
      this.connected = false;
    };
  }

  private handleConnectFailure(cause: unknown) {
    this.failureCount += 1;
    // Rate-limited: first failure, then every 5th, then the dormancy log.
    if (this.failureCount === 1 || this.failureCount % 5 === 0) {
      console.error("[graphql-client] realtime connect failed", {
        attempt: this.failureCount,
        cause,
      });
    }
    if (this.failureCount >= MAX_CONSECUTIVE_CONNECT_FAILURES) {
      this.goDormant(
        `Realtime updates are unavailable after ${this.failureCount} failed connection attempts`,
      );
      return;
    }
    this.scheduleReconnect();
  }

  /**
   * Stop retrying and tell mounted sinks, so UI shows a degraded state instead
   * of hanging on `fetching` forever. Only an explicit wake trigger resumes.
   */
  private goDormant(reason: string, options: { log?: boolean } = {}) {
    this.dormant = true;
    this.connecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (options.log !== false) {
      console.error("[graphql-client] realtime subscriptions dormant:", reason);
    }
    const failure = new Error(reason);
    for (const [, sub] of this.subs) sub.sink.error(failure);
  }

  private resetKaTimer(timeout: number) {
    if (this.kaTimer) clearTimeout(this.kaTimer);
    this.kaTimer = setTimeout(() => {
      this.ws?.close();
    }, timeout + 10000);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.dormant) return;
    // Nothing is listening — reconnecting would only mint tickets.
    if (this.subs.size === 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, reconnectDelayMs(this.failureCount));
  }

  private async sendStart(
    id: string,
    query: string,
    variables: Record<string, unknown>,
  ) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const host = buildAppSyncAuthHost();
    let ticket: string;
    try {
      ticket = await requestSubscriptionTicket({
        kind: "registration",
        query,
        variables,
      });
    } catch (cause) {
      this.subs.get(id)?.sink.error(cause);
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.subs.has(id))
      return;
    this.ws.send(
      JSON.stringify({
        id,
        type: "start",
        payload: {
          data: JSON.stringify({
            query,
            variables,
            // The Lambda authorizer binds registration tickets to the
            // operation name; AppSync only forwards it to the authorizer when
            // the start payload carries it explicitly.
            operationName: subscriptionOperationName(query),
          }),
          extensions: {
            authorization: {
              host,
              Authorization: ticket,
            },
          },
        },
      }),
    );
  }

  subscribe(query: string, variables: Record<string, unknown>, sink: Sink) {
    const id = String(++this.subCounter);
    this.subs.set(id, { query, variables, sink });

    // A new subscriber is an explicit wake trigger.
    this.wake("subscribe");

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.ws) void this.connect();
    } else if (this.connected) {
      void this.sendStart(id, query, variables);
    }

    return () => {
      this.subs.delete(id);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ id, type: "stop" }));
      }
    };
  }
}

function subscriptionOperationName(query: string): string {
  return query.match(/\bsubscription\s+([_A-Za-z][_0-9A-Za-z]*)/)?.[1] ?? "";
}

/**
 * Connect tickets are not operation-bound, so one can serve several reconnects
 * inside its 60s server TTL. Keyed by the access token that minted it so a
 * token refresh or sign-out can never reuse a stale principal's ticket.
 */
let connectTicketCache: {
  token: string;
  fetchedAt: number;
  identity: string;
} | null = null;

export function clearConnectTicketCache() {
  connectTicketCache = null;
}

async function requestConnectTicket(): Promise<string> {
  const identity = cachedToken ?? "";
  if (
    connectTicketCache &&
    connectTicketCache.identity === identity &&
    Date.now() - connectTicketCache.fetchedAt < CONNECT_TICKET_REUSE_MS
  ) {
    return connectTicketCache.token;
  }
  const token = await requestSubscriptionTicket({ kind: "connect" });
  connectTicketCache = { token, fetchedAt: Date.now(), identity };
  return token;
}

async function requestSubscriptionTicket(input: {
  kind: "connect" | "registration";
  query?: string;
  variables?: Record<string, unknown>;
}): Promise<string> {
  if (!currentTenantId || !cachedToken || isExpiredJwt(cachedToken)) {
    throw new Error(
      "Sign in and select an environment to use realtime updates",
    );
  }
  const url = new URL(graphqlHttpUrl());
  url.pathname = "/api/auth/subscription-ticket";
  url.search = "";
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: cachedToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: input.kind,
      tenantId: currentTenantId,
      ...(input.kind === "registration"
        ? {
            operationName: subscriptionOperationName(input.query ?? ""),
            query: input.query,
            variables: input.variables ?? {},
          }
        : {}),
    }),
  });
  if (!response.ok)
    throw new Error("Realtime authorization is temporarily unavailable");
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== "string" || !body.token.startsWith("twsub1_")) {
    throw new Error("Realtime authorization response was invalid");
  }
  return body.token;
}

const appSyncClient = new AppSyncSubscriptionClient();

export const graphqlClient = new Client({
  url:
    graphqlHttpUrl() ||
    "https://placeholder.api.us-east-1.amazonaws.com/graphql",
  exchanges: [
    cacheExchange,
    fetchExchange,
    subscriptionExchange({
      forwardSubscription(request) {
        const query = serializeGraphqlQuery(request.query);
        const variables = (request.variables || {}) as Record<string, unknown>;
        return {
          subscribe(sink) {
            const unsubscribe = appSyncClient.subscribe(
              query,
              variables,
              sink as Sink,
            );
            return { unsubscribe };
          },
        };
      },
    }),
  ],
  fetchOptions: (): RequestInit => ({
    method: "POST",
    headers: buildGraphqlAuthHeaders(),
  }),
  preferGetMethod: false,
});

export function serializeGraphqlQuery(
  query: string | DocumentNode | undefined,
): string {
  if (!query) return "";
  return typeof query === "string" ? query : print(query);
}
