import { Client, cacheExchange, fetchExchange, subscriptionExchange } from "urql";
import { randomUUID } from "expo-crypto";
import { setAuthToken as setSdkAuthToken } from "@thinkwork/react-native-sdk";

// AppSync endpoint from environment
const GRAPHQL_URL = process.env.EXPO_PUBLIC_GRAPHQL_URL || "";
const GRAPHQL_API_KEY = process.env.EXPO_PUBLIC_GRAPHQL_API_KEY || "";
const GRAPHQL_WS_URL = process.env.EXPO_PUBLIC_GRAPHQL_WS_URL || "";

console.log("[AppSync WS] Config:", { GRAPHQL_WS_URL: GRAPHQL_WS_URL ? `${GRAPHQL_WS_URL.slice(0, 40)}...` : "(empty)", hasApiKey: !!GRAPHQL_API_KEY });

// ---------------------------------------------------------------------------
// Token management — updated by AuthProvider after sign-in
// ---------------------------------------------------------------------------
let cachedToken: string | null = null;

export function setAuthToken(token: string | null) {
  cachedToken = token;
  setSdkAuthToken(token);
}

// ---------------------------------------------------------------------------
// AppSync real-time WebSocket — single shared connection with multiplexed subs
// ---------------------------------------------------------------------------

function getAuthHeader() {
  // AppSync WS auth requires the *regular* API host (not realtime host)
  // e.g. "xyz.appsync-api.us-east-1.amazonaws.com" not "xyz.appsync-realtime-api..."
  const appsyncHost = GRAPHQL_WS_URL
    ? new URL(GRAPHQL_WS_URL.replace("wss://", "https://").replace("ws://", "http://")).host
        .replace(".appsync-realtime-api.", ".appsync-api.")
    : new URL(GRAPHQL_URL).host;
  return cachedToken
    ? { Authorization: cachedToken, host: appsyncHost }
    : { "x-api-key": GRAPHQL_API_KEY, host: appsyncHost };
}

type Sink = {
  next(value: unknown): void;
  error(error: unknown): void;
  complete(): void;
};

let sharedWs: WebSocket | null = null;
let wsReady = false;
const pendingStarts: Array<() => void> = [];
const activeSubs = new Map<string, Sink>();
let connectionTimeoutMs = 300000;
let kaTimer: ReturnType<typeof setTimeout> | null = null;

function resetKaTimer() {
  if (kaTimer) clearTimeout(kaTimer);
  // If no ka received within the timeout, reconnect
  kaTimer = setTimeout(() => {
    // console.warn("[AppSync WS] Keep-alive timeout, closing connection");
    sharedWs?.close();
    sharedWs = null;
    wsReady = false;
  }, connectionTimeoutMs + 10000);
}

