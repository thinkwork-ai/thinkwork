import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import {
  optionalBoolean,
  optionalString,
  type PiInvocationPayload,
} from "./types.js";

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : {};
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

async function callContextEngine(payload: PiInvocationPayload, args: unknown) {
  const endpoint = optionalString(payload.thinkwork_api_url);
  const secret = optionalString(payload.thinkwork_api_secret);
  const tenantId =
    optionalString(payload.tenant_id) ??
    optionalString(payload.workspace_tenant_id);
  const userId = optionalString(payload.user_id);
  const agentId = optionalString(payload.assistant_id);
  if (!endpoint || !secret) {
    return {
      disabled: true,
      text: "Context Engine is not enabled for this deployment yet.",
    };
  }
  if (!tenantId || !userId) {
    return {
      disabled: true,
      text: "Context Engine is missing tenant/user identity for this turn.",
    };
  }

  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/mcp/context-engine`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
        "x-tenant-id": tenantId,
        "x-user-id": userId,
        ...(agentId ? { "x-agent-id": agentId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "pi-query-context",
        method: "tools/call",
        params: {
          name: "query_context",
          arguments: args,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.error) {
    throw new Error(
      `Context Engine ${response.status}: ${data.error?.message ?? text.slice(0, 400)}`,
    );
  }
  return data.result ?? {};
}

function resultText(result: any): string {
  if (result?.disabled) return result.text;
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .map((item: any) => (typeof item?.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
  if (text) return text;
  return JSON.stringify(result?.structuredContent ?? result, null, 2);
}

export function buildContextEngineTool(
  payload: PiInvocationPayload,
): AgentTool<any> | undefined {
  if (!optionalBoolean(payload.context_engine_enabled)) return undefined;

  const endpoint = optionalString(payload.thinkwork_api_url);
  const secret = optionalString(payload.thinkwork_api_secret);
  if (!endpoint || !secret) return undefined;

  return {
    name: "query_context",
    label: "Query Context",
    description:
      "Search Thinkwork Context Engine across fast default providers: wiki, workspace files, knowledge bases, and approved search-safe MCP tools. Use this first for ordinary context lookup; use raw Hindsight Memory only when needed.",
    parameters: Type.Object({
      query: Type.String({ description: "Question or topic to search for." }),
      mode: Type.Optional(
        Type.Union([Type.Literal("results"), Type.Literal("answer")]),
      ),
      scope: Type.Optional(
        Type.Union([
          Type.Literal("personal"),
          Type.Literal("team"),
          Type.Literal("auto"),
        ]),
      ),
      depth: Type.Optional(
        Type.Union([Type.Literal("quick"), Type.Literal("deep")]),
      ),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
    }),
    execute: async (_toolCallId, params) => {
      const input = paramsRecord(params);
      const query = String(input.query || "").trim();
      if (!query) throw new Error("query_context requires query");
      const args = {
        query,
        mode: enumValue(input.mode, ["results", "answer"] as const, "results"),
        scope: enumValue(
          input.scope,
          ["personal", "team", "auto"] as const,
          "auto",
        ),
        depth: enumValue(input.depth, ["quick", "deep"] as const, "quick"),
        limit: Math.max(1, Math.min(Number(input.limit ?? 10), 50)),
      };
      const result = await callContextEngine(payload, args);
      return {
        content: [{ type: "text", text: resultText(result) }],
        details: result.structuredContent ?? result,
      };
    },
  };
}
