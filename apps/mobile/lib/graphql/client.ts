import {
  Client,
  cacheExchange,
  fetchExchange,
  subscriptionExchange,
} from "urql";
import { randomUUID } from "expo-crypto";
import { setAuthToken as setSdkAuthToken } from "@thinkwork/react-native-sdk";
import { getPlatformConfig } from "@/lib/platform-config";

// ---------------------------------------------------------------------------
// Token management — updated by AuthProvider after sign-in
// ---------------------------------------------------------------------------
let cachedToken: string | null = null;
let cachedTenantId: string | null = null;

export function setAuthToken(token: string | null) {
  cachedToken = token;
  setSdkAuthToken(token);
}

/** Keep connect tickets bound to the tenant selected by `/api/auth/me`. */
export function setActiveTenantId(tenantId: string | null) {
  if (cachedTenantId === tenantId) return;
  cachedTenantId = tenantId;
  reconnectSubscriptions();
}

// ---------------------------------------------------------------------------
// AppSync real-time WebSocket — single shared connection with multiplexed subs
// ---------------------------------------------------------------------------

function getAppSyncHeader(authorizationToken: string) {
  const config = getPlatformConfig();
  // AppSync WS auth requires the *regular* API host (not realtime host)
  // e.g. "xyz.appsync-api.us-east-1.amazonaws.com" not "xyz.appsync-realtime-api..."
  const appsyncHost = config.graphqlWsUrl
    ? new URL(
        config.graphqlWsUrl
          .replace("wss://", "https://")
          .replace("ws://", "http://"),
      ).host.replace(".appsync-realtime-api.", ".appsync-api.")
    : new URL(config.graphqlUrl).host;
  return { Authorization: authorizationToken, host: appsyncHost };
}

function subscriptionOperationName(query: string): string {
  return query.match(/\bsubscription\s+([_A-Za-z][_0-9A-Za-z]*)/)?.[1] ?? "";
}

