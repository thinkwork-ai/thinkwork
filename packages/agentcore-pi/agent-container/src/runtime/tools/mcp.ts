import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TSchema } from "typebox";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { PiInvocationPayload } from "./types.js";
import { optionalString } from "./types.js";

interface McpConfig {
  name: string;
  url: string;
  transport?: "streamable-http" | "sse";
  auth?: { type?: string; token?: string };
  tools?: string[];
}

type McpClient = Client;

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : {};
}

function parseMcpConfigs(value: unknown): McpConfig[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const url = optionalString(record.url);
    const name = optionalString(record.name) ?? url;
    if (!url || !name) return [];
    const authRecord =
      record.auth && typeof record.auth === "object"
        ? (record.auth as Record<string, unknown>)
        : undefined;
    return [
      {
        name,
        url,
        transport: record.transport === "sse" ? "sse" : "streamable-http",
        auth: authRecord
          ? {
              type: optionalString(authRecord.type),
              token: optionalString(authRecord.token),
            }
          : undefined,
        tools: Array.isArray(record.tools)
          ? record.tools.filter(
              (tool): tool is string => typeof tool === "string",
            )
          : undefined,
      },
    ];
  });
}

function requestInitFor(config: McpConfig): RequestInit {
  const headers: Record<string, string> = {
    "user-agent": "Thinkwork-Pi/1.0",
  };
  const token = config.auth?.token;
  if (token) {
    if (config.auth?.type === "api-key") headers["x-api-key"] = token;
    else headers.authorization = `Bearer ${token}`;
  }
  return { headers };
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

function mcpToolName(serverName: string, toolName: string): string {
  return `mcp_${sanitizeName(serverName)}_${sanitizeName(toolName)}`.slice(
    0,
    64,
  );
}

function schemaFor(schema: unknown): TSchema {
  if (
    schema &&
    typeof schema === "object" &&
    (schema as { type?: unknown }).type === "object"
  ) {
    return schema as TSchema;
  }
  return Type.Object({});
}

function textFromMcpContent(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (record.resource && typeof record.resource === "object") {
        const resource = record.resource as Record<string, unknown>;
        if (typeof resource.text === "string") return resource.text;
        if (typeof resource.uri === "string") return resource.uri;
      }
      if (typeof record.uri === "string") return record.uri;
      return JSON.stringify(record);
    })
    .filter(Boolean)
    .join("\n");
}

function safeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.message.replace(
    /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer)\s*[:=]\s*[^,\s"]+/gi,
    "$1=[redacted]",
  );
}

async function connectMcp(config: McpConfig): Promise<{
  client: McpClient;
  transport: Transport;
}> {
  const client = new Client({ name: "thinkwork-pi", version: "0.0.0" });
  const url = new URL(config.url);
  const requestInit = requestInitFor(config);
  const transport =
    config.transport === "sse"
      ? new SSEClientTransport(url, {
          requestInit,
          eventSourceInit: requestInit as never,
        })
      : new StreamableHTTPClientTransport(url, { requestInit });
  await client.connect(transport);
  return { client, transport };
}

async function discoverServer(
  config: McpConfig,
  cleanup: Array<() => Promise<void>>,
): Promise<AgentTool<any>[]> {
  const { client, transport } = await connectMcp(config);
  cleanup.push(async () => {
    await transport.close().catch((err: unknown) => {
      console.warn(
        `[agentcore-pi] MCP cleanup failed for ${config.name}: ${safeError(err)}`,
      );
    });
  });

  const result = await client.listTools(undefined, {
    timeout: 30_000,
  });
  const allowlist = config.tools?.length ? new Set(config.tools) : null;
  return result.tools
    .filter((tool) => !allowlist || allowlist.has(tool.name))
    .map((tool): AgentTool<any> => {
      const exposedName = mcpToolName(config.name, tool.name);
      return {
        name: exposedName,
        label: `${config.name}: ${tool.name}`,
        description: [
          `Call the ${tool.name} MCP tool on ${config.name}.`,
          tool.description ?? "",
        ]
          .filter(Boolean)
          .join(" "),
        parameters: schemaFor(tool.inputSchema),
        executionMode: "sequential",
        execute: async (_toolCallId, params) => {
          const response = await client.callTool(
            {
              name: tool.name,
              arguments: paramsRecord(params),
            },
            undefined,
            { timeout: 60_000 },
          );
          const content =
            "content" in response ? response.content : response.toolResult;
          const text = textFromMcpContent(content);
          if ("isError" in response && response.isError) {
            throw new Error(text || `MCP tool ${tool.name} returned isError`);
          }
          return {
            content: [{ type: "text", text }],
            details: {
              server_name: config.name,
              mcp_server: config.name,
              mcp_tool_name: tool.name,
              exposed_tool_name: exposedName,
              raw: response,
            },
          };
        },
      };
    });
}

export async function buildMcpTools(
  payload: PiInvocationPayload,
  cleanup: Array<() => Promise<void>>,
): Promise<AgentTool<any>[]> {
  const configs = parseMcpConfigs(payload.mcp_configs);
  const discovered = await Promise.allSettled(
    configs.map((config) => discoverServer(config, cleanup)),
  );
  return discovered.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.warn(
      `[agentcore-pi] MCP discovery failed for ${configs[index]?.name ?? "unknown"}: ${safeError(result.reason)}`,
    );
    return [];
  });
}
