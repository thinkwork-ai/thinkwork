import { randomUUID } from "expo-crypto";
import type { ThinkworkConfig } from "../types";
import { getAuthToken } from "./token";

type Sink = {
  next(value: unknown): void;
  error(error: unknown): void;
  complete(): void;
};

interface WsState {
  ws: WebSocket | null;
  ready: boolean;
  pendingStarts: Array<() => void>;
  activeSubs: Map<string, Sink>;
  connectionTimeoutMs: number;
  kaTimer: ReturnType<typeof setTimeout> | null;
  connectionPromise: Promise<void> | null;
}

/**
 * Builds an AppSync-compliant subscription transport.
 * Exposed as a function so each urql client instance owns its own WebSocket.
 */
export function createAppSyncSubscriptionTransport(config: ThinkworkConfig) {
  const wsUrl = config.graphqlWsUrl ?? "";
  const state: WsState = {
    ws: null,
    ready: false,
    pendingStarts: [],
    activeSubs: new Map(),
    connectionTimeoutMs: 300000,
    kaTimer: null,
    connectionPromise: null,
  };

  const log = config.logger;

  function getAuthHeader(authorizationToken: string) {
    const appsyncHost = wsUrl
      ? new URL(
          wsUrl.replace("wss://", "https://").replace("ws://", "http://"),
        ).host.replace(".appsync-realtime-api.", ".appsync-api.")
      : new URL(config.graphqlUrl).host;
    return { Authorization: authorizationToken, host: appsyncHost };
  }

  function operationName(query: string): string {
    return query.match(/\bsubscription\s+([_A-Za-z][_0-9A-Za-z]*)/)?.[1] ?? "";
  }

  async function requestTicket(input: {
    kind: "connect" | "registration";
    query?: string;
    variables?: Record<string, unknown>;
  }): Promise<string> {
    const idToken = getAuthToken();
    if (!idToken) throw new Error("Sign in to use realtime updates");
    const endpoint = new URL(config.apiBaseUrl || config.graphqlUrl);
    endpoint.pathname = "/api/auth/subscription-ticket";
    endpoint.search = "";
    const tenantId =
      config.tenantId ??
      (typeof input.variables?.tenantId === "string"
        ? input.variables.tenantId
        : undefined);
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { Authorization: idToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: input.kind,
        ...(tenantId ? { tenantId } : {}),
        ...(input.kind === "registration"
          ? {
              operationName: operationName(input.query ?? ""),
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

  function resetKaTimer() {
    if (state.kaTimer) clearTimeout(state.kaTimer);
    state.kaTimer = setTimeout(() => {
      state.ws?.close();
      state.ws = null;
      state.ready = false;
    }, state.connectionTimeoutMs + 10000);
  }

  function ensureConnection(): Promise<void> {
    if (state.ready && state.ws?.readyState === WebSocket.OPEN)
      return Promise.resolve();
    if (state.connectionPromise) return state.connectionPromise;
    if (state.ws && state.ws.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve) => state.pendingStarts.push(resolve));
    }
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    state.ready = false;
    const opening = new Promise<void>((resolve, reject) => {
      void (async () => {
        const header = getAuthHeader(await requestTicket({ kind: "connect" }));
        const headerB64 = btoa(JSON.stringify(header));
        const payloadB64 = btoa(JSON.stringify({}));
        const url = `${wsUrl}?header=${encodeURIComponent(headerB64)}&payload=${encodeURIComponent(payloadB64)}`;
        try {
          state.ws = new WebSocket(url, ["graphql-ws"]);
        } catch (err) {
          reject(err);
          return;
        }
        state.pendingStarts.push(resolve);

        state.ws.onopen = () => {
          state.ws?.send(JSON.stringify({ type: "connection_init" }));
        };

        state.ws.onmessage = (event) => {
          const msg = JSON.parse(event.data as string);
          switch (msg.type) {
            case "connection_ack":
              state.connectionTimeoutMs =
                msg.payload?.connectionTimeoutMs || 300000;
              state.ready = true;
              resetKaTimer();
              state.pendingStarts.splice(0).forEach((fn) => fn());
              break;
            case "ka":
              resetKaTimer();
              break;
            case "data":
              if (msg.id && state.activeSubs.has(msg.id)) {
                state.activeSubs.get(msg.id)!.next(msg.payload);
              }
              break;
            case "error":
              if (msg.id && state.activeSubs.has(msg.id)) {
                const errors = msg.payload?.errors ?? msg.payload;
                const isNullFieldError =
                  Array.isArray(errors) &&
                  errors.every(
                    (e: { message?: unknown }) =>
                      typeof e?.message === "string" &&
                      (e.message as string).includes(
                        "Cannot return null for non-nullable type",
                      ),
                  );
                if (isNullFieldError) {
                  log?.warn("appsync ws: ignoring null-field error", msg.id);
                } else {
                  state.activeSubs.get(msg.id)!.error(msg.payload);
                  state.activeSubs.delete(msg.id);
                }
              }
              break;
            case "complete":
              if (msg.id && state.activeSubs.has(msg.id)) {
                state.activeSubs.get(msg.id)!.complete();
                state.activeSubs.delete(msg.id);
              }
              break;
            case "connection_error":
              log?.error("appsync ws connection_error", msg.payload);
              state.ready = false;
              state.pendingStarts.splice(0).forEach((fn) => fn());
              break;
          }
        };

        state.ws.onerror = (err) => {
          log?.error("appsync ws error", err);
          state.ready = false;
        };

        state.ws.onclose = () => {
          state.ready = false;
          if (state.kaTimer) clearTimeout(state.kaTimer);
          state.activeSubs.forEach((sink) => sink.complete());
          state.activeSubs.clear();
          state.ws = null;
        };
      })().catch(reject);
    });
    state.connectionPromise = opening.finally(() => {
      state.connectionPromise = null;
    });
    return state.connectionPromise;
  }

  function forward(request: {
    query: string;
    variables?: Record<string, unknown>;
  }) {
    return {
      subscribe(sink: Sink) {
        const subId = randomUUID();
        let stopped = false;
        state.activeSubs.set(subId, sink);
        ensureConnection()
          .then(async () => {
            if (stopped) {
              state.activeSubs.delete(subId);
              return;
            }
            const registrationTicket = await requestTicket({
              kind: "registration",
              query: request.query,
              variables: request.variables ?? {},
            });
            state.ws?.send(
              JSON.stringify({
                id: subId,
                type: "start",
                payload: {
                  data: JSON.stringify({
                    query: request.query,
                    variables: request.variables ?? {},
                  }),
                  extensions: {
                    authorization: getAuthHeader(registrationTicket),
                  },
                },
              }),
            );
          })
          .catch((err) => {
            state.activeSubs.delete(subId);
            sink.error(err);
          });
        return {
          unsubscribe() {
            stopped = true;
            state.activeSubs.delete(subId);
            if (state.ws?.readyState === WebSocket.OPEN) {
              state.ws.send(JSON.stringify({ id: subId, type: "stop" }));
            }
          },
        };
      },
    };
  }

  function reconnect() {
    if (state.ws) {
      state.ws.close();
      state.ws = null;
      state.ready = false;
      state.connectionPromise = null;
    }
  }

  return { forward, reconnect };
}
