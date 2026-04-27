import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import {
  optionalBoolean,
  optionalString,
  type HindsightUsage,
  type PiInvocationPayload,
} from "./types.js";

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
      "Search long-term Hindsight memory for facts from prior conversations. Use for memory lookup.",
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
          max_results: 10,
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
      "Synthesize a narrative answer over Hindsight memory. Use after recall for broad memory questions.",
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

export async function retainHindsightTurn(
  payload: PiInvocationPayload,
  assistantContent: string,
): Promise<{
  usage?: HindsightUsage;
  retained?: boolean;
  bank_id?: string;
  error?: string;
}> {
  if (!optionalBoolean(payload.use_memory)) return {};
  const endpoint = optionalString(payload.hindsight_endpoint);
  const bankId = resolveBankId(payload);
  const threadId = optionalString(payload.thread_id);
  const userMessage = optionalString(payload.message);
  if (
    !endpoint ||
    !bankId ||
    !threadId ||
    !userMessage ||
    !assistantContent.trim()
  )
    return {};

  const content = [
    `user (${new Date().toISOString()}): ${userMessage}`,
    `assistant (${new Date().toISOString()}): ${assistantContent}`,
  ].join("\n");

  try {
    const data = await postJson(
      endpoint,
      `/v1/default/banks/${encodeURIComponent(bankId)}/memories`,
      {
        items: [
          {
            content,
            document_id: threadId,
            update_mode: "replace",
            context: "thinkwork_thread",
            metadata: {
              tenantId: optionalString(payload.tenant_id),
              userId: optionalString(payload.user_id),
              threadId,
              source: "thinkwork-pi",
              runtime: "pi",
            },
          },
        ],
      },
    );
    return {
      retained: true,
      bank_id: bankId,
      usage: extractUsage(data, "retain"),
    };
  } catch (err) {
    return {
      retained: false,
      bank_id: bankId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
