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
  activeSubs: Map<string, Sink>;
  connectionTimeoutMs: number;
  kaTimer: ReturnType<typeof setTimeout> | null;
  connectionPromise: Promise<void> | null;
  connectionGeneration: number;
  connectionPromiseGeneration: number | null;
  connectionReject: ((error: Error) => void) | null;
}

class ConnectionSupersededError extends Error {}

/**
 * Builds an AppSync-compliant subscription transport.
 * Exposed as a function so each urql client instance owns its own WebSocket.
 */
export function createAppSyncSubscriptionTransport(config: ThinkworkConfig) {
  const wsUrl = config.graphqlWsUrl ?? "";
  const state: WsState = {
    ws: null,
    ready: false,
    activeSubs: new Map(),
    connectionTimeoutMs: 300000,
    kaTimer: null,
    connectionPromise: null,
    connectionGeneration: 0,
    connectionPromiseGeneration: null,
    connectionReject: null,
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

  function resetKaTimer(socket: WebSocket, generation: number) {
    if (state.kaTimer) clearTimeout(state.kaTimer);
    state.kaTimer = setTimeout(() => {
      if (state.connectionGeneration === generation && state.ws === socket) {
        socket.close();
      }
    }, state.connectionTimeoutMs + 10000);
  }

  function ensureConnection(): Promise<void> {
    if (state.ready && state.ws?.readyState === WebSocket.OPEN)
      return Promise.resolve();
    const generation = state.connectionGeneration;
    if (
      state.connectionPromise &&
      state.connectionPromiseGeneration === generation
    ) {
      return state.connectionPromise;
    }
    if (state.ws) {
      const staleSocket = state.ws;
      state.ws = null;
      staleSocket.close();
    }
    state.ready = false;
    const opening = new Promise<void>((resolve, reject) => {
      state.connectionReject = reject;
      void (async () => {
        const header = getAuthHeader(await requestTicket({ kind: "connect" }));
        if (state.connectionGeneration !== generation) {
          throw new ConnectionSupersededError();
        }
        const headerB64 = btoa(JSON.stringify(header));
        const payloadB64 = btoa(JSON.stringify({}));
        const url = `${wsUrl}?header=${encodeURIComponent(headerB64)}&payload=${encodeURIComponent(payloadB64)}`;
        let socket: WebSocket;
        try {
          socket = new WebSocket(url, ["graphql-ws"]);
        } catch (err) {
          reject(err);
          return;
        }
        if (state.connectionGeneration !== generation) {
          socket.close();
          throw new ConnectionSupersededError();
        }
        state.ws = socket;
        let acknowledged = false;
        const isCurrent = () =>
          state.connectionGeneration === generation && state.ws === socket;
        const rejectBeforeAcknowledgement = (message: string) => {
          if (!acknowledged) reject(new Error(message));
        };

        socket.onopen = () => {
          if (!isCurrent()) {
            socket.close();
            return;
          }
          socket.send(JSON.stringify({ type: "connection_init" }));
        };

        socket.onmessage = (event) => {
          if (!isCurrent()) return;
          const msg = JSON.parse(event.data as string);
          switch (msg.type) {
            case "connection_ack":
              state.connectionTimeoutMs =
                msg.payload?.connectionTimeoutMs || 300000;
              acknowledged = true;
              state.ready = true;
              resetKaTimer(socket, generation);
              resolve();
              break;
            case "ka":
              resetKaTimer(socket, generation);
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
              rejectBeforeAcknowledgement(
                "Realtime connection authorization was rejected",
              );
              break;
          }
        };

        socket.onerror = (err) => {
          if (!isCurrent()) return;
          log?.error("appsync ws error", err);
          rejectBeforeAcknowledgement(
            "Realtime connection failed before acknowledgement",
          );
          state.ready = false;
        };

        socket.onclose = () => {
          if (!isCurrent()) return;
          rejectBeforeAcknowledgement(
            "Realtime connection closed before acknowledgement",
          );
          state.ready = false;
          if (state.kaTimer) clearTimeout(state.kaTimer);
          state.kaTimer = null;
          if (acknowledged) {
            state.activeSubs.forEach((sink) => sink.complete());
            state.activeSubs.clear();
          }
          state.ws = null;
        };
      })().catch(reject);
    });
    const tracked = opening.finally(() => {
      if (state.connectionPromise === tracked) {
        state.connectionPromise = null;
        state.connectionPromiseGeneration = null;
        state.connectionReject = null;
      }
    });
    state.connectionPromise = tracked;
    state.connectionPromiseGeneration = generation;
    return tracked;
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
        const start = async () => {
          while (!stopped && state.activeSubs.has(subId)) {
            try {
              await ensureConnection();
              if (stopped || !state.activeSubs.has(subId)) return;
              const generation = state.connectionGeneration;
              const socket = state.ws;
              const registrationTicket = await requestTicket({
                kind: "registration",
                query: request.query,
                variables: request.variables ?? {},
              });
              if (stopped || !state.activeSubs.has(subId)) return;
              if (
                state.connectionGeneration !== generation ||
                state.ws !== socket ||
                !socket
              ) {
                continue;
              }
              socket.send(
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
              return;
            } catch (error) {
              if (error instanceof ConnectionSupersededError) continue;
              throw error;
            }
          }
        };
        void start().catch((err) => {
          if (!stopped && state.activeSubs.has(subId)) {
            state.activeSubs.delete(subId);
            sink.error(err);
          }
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
    const socket = state.ws;
    const wasReady = state.ready;
    const rejectOpening = state.connectionReject;
    state.connectionGeneration += 1;
    state.ws = null;
    state.ready = false;
    state.connectionPromise = null;
    state.connectionPromiseGeneration = null;
    state.connectionReject = null;
    if (state.kaTimer) {
      clearTimeout(state.kaTimer);
      state.kaTimer = null;
    }
    rejectOpening?.(new ConnectionSupersededError());
    if (wasReady) {
      state.activeSubs.forEach((sink) => sink.complete());
      state.activeSubs.clear();
    }
    socket?.close();
  }

  return { forward, reconnect };
}
