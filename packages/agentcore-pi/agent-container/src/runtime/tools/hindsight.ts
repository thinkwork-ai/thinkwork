import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  optionalBoolean,
  optionalString,
  type HindsightUsage,
  type PiInvocationPayload,
} from "./types.js";
import type { RuntimeEnv } from "../env-snapshot.js";

function resolveBankId(payload: PiInvocationPayload): string | undefined {
  const userId = optionalString(payload.user_id);
  if (userId) return `user_${userId}`;
  return undefined;
}

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : {};
}

async function postJson(endpoint: string, path: string, body: unknown) {
  const response = await fetch(`${endpoint.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { text };
  }
  if (!response.ok) {
    throw new Error(`Hindsight ${response.status}: ${text.slice(0, 400)}`);
  }
  return data;
}

function extractUsage(
  data: any,
  phase: HindsightUsage["phase"],
): HindsightUsage | undefined {
  const usage = data?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  return {
    phase,
    model:
      typeof usage.model === "string"
        ? usage.model
        : phase === "retain"
          ? "hindsight-retain"
          : "hindsight-reflect",
    input_tokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
  };
}

function formatRecall(data: any): string {
  const memories = data?.memory_units || data?.memories || data?.results || [];
  if (!Array.isArray(memories) || memories.length === 0)
    return "No relevant memories found.";
  return memories
    .slice(0, 10)
    .map((memory: any, index: number) => {
      const text = String(
        memory.text ??
          memory.content ??
          memory.summary ??
          JSON.stringify(memory),
      );
      return `${index + 1}. ${text}`;
    })
    .join("\n");
}

export function buildHindsightTools(
  payload: PiInvocationPayload,
  usage: HindsightUsage[],
): AgentTool<any>[] {
  const endpoint = optionalString(payload.hindsight_endpoint);
  const bankId = resolveBankId(payload);
  if (!endpoint || !bankId) return [];

  const recallTool: AgentTool<any> = {
    name: "hindsight_recall",
    label: "Hindsight Recall",
    description:
      "Direct raw Hindsight recall for diagnostics or explicit raw-memory requests. Prefer query_memory_context for normal long-term memory lookup so provider status and partial failures are captured through Context Engine.",
    parameters: Type.Object({
      query: Type.String({ description: "Question or topic to recall." }),
    }),
    execute: async (_toolCallId, params) => {
      const input = paramsRecord(params);
      const query = String(input.query || "").trim();
      if (!query) throw new Error("hindsight_recall requires query");
      const data = await postJson(
        endpoint,
        `/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`,
        {
          query,
          budget: "low",
          max_tokens: 1_500,
          include: { entities: null },
          types: ["world", "experience", "observation"],
        },
      );
      return {
        content: [{ type: "text", text: formatRecall(data) }],
        details: { bank_id: bankId, query, raw: data },
      };
    },
  };

  const reflectTool: AgentTool<any> = {
    name: "hindsight_reflect",
    label: "Hindsight Reflect",
    description:
      "Direct raw Hindsight reflection for diagnostics or explicit raw-reflect requests. Prefer query_memory_context for normal reflect-style memory synthesis so provider status and partial failures are captured through Context Engine.",
    parameters: Type.Object({
      query: Type.String({ description: "Question or topic to synthesize." }),
    }),
    execute: async (_toolCallId, params) => {
      const input = paramsRecord(params);
      const query = String(input.query || "").trim();
      if (!query) throw new Error("hindsight_reflect requires query");
      const data = await postJson(
        endpoint,
        `/v1/default/banks/${encodeURIComponent(bankId)}/reflect`,
        { query, budget: "mid" },
      );
      const entry = extractUsage(data, "reflect");
      if (entry) usage.push(entry);
      const text = String(
        data?.text ?? data?.response ?? data?.summary ?? JSON.stringify(data),
      );
      return {
        content: [{ type: "text", text }],
        details: { bank_id: bankId, query, raw: data },
      };
    },
  };

  return [recallTool, reflectTool];
}

// ---------------------------------------------------------------------------
// Per-turn auto-retain (U2-Pi): fire-and-forget invoke of memory-retain.
//
// Replaces retainHindsightTurn (which posted directly to Hindsight with only
// the latest user+assistant pair). Pi now converges on the same Lambda path
// as Strands so U1's longest-suffix-prefix merge applies uniformly.
// ---------------------------------------------------------------------------

let _lambdaClient: LambdaClient | null = null;
function getLambdaClient(region: string): LambdaClient {
  if (!_lambdaClient) {
    _lambdaClient = new LambdaClient({ region });
  }
  return _lambdaClient;
}

// Test seam — allows tests to inject a mocked LambdaClient without bringing
// in the full aws-sdk-client-mock setup.
export function __setLambdaClientForTest(client: LambdaClient | null): void {
  _lambdaClient = client;
}

export interface RetainTranscriptEntry {
  role: "user" | "assistant";
  content: string;
}

/**
 * Build the per-turn transcript: history (filtered to user/assistant with
 * non-empty content) + [user message, assistant response]. Mirrors the
 * Strands U3 helper; the Lambda does the longest-suffix-prefix merge
 * against the canonical DB transcript.
 */
export function buildRetainTranscript(
  payload: PiInvocationPayload,
  assistantContent: string,
): RetainTranscriptEntry[] {
  const transcript: RetainTranscriptEntry[] = [];
  const history = payload.messages_history;
  if (Array.isArray(history)) {
    for (const entry of history) {
      if (!entry || typeof entry !== "object") continue;
      const role = (entry as { role?: unknown }).role;
      const content = (entry as { content?: unknown }).content;
      if (
        (role === "user" || role === "assistant") &&
        typeof content === "string" &&
        content.trim().length > 0
      ) {
        transcript.push({ role, content });
      }
    }
  }
  const userMessage = optionalString(payload.message);
  if (userMessage) transcript.push({ role: "user", content: userMessage });
  if (assistantContent && assistantContent.trim().length > 0) {
    transcript.push({ role: "assistant", content: assistantContent });
  }
  return transcript;
}

/**
 * Fire-and-forget invoke of memory-retain with a full thread transcript.
 *
 * Honors ``payload.use_memory=false`` as an opt-out (preserved from the
 * deprecated ``retainHindsightTurn``).
 *
 * Returns ``{ retained: false, error? }`` on any precondition or invoke
 * failure; never throws — Pi response path must not block on retain.
 */
export async function retainFullThread(
  payload: PiInvocationPayload,
  assistantContent: string,
  env: RuntimeEnv,
  envOverrides?: Record<string, string | undefined>,
): Promise<{ retained: boolean; error?: string }> {
  if (!optionalBoolean(payload.use_memory)) return { retained: false };

  // Snapshot env at entry; mirror feedback_completion_callback_snapshot_pattern.
  const procEnv = envOverrides ?? process.env;
  const fnName = procEnv.MEMORY_RETAIN_FN_NAME || "";
  const region = env.awsRegion;
  const tenantId = optionalString(payload.tenant_id);
  const userId = optionalString(payload.user_id);
  const threadId = optionalString(payload.thread_id);

  if (!fnName) return { retained: false };
  if (!tenantId || !userId || !threadId) return { retained: false };

  const transcript = buildRetainTranscript(payload, assistantContent);
  if (transcript.length === 0) return { retained: false };

  const requestPayload = {
    tenantId,
    userId,
    threadId,
    transcript,
  };

  try {
    const client = getLambdaClient(region);
    await client.send(
      new InvokeCommand({
        FunctionName: fnName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify(requestPayload)),
      }),
    );
    return { retained: true };
  } catch (err) {
    return {
      retained: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
