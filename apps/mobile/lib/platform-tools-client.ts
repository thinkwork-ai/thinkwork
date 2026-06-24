/**
 * Platform tools client for the on-device Pi harness.
 *
 * These are ThinkWork built-in tools (not MCP). The device owns the loop and the
 * model-visible tool shape; the platform resolves tenant config, permissions, and
 * provider secrets server-side behind the caller's Cognito idToken.
 */

const DEFAULT_API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(
  /\/graphql$/,
  "",
);

export interface PlatformToolDeps {
  apiBase?: string;
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface PlatformToolResult {
  content: unknown;
  isError?: boolean;
}

export class PlatformToolClientError extends Error {
  readonly status: number;
  readonly kind: "auth" | "transport" | "unknown";

  constructor(status: number, message: string) {
    super(message);
    this.name = "PlatformToolClientError";
    this.status = status;
    this.kind =
      status === 401 || status === 403
        ? "auth"
        : status >= 500
          ? "transport"
          : "unknown";
  }
}

async function postPlatformTool(
  path: string,
  payload: Record<string, unknown>,
  deps: PlatformToolDeps,
): Promise<unknown> {
  const apiBase = deps.apiBase ?? DEFAULT_API_BASE;
  const getToken =
    deps.getToken ?? (async () => (await import("./auth")).getIdToken());
  const fetchImpl = deps.fetchImpl ?? fetch;

  const token = await getToken();
  if (!token) throw new Error("Not authenticated");

  const resp = await fetchImpl(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await resp.json().catch(() => ({}))) as {
    error?: string;
    [key: string]: unknown;
  };
  if (!resp.ok) {
    throw new PlatformToolClientError(
      resp.status,
      `Platform tool ${resp.status}: ${data.error ?? "request failed"}`,
    );
  }
  return data;
}

export async function callPlatformWebSearch(
  input: { agentId: string; query: string; numResults?: number },
  deps: PlatformToolDeps = {},
): Promise<PlatformToolResult> {
  const data = (await postPlatformTool(
    "/api/mobile/tools/web-search",
    {
      agentId: input.agentId,
      query: input.query,
      num_results: input.numResults,
    },
    deps,
  )) as PlatformToolResult;
  return { content: data.content, isError: data.isError };
}

export async function callPlatformTaskStatus(
  input: {
    agentId: string;
    threadId: string;
    linkedTaskId: string;
    status: string;
    note?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  deps: PlatformToolDeps = {},
): Promise<PlatformToolResult> {
  const data = (await postPlatformTool(
    "/api/tasks/status",
    {
      agentId: input.agentId,
      threadId: input.threadId,
      linkedTaskId: input.linkedTaskId,
      status: input.status,
      note: input.note,
      metadata: input.metadata,
    },
    deps,
  )) as PlatformToolResult;
  return { content: data.content, isError: data.isError };
}

export async function callPlatformWorkItemStatus(
  input: {
    agentId: string;
    threadId: string;
    workItemId: string;
    statusCategory?: string | null;
    statusId?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  deps: PlatformToolDeps = {},
): Promise<PlatformToolResult> {
  const data = (await postPlatformTool(
    "/api/work-items/status",
    {
      agentId: input.agentId,
      threadId: input.threadId,
      workItemId: input.workItemId,
      statusCategory: input.statusCategory,
      statusId: input.statusId,
      note: input.note,
      metadata: input.metadata,
    },
    deps,
  )) as PlatformToolResult;
  return { content: data.content, isError: data.isError };
}

export function platformToolContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  const text = content
    .map((item) => {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string") return rec.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
  return text || JSON.stringify(content);
}
