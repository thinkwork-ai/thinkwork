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

function graphqlApiKey(): string {
  return readRuntimeEnv("VITE_GRAPHQL_API_KEY");
}

// Token provider — called on every request so Cognito can refresh expired tokens.
// AuthContext sets this to auth.getIdToken after sign-in.
let tokenProvider: (() => Promise<string | null>) | null = null;
let cachedToken: string | null = null;
let currentTenantId: string | null = null;
const TOKEN_REFRESH_INTERVAL_MS = 15_000;

export function setAuthToken(token: string | null) {
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
  refreshTimer = setInterval(
    async () => {
      await refreshCachedToken();
    },
    TOKEN_REFRESH_INTERVAL_MS,
  );
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
  const apiKey = graphqlApiKey();
  if (apiKey) {
    headers["x-api-key"] = apiKey;
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
  apiKey = graphqlApiKey(),
): string {
  const host = buildAppSyncAuthHost(graphqlUrl, realtimeUrl);
  const websocketUrl = realtimeUrl
    ? normalizeWebSocketUrl(realtimeUrl)
    : deriveRealtimeUrl(graphqlUrl);
  if (!host || !websocketUrl || !apiKey) return "";

  const header = btoa(
    JSON.stringify({
      host,
      "x-api-key": apiKey,
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

type Sink<T = unknown> = {
  next: (value: T) => void;
  error: (error: unknown) => void;
  complete: () => void;
};

class AppSyncSubscriptionClient {
  private ws: WebSocket | null = null;
  private subs = new Map<
    string,
    { query: string; variables: Record<string, unknown>; sink: Sink }
  >();
  private subCounter = 0;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private kaTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    const url = buildAppSyncRealtimeUrl();
    if (!url) return;

    try {
      this.ws = new WebSocket(url, ["graphql-ws"]);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({ type: "connection_init" }));
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "connection_ack": {
          this.connected = true;
          this.resetKaTimer(msg.payload?.connectionTimeoutMs || 300000);
          for (const [id, sub] of this.subs) {
            this.sendStart(id, sub.query, sub.variables);
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
      this.connected = false;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.connected = false;
    };
  }

  private resetKaTimer(timeout: number) {
    if (this.kaTimer) clearTimeout(this.kaTimer);
    this.kaTimer = setTimeout(() => {
      this.ws?.close();
    }, timeout + 10000);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private sendStart(
    id: string,
    query: string,
    variables: Record<string, unknown>,
  ) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const host = buildAppSyncAuthHost();
    this.ws.send(
      JSON.stringify({
        id,
        type: "start",
        payload: {
          data: JSON.stringify({ query, variables }),
          extensions: {
            authorization: {
              host,
              "x-api-key": graphqlApiKey(),
            },
          },
        },
      }),
    );
  }

  subscribe(query: string, variables: Record<string, unknown>, sink: Sink) {
    const id = String(++this.subCounter);
    this.subs.set(id, { query, variables, sink });

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.ws) this.connect();
    } else if (this.connected) {
      this.sendStart(id, query, variables);
    }

    return () => {
      this.subs.delete(id);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ id, type: "stop" }));
      }
    };
  }
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
