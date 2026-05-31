// Mobile Pi durable turn lease client.
//
// The on-device host owns local execution, but the platform owns durable turn
// identity. This client wraps /api/mobile/turn-session so a local turn can be
// started, heartbeated, checkpointed, backgrounded, aborted, and finalized as
// one logical thread turn.

const DEFAULT_API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(
  /\/graphql$/,
  "",
);

export interface FinalizeChangedFile {
  path: string;
  op: "create" | "modify" | "delete";
  content?: string;
  base_etag?: string;
}

export interface MobileTurnAttachmentRef {
  id?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  s3Key?: string;
}

export interface MobileTurnLeaseStartInput {
  clientTurnId: string;
  threadId: string;
  agentId?: string | null;
  userText: string;
  attachments?: MobileTurnAttachmentRef[];
  metadata?: Record<string, unknown>;
}

export interface MobileTurnLeaseStartResult {
  threadTurnId: string;
  threadId: string;
  userMessageId: string | null;
  status: string;
  checkpointSeq: number;
  idempotent: boolean;
}

export interface MobileTurnCheckpointInput {
  threadTurnId: string;
  checkpoint: Record<string, unknown>;
  message?: string;
  safe?: boolean;
}

export interface MobileTurnLeaseFinalizeInput {
  threadTurnId: string;
  assistantText: string;
  toolResults?: unknown[];
  usage?: { inputTokens?: number; outputTokens?: number };
  changedFiles?: FinalizeChangedFile[];
  diagnostics?: Record<string, unknown>;
}

export interface MobileTurnLeaseClient {
  start(input: MobileTurnLeaseStartInput): Promise<MobileTurnLeaseStartResult>;
  heartbeat(input: {
    threadTurnId: string;
    latestCheckpointSeq?: number;
  }): Promise<{ ok: true }>;
  checkpoint(input: MobileTurnCheckpointInput): Promise<{ seq: number }>;
  background(input: {
    threadTurnId: string;
    reason?: string;
  }): Promise<{ ok: true }>;
  abort(input: {
    threadTurnId: string;
    reason?: string;
  }): Promise<{ ok: true }>;
  finalize(
    input: MobileTurnLeaseFinalizeInput,
  ): Promise<{ finalized: boolean; assistantMessageId: string | null }>;
}

export interface MobileTurnLeaseClientDeps {
  apiBase?: string;
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export type BackgroundSignalSubscribe = (
  handler: (reason: string) => void,
) => () => void;

export function createClientTurnId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `mobile-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

export function subscribeToAppBackground(
  handler: (reason: string) => void,
): () => void {
  let AppState: typeof import("react-native").AppState;
  try {
    ({ AppState } = require("react-native") as typeof import("react-native"));
  } catch {
    // Node-based unit tests do not load React Native's runtime module. The real
    // mobile app resolves this through Metro; tests can inject a subscriber when
    // they need to exercise background behavior.
    return () => undefined;
  }
  let previousState = AppState.currentState;
  const subscription = AppState.addEventListener("change", (nextState) => {
    const wasActive = previousState === "active";
    previousState = nextState;
    if (!wasActive) return;
    if (nextState === "inactive" || nextState === "background") {
      handler(nextState);
    }
  });
  return () => subscription.remove();
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export function createMobileTurnLeaseClient(
  deps: MobileTurnLeaseClientDeps = {},
): MobileTurnLeaseClient {
  const apiBase = deps.apiBase ?? DEFAULT_API_BASE;
  const getToken =
    deps.getToken ?? (async () => (await import("../auth")).getIdToken());
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function post<T>(
    action: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const res = await fetchImpl(`${apiBase}/api/mobile/turn-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await parseJson(res);
    if (!res.ok) {
      throw new Error(
        `mobile-turn-session ${action} ${res.status}: ${
          typeof data.error === "string" ? data.error : "failed"
        }`,
      );
    }
    return data as T;
  }

  return {
    start(input) {
      return post<MobileTurnLeaseStartResult>("start", { ...input });
    },
    heartbeat(input) {
      return post<{ ok: true }>("heartbeat", { ...input });
    },
    checkpoint(input) {
      return post<{ seq: number }>("checkpoint", { ...input });
    },
    background(input) {
      return post<{ ok: true }>("background", { ...input });
    },
    abort(input) {
      return post<{ ok: true }>("abort", { ...input });
    },
    finalize(input) {
      return post<{ finalized: boolean; assistantMessageId: string | null }>(
        "finalize",
        { ...input },
      );
    },
  };
}
