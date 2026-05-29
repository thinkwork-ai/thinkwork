// Device client for persisting a completed harness turn into a platform thread.
//
// The on-device session produces the assistant turn itself, so this records the finished
// user+assistant pair to an existing thread (via /api/threads/record-turn) where it renders
// through the normal message query + subscription. Append-only: thread creation lives in the
// existing CreateThread path (it owns space_id + the per-tenant number sequence). getToken /
// fetch are injectable so this is testable without the Expo auth module.

const DEFAULT_API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(
  /\/graphql$/,
  "",
);

export interface RecordTurnInput {
  threadId: string;
  userText: string;
  assistantText: string;
  toolResults?: unknown[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface RecordTurnDeps {
  apiBase?: string;
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface RecordTurnResult {
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
}

export async function recordTurn(
  input: RecordTurnInput,
  deps: RecordTurnDeps = {},
): Promise<RecordTurnResult> {
  const apiBase = deps.apiBase ?? DEFAULT_API_BASE;
  const getToken =
    deps.getToken ?? (async () => (await import("../auth")).getIdToken());
  const fetchImpl = deps.fetchImpl ?? fetch;

  const token = await getToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetchImpl(`${apiBase}/api/threads/record-turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  const data = (await res
    .json()
    .catch(() => ({}))) as Partial<RecordTurnResult> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(`record-turn ${res.status}: ${data.error ?? "failed"}`);
  }
  return data as RecordTurnResult;
}
