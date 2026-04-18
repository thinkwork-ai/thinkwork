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
  };

  const log = config.logger;

  function getAuthHeader() {
    const appsyncHost = wsUrl
      ? new URL(wsUrl.replace("wss://", "https://").replace("ws://", "http://")).host
          .replace(".appsync-realtime-api.", ".appsync-api.")
      : new URL(config.graphqlUrl).host;
    const token = getAuthToken();
    return token
      ? { Authorization: token, host: appsyncHost }
      : config.graphqlApiKey
      ? { "x-api-key": config.graphqlApiKey, host: appsyncHost }
      : { host: appsyncHost };
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
    if (state.ready && state.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (state.ws && state.ws.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve) => state.pendingStarts.push(resolve));
    }
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    state.ready = false;
    return new Promise((resolve, reject) => {
      const header = getAuthHeader();
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
            state.connectionTimeoutMs = msg.payload?.connectionTimeoutMs || 300000;
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
                    (e.message as string).includes("Cannot return null for non-nullable type"),
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
    });
  }

  function forward(request: { query: string; variables?: Record<string, unknown> }) {
    return {
      subscribe(sink: Sink) {
        const subId = randomUUID();
        let stopped = false;
        state.activeSubs.set(subId, sink);
        ensureConnection()
          .then(() => {
            if (stopped) {
              state.activeSubs.delete(subId);
              return;
            }
            state.ws?.send(
              JSON.stringify({
                id: subId,
                type: "start",
                payload: {
                  data: JSON.stringify({
                    query: request.query,
                    variables: request.variables ?? {},
                  }),
                  extensions: { authorization: getAuthHeader() },
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
    }
  }

  return { forward, reconnect };
}
