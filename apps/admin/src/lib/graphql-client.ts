import { Client, cacheExchange, fetchExchange, subscriptionExchange } from "@urql/core";

// HTTP endpoint for queries/mutations (API Gateway)
const GRAPHQL_HTTP_URL = import.meta.env.VITE_GRAPHQL_HTTP_URL || "";
// AppSync endpoint for WebSocket subscriptions only
const GRAPHQL_WS_URL = import.meta.env.VITE_GRAPHQL_URL || "";
const GRAPHQL_API_KEY = import.meta.env.VITE_GRAPHQL_API_KEY || "";

// Token provider — called on every request so Cognito can refresh expired tokens.
// AuthContext sets this to auth.getIdToken after sign-in.
let tokenProvider: (() => Promise<string | null>) | null = null;
let cachedToken: string | null = null;

export function setAuthToken(token: string | null) {
  cachedToken = token;
}

export function setTokenProvider(provider: (() => Promise<string | null>) | null) {
  tokenProvider = provider;
}

// Eagerly refresh the cached token in the background so fetchOptions
// (which must be synchronous) always has a fresh value.
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startTokenRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(async () => {
    if (!tokenProvider) return;
    try {
      const fresh = await tokenProvider();
      if (fresh) cachedToken = fresh;
    } catch { /* best-effort */ }
  }, 5 * 60 * 1000); // every 5 minutes
}

export function stopTokenRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function authHeaders(): Record<string, string> {
  if (cachedToken) {
    return { Authorization: cachedToken };
  }
  return { "x-api-key": GRAPHQL_API_KEY };
}

// ---------------------------------------------------------------------------
// AppSync Real-time WebSocket (custom protocol, NOT graphql-ws)
//
// AppSync uses its own protocol over WebSocket:
//   1. Connect to wss://<host>/graphql/realtime with auth in URL query params
//   2. Send connection_init message
//   3. Receive connection_ack + ka (keep-alive) messages
//   4. Send start message with subscription query + auth
//   5. Receive data messages
// ---------------------------------------------------------------------------

function getHost(): string {
  if (!GRAPHQL_WS_URL) return "";
  return new URL(GRAPHQL_WS_URL).host;
}

function getRealtimeHost(): string {
  // AppSync real-time uses a different subdomain: appsync-realtime-api instead of appsync-api
  return getHost().replace("appsync-api", "appsync-realtime-api");
}

function buildRealtimeUrl(): string {
  const host = getHost();
  const realtimeHost = getRealtimeHost();
  if (!host || !realtimeHost) return "";

  // Auth header must reference the original API host (not the realtime host)
  const header = btoa(JSON.stringify({
    host,
    "x-api-key": GRAPHQL_API_KEY,
  }));

  return `wss://${realtimeHost}/graphql?header=${encodeURIComponent(header)}&payload=e30=`;
}

type Sink<T = unknown> = {
  next: (value: T) => void;
  error: (error: unknown) => void;
  complete: () => void;
};

class AppSyncSubscriptionClient {
  private ws: WebSocket | null = null;
  private subs = new Map<string, { query: string; variables: Record<string, unknown>; sink: Sink }>();
  private subCounter = 0;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private kaTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    const url = buildRealtimeUrl();
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
          // Start keep-alive timeout (AppSync sends ka every ~4 min, timeout at 5 min)
          const timeout = msg.payload?.connectionTimeoutMs || 300000;
          this.resetKaTimer(timeout);
          // Re-subscribe any pending subscriptions
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
      // No keep-alive received — reconnect
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

  private sendStart(id: string, query: string, variables: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const host = getHost();
    const auth = JSON.stringify({
      host,
      "x-api-key": GRAPHQL_API_KEY,
    });

    this.ws.send(JSON.stringify({
      id,
      type: "start",
      payload: {
        data: JSON.stringify({ query, variables }),
        extensions: {
          authorization: {
            host,
            "x-api-key": GRAPHQL_API_KEY,
          },
        },
      },
    }));
  }

  subscribe(query: string, variables: Record<string, unknown>, sink: Sink): () => void {
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

const appSyncClient = GRAPHQL_WS_URL ? new AppSyncSubscriptionClient() : null;

export const graphqlClient = new Client({
  url: GRAPHQL_HTTP_URL || "https://placeholder.api.us-east-1.amazonaws.com/graphql",
  exchanges: [
    cacheExchange,
    fetchExchange,
    ...(appSyncClient
      ? [
          subscriptionExchange({
            forwardSubscription(request) {
              const query = request.query || "";
              const variables = (request.variables || {}) as Record<string, unknown>;
              return {
                subscribe(sink) {
                  const unsubscribe = appSyncClient.subscribe(query, variables, sink as Sink);
                  return { unsubscribe };
                },
              };
            },
          }),
        ]
      : []),
  ],
  fetchOptions: (): RequestInit => ({
    method: "POST",
    headers: authHeaders(),
  }),
  preferGetMethod: false,
});