function ensureConnection(): Promise<void> {
  if (wsReady && sharedWs?.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (sharedWs && (sharedWs.readyState === WebSocket.CONNECTING)) {
    return new Promise((resolve) => pendingStarts.push(resolve));
  }

  // Close stale connection if any
  if (sharedWs) {
    sharedWs.close();
    sharedWs = null;
  }
  wsReady = false;

  return new Promise((resolve, reject) => {
    const authHeader = getAuthHeader();
    const headerB64 = btoa(JSON.stringify(authHeader));
    const payloadB64 = btoa(JSON.stringify({}));
    const url = `${GRAPHQL_WS_URL}?header=${encodeURIComponent(headerB64)}&payload=${encodeURIComponent(payloadB64)}`;

    try {
      sharedWs = new WebSocket(url, ["graphql-ws"]);
    } catch (err) {
      reject(err);
      return;
    }

    pendingStarts.push(resolve);

    sharedWs.onopen = () => {
      // console.log("[AppSync WS] Connected, sending connection_init");
      sharedWs?.send(JSON.stringify({ type: "connection_init" }));
    };

    sharedWs.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);

      switch (msg.type) {
        case "connection_ack":
          console.log("[AppSync WS] Connection acknowledged, timeout:", msg.payload?.connectionTimeoutMs);
          connectionTimeoutMs = msg.payload?.connectionTimeoutMs || 300000;
          wsReady = true;
          resetKaTimer();
          // Flush pending subscription starts
          const fns = pendingStarts.splice(0);
          fns.forEach((fn) => fn());
          break;

        case "ka":
          resetKaTimer();
          break;

        case "data":
          console.log("[AppSync WS] Data received for sub:", msg.id, "active:", activeSubs.has(msg.id), "payload:", JSON.stringify(msg.payload).slice(0, 200));
          if (msg.id && activeSubs.has(msg.id)) {
            activeSubs.get(msg.id)!.next(msg.payload);
          }
          break;

        case "error":
          if (msg.id && activeSubs.has(msg.id)) {
            // Non-nullable field errors from subscriptions are benign (e.g. null messageId on
            // NewMessageEvent when a notify mutation fires with empty payload). Log and ignore
            // instead of killing the subscription.
            const errors = msg.payload?.errors ?? msg.payload;
            const isNullFieldError = Array.isArray(errors) && errors.every(
              (e: any) => typeof e?.message === "string" && e.message.includes("Cannot return null for non-nullable type")
            );
            if (isNullFieldError) {
              console.warn("[AppSync WS] Ignoring null-field subscription error for sub:", msg.id);
            } else {
              console.error("[AppSync WS] Subscription error:", msg.payload);
              activeSubs.get(msg.id)!.error(msg.payload);
              activeSubs.delete(msg.id);
            }
          }
          break;

        case "complete":
          if (msg.id && activeSubs.has(msg.id)) {
            activeSubs.get(msg.id)!.complete();
            activeSubs.delete(msg.id);
          }
          break;

        case "connection_error":
          console.error("[AppSync WS] Connection error:", JSON.stringify(msg.payload));
          wsReady = false;
          // Reject all pending
          const rejects = pendingStarts.splice(0);
          rejects.forEach((fn) => fn()); // resolve them anyway, they'll fail on send
          break;
      }
    };

    sharedWs.onerror = (err) => {
      console.error("[AppSync WS] WebSocket error:", err);
      wsReady = false;
    };

    sharedWs.onclose = () => {
      wsReady = false;
      if (kaTimer) clearTimeout(kaTimer);
      // Notify all active subscribers
      activeSubs.forEach((sink) => sink.complete());
      activeSubs.clear();
      sharedWs = null;
    };
  });
}

function createAppSyncSubscription(
  request: { query: string; variables?: Record<string, unknown> },
) {
  return {
    subscribe(sink: Sink) {
      const subId = randomUUID();
      let stopped = false;

      activeSubs.set(subId, sink);

      ensureConnection()
        .then(() => {
          if (stopped) {
            activeSubs.delete(subId);
            return;
          }
          const authHeader = getAuthHeader();
          const startMsg = {
            id: subId,
            type: "start",
            payload: {
              data: JSON.stringify({
                query: request.query,
                variables: request.variables || {},
              }),
              extensions: {
                authorization: authHeader,
              },
            },
          };
          console.log("[AppSync WS] Registering subscription:", subId, "vars:", request.variables);
          sharedWs?.send(JSON.stringify(startMsg));
        })
        .catch((err) => {
          activeSubs.delete(subId);
          sink.error(err);
        });

      return {
        unsubscribe() {
          stopped = true;
          activeSubs.delete(subId);
          if (sharedWs?.readyState === WebSocket.OPEN) {
            sharedWs.send(JSON.stringify({ id: subId, type: "stop" }));
          }
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// urql Client
// ---------------------------------------------------------------------------
let _client: Client | null = null;

function buildClient(): Client {
  const exchanges = [cacheExchange, fetchExchange];

  if (GRAPHQL_WS_URL) {
    exchanges.push(
      subscriptionExchange({
        forwardSubscription(request) {
          return createAppSyncSubscription({
            query: request.query || "",
            variables: request.variables as Record<string, unknown>,
          });
        },
      }),
    );
  }

  return new Client({
    url: GRAPHQL_URL || "https://localhost/graphql",
    exchanges,
    fetchOptions: () => {
      const headers: Record<string, string> = {};
      if (cachedToken) {
        headers["Authorization"] = cachedToken;
      } else if (GRAPHQL_API_KEY) {
        headers["x-api-key"] = GRAPHQL_API_KEY;
      }
      return { headers };
    },
  });
}

export function getGraphqlClient(): Client {
  if (!_client) {
    _client = buildClient();
  }
  return _client;
}

/**
 * Force-close the shared WebSocket so the next subscription attempt
 * opens a fresh connection with the current auth token.
 * Call this when the app returns to foreground after token refresh.
 */
export function reconnectSubscriptions() {
  if (sharedWs) {
    sharedWs.close();
    sharedWs = null;
    wsReady = false;
  }
}

// Eager export for provider
export const graphqlClient = getGraphqlClient();