async function requestSubscriptionTicket(input: {
  kind: "connect" | "registration";
  query?: string;
  variables?: Record<string, unknown>;
}): Promise<string> {
  if (!cachedToken) throw new Error("Sign in to use realtime updates");
  const config = getPlatformConfig();
  const endpoint = new URL(config.apiUrl || config.graphqlHttpUrl);
  endpoint.pathname = "/api/auth/subscription-ticket";
  endpoint.search = "";
  const requestedTenantId =
    typeof input.variables?.tenantId === "string"
      ? input.variables.tenantId
      : (cachedTenantId ?? undefined);
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: { Authorization: cachedToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: input.kind,
      ...(requestedTenantId ? { tenantId: requestedTenantId } : {}),
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

type Sink = {
  next(value: unknown): void;
  error(error: unknown): void;
  complete(): void;
};

let sharedWs: WebSocket | null = null;
let wsReady = false;
let connectionPromise: Promise<void> | null = null;
let connectionGeneration = 0;
let connectionPromiseGeneration: number | null = null;
let connectionReject: ((error: Error) => void) | null = null;
const activeSubs = new Map<string, Sink>();
let connectionTimeoutMs = 300000;
let kaTimer: ReturnType<typeof setTimeout> | null = null;

class ConnectionSupersededError extends Error {}

function resetKaTimer(socket: WebSocket, generation: number) {
  if (kaTimer) clearTimeout(kaTimer);
  // If no ka received within the timeout, reconnect
  kaTimer = setTimeout(() => {
    if (connectionGeneration === generation && sharedWs === socket) {
      socket.close();
    }
  }, connectionTimeoutMs + 10000);
}

function ensureConnection(): Promise<void> {
  if (wsReady && sharedWs?.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  const generation = connectionGeneration;
  if (connectionPromise && connectionPromiseGeneration === generation) {
    return connectionPromise;
  }

  // Close stale connection if any
  if (sharedWs) {
    const staleSocket = sharedWs;
    sharedWs = null;
    staleSocket.close();
  }
  wsReady = false;

  const opening = new Promise<void>((resolve, reject) => {
    connectionReject = reject;
    void (async () => {
      const config = getPlatformConfig();
      if (!config.graphqlWsUrl) {
        reject(new Error("GraphQL WebSocket URL not configured"));
        return;
      }
      const connectTicket = await requestSubscriptionTicket({
        kind: "connect",
      });
      if (connectionGeneration !== generation) {
        throw new ConnectionSupersededError();
      }
      const authHeader = getAppSyncHeader(connectTicket);
      const headerB64 = btoa(JSON.stringify(authHeader));
      const payloadB64 = btoa(JSON.stringify({}));
      const url = `${config.graphqlWsUrl}?header=${encodeURIComponent(headerB64)}&payload=${encodeURIComponent(payloadB64)}`;

      let socket: WebSocket;
      try {
        socket = new WebSocket(url, ["graphql-ws"]);
      } catch (err) {
        reject(err);
        return;
      }
      if (connectionGeneration !== generation) {
        socket.close();
        throw new ConnectionSupersededError();
      }
      sharedWs = socket;
      let acknowledged = false;
      const isCurrent = () =>
        connectionGeneration === generation && sharedWs === socket;
      const rejectBeforeAcknowledgement = (message: string) => {
        if (!acknowledged) reject(new Error(message));
      };

      socket.onopen = () => {
        if (!isCurrent()) {
          socket.close();
          return;
        }
        // console.log("[AppSync WS] Connected, sending connection_init");
        socket.send(JSON.stringify({ type: "connection_init" }));
      };

      socket.onmessage = (event) => {
        if (!isCurrent()) return;
        const msg = JSON.parse(event.data as string);

        switch (msg.type) {
          case "connection_ack":
            console.log(
              "[AppSync WS] Connection acknowledged, timeout:",
              msg.payload?.connectionTimeoutMs,
            );
            connectionTimeoutMs = msg.payload?.connectionTimeoutMs || 300000;
            acknowledged = true;
            wsReady = true;
            resetKaTimer(socket, generation);
            resolve();
            break;

          case "ka":
            resetKaTimer(socket, generation);
            break;

          case "data":
            console.log(
              "[AppSync WS] Data received for sub:",
              msg.id,
              "active:",
              activeSubs.has(msg.id),
              "payload:",
              JSON.stringify(msg.payload).slice(0, 200),
            );
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
              const isNullFieldError =
                Array.isArray(errors) &&
                errors.every(
                  (e: any) =>
                    typeof e?.message === "string" &&
                    e.message.includes(
                      "Cannot return null for non-nullable type",
                    ),
                );
              if (isNullFieldError) {
                console.warn(
                  "[AppSync WS] Ignoring null-field subscription error for sub:",
                  msg.id,
                );
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
            console.error(
              "[AppSync WS] Connection error:",
              JSON.stringify(msg.payload),
            );
            wsReady = false;
            rejectBeforeAcknowledgement(
              "Realtime connection authorization was rejected",
            );
            break;
        }
      };

      socket.onerror = (err) => {
        if (!isCurrent()) return;
        console.error("[AppSync WS] WebSocket error:", err);
        wsReady = false;
        rejectBeforeAcknowledgement(
          "Realtime connection failed before acknowledgement",
        );
      };

      socket.onclose = () => {
        if (!isCurrent()) return;
        rejectBeforeAcknowledgement(
          "Realtime connection closed before acknowledgement",
        );
        wsReady = false;
        if (kaTimer) clearTimeout(kaTimer);
        kaTimer = null;
        if (acknowledged) {
          // Notify all active subscribers
          activeSubs.forEach((sink) => sink.complete());
          activeSubs.clear();
        }
        sharedWs = null;
      };
    })().catch(reject);
  });
  const tracked = opening.finally(() => {
    if (connectionPromise === tracked) {
      connectionPromise = null;
      connectionPromiseGeneration = null;
      connectionReject = null;
    }
  });
  connectionPromise = tracked;
  connectionPromiseGeneration = generation;
  return tracked;
}

function createAppSyncSubscription(request: {
  query: string;
  variables?: Record<string, unknown>;
}) {
  return {
    subscribe(sink: Sink) {
      const subId = randomUUID();
      let stopped = false;

      activeSubs.set(subId, sink);

      const start = async () => {
        while (!stopped && activeSubs.has(subId)) {
          try {
            await ensureConnection();
            if (stopped || !activeSubs.has(subId)) return;
            const generation = connectionGeneration;
            const socket = sharedWs;
            const registrationTicket = await requestSubscriptionTicket({
              kind: "registration",
              query: request.query,
              variables: request.variables || {},
            });
            if (stopped || !activeSubs.has(subId)) return;
            if (
              connectionGeneration !== generation ||
              sharedWs !== socket ||
              !socket
            ) {
              continue;
            }
            const authHeader = getAppSyncHeader(registrationTicket);
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
            console.log(
              "[AppSync WS] Registering subscription:",
              subId,
              "vars:",
              request.variables,
            );
            socket.send(JSON.stringify(startMsg));
            return;
          } catch (error) {
            if (error instanceof ConnectionSupersededError) continue;
            throw error;
          }
        }
      };
      void start().catch((err) => {
        if (!stopped && activeSubs.has(subId)) {
          activeSubs.delete(subId);
          sink.error(err);
        }
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
let _clientKey: string | null = null;

function buildClient(): Client {
  const config = getPlatformConfig();
  console.log("[AppSync WS] Config:", {
    GRAPHQL_WS_URL: config.graphqlWsUrl
      ? `${config.graphqlWsUrl.slice(0, 40)}...`
      : "(empty)",
  });
  const exchanges = [cacheExchange, fetchExchange];

  if (config.graphqlWsUrl) {
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
    url: config.graphqlUrl || "https://localhost/graphql",
    exchanges,
    fetchOptions: () => {
      const latestConfig = getPlatformConfig();
      const headers: Record<string, string> = {};
      if (cachedToken) {
        headers["Authorization"] = cachedToken;
      }
      return { headers };
    },
  });
}

export function getGraphqlClient(): Client {
  const key = currentClientKey();
  if (!_client || _clientKey !== key) {
    reconnectSubscriptions();
    _client = buildClient();
    _clientKey = key;
  }
  return _client;
}

/**
 * Force-close the shared WebSocket so the next subscription attempt
 * opens a fresh connection with the current auth token.
 * Call this when the app returns to foreground after token refresh.
 */
export function reconnectSubscriptions() {
  const socket = sharedWs;
  const wasReady = wsReady;
  const rejectOpening = connectionReject;
  connectionGeneration += 1;
  sharedWs = null;
  wsReady = false;
  connectionPromise = null;
  connectionPromiseGeneration = null;
  connectionReject = null;
  if (kaTimer) {
    clearTimeout(kaTimer);
    kaTimer = null;
  }
  rejectOpening?.(new ConnectionSupersededError());
  if (wasReady) {
    activeSubs.forEach((sink) => sink.complete());
    activeSubs.clear();
  }
  socket?.close();
}

export function resetGraphqlClientForPlatformConfigChange(): Client {
  reconnectSubscriptions();
  _client = null;
  _clientKey = null;
  return getGraphqlClient();
}

function currentClientKey(): string {
  const config = getPlatformConfig();
  return [config.graphqlUrl, config.graphqlWsUrl].join("|");
}

// Eager export for provider
export const graphqlClient = getGraphqlClient();
