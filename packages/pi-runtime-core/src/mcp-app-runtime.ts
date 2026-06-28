import { createHash } from "node:crypto";

import type { ActivityEmitEvent } from "./agent-loop.js";

export const MCP_APP_PART_TYPE = "data-mcp-app" as const;
export const MCP_APP_SCHEMA_VERSION = "thinkwork-mcp-app/v1" as const;
export const MCP_APP_ACTIVITY_EVENT_TYPE = "ui_message_chunk" as const;
export const MCP_APP_ACTIVITY_STREAM = "ui" as const;
export const MCP_APP_ACTIVITY_PAYLOAD_KIND =
  "thinkwork_mcp_app.ui_message_chunk" as const;

const MAX_MCP_APP_HTML_LENGTH = 1_000_000;

export interface McpAppDescriptor {
  uri: string;
  mimeType: "text/html";
  html: string;
  title?: string;
  serverName?: string;
  toolName?: string;
}

export interface McpAppPart {
  type: typeof MCP_APP_PART_TYPE;
  id: string;
  data: {
    schemaVersion: typeof MCP_APP_SCHEMA_VERSION;
    status: "ready";
    uri: string;
    mimeType: "text/html";
    html: string;
    title?: string;
    serverName?: string;
    toolName?: string;
  };
}

export interface McpAppActivityPayload {
  kind: typeof MCP_APP_ACTIVITY_PAYLOAD_KIND;
  chunk: McpAppPart;
}

export function extractMcpAppPartsFromToolResult(
  result: unknown,
): McpAppPart[] {
  const apps = extractMcpAppDescriptors(result);
  return apps
    .map(mcpAppPart)
    .filter((part): part is McpAppPart => Boolean(part));
}

export function mergeFinalUiMessageParts<T extends { id?: unknown }>(
  existing: readonly T[] | undefined,
  incoming: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const part of existing ?? []) {
    if (typeof part.id === "string" && part.id) byId.set(part.id, part);
  }
  for (const part of incoming) {
    if (typeof part.id === "string" && part.id) byId.set(part.id, part);
  }
  return [...byId.values()];
}

export function mcpAppActivityEvent(part: McpAppPart): ActivityEmitEvent {
  return {
    eventType: MCP_APP_ACTIVITY_EVENT_TYPE,
    message: part.data.title ?? part.data.uri,
    stream: MCP_APP_ACTIVITY_STREAM,
    payload: {
      kind: MCP_APP_ACTIVITY_PAYLOAD_KIND,
      chunk: part,
    } satisfies McpAppActivityPayload,
  };
}

export function validateMcpAppPart(
  value: unknown,
): { ok: true; part: McpAppPart } | { ok: false } {
  const record = recordValue(value);
  if (record?.type !== MCP_APP_PART_TYPE) return { ok: false };
  const data = recordValue(record.data);
  const id = stringValue(record.id);
  const uri = stringValue(data?.uri);
  const html = stringValue(data?.html);
  const mimeType = stringValue(data?.mimeType);
  if (
    !id ||
    !uri ||
    !html ||
    html.length > MAX_MCP_APP_HTML_LENGTH ||
    !isHtmlMimeType(mimeType)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    part: {
      type: MCP_APP_PART_TYPE,
      id,
      data: {
        schemaVersion: MCP_APP_SCHEMA_VERSION,
        status: "ready",
        uri,
        mimeType: "text/html",
        html,
        ...(stringValue(data?.title)
          ? { title: stringValue(data?.title) }
          : {}),
        ...(stringValue(data?.serverName)
          ? { serverName: stringValue(data?.serverName) }
          : {}),
        ...(stringValue(data?.toolName)
          ? { toolName: stringValue(data?.toolName) }
          : {}),
      },
    },
  };
}

function mcpAppPart(app: McpAppDescriptor): McpAppPart | null {
  if (!app.uri || !app.html || app.html.length > MAX_MCP_APP_HTML_LENGTH) {
    return null;
  }
  return {
    type: MCP_APP_PART_TYPE,
    id: `mcp-app:${shortHash(
      [app.serverName, app.toolName, app.uri].filter(Boolean).join(":"),
    )}`,
    data: {
      schemaVersion: MCP_APP_SCHEMA_VERSION,
      status: "ready",
      uri: app.uri,
      mimeType: "text/html",
      html: app.html,
      ...(app.title ? { title: app.title } : {}),
      ...(app.serverName ? { serverName: app.serverName } : {}),
      ...(app.toolName ? { toolName: app.toolName } : {}),
    },
  };
}

function extractMcpAppDescriptors(
  value: unknown,
  depth = 0,
): McpAppDescriptor[] {
  if (depth > 3) return [];
  const record = recordValue(value);
  if (!record) return [];
  const details = recordValue(record.details);
  const direct = descriptorsFromUnknown(details?.mcp_apps);
  if (direct.length > 0) return direct;
  return [
    ...extractMcpAppDescriptors(details?.rawToolResult, depth + 1),
    ...extractMcpAppDescriptors(record.rawToolResult, depth + 1),
  ];
}

function descriptorsFromUnknown(value: unknown): McpAppDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = recordValue(item);
      const uri = stringValue(record?.uri);
      const html = stringValue(record?.html);
      const mimeType = stringValue(record?.mimeType);
      if (!uri || !html || !isHtmlMimeType(mimeType)) return null;
      return {
        uri,
        html,
        mimeType: "text/html" as const,
        ...(stringValue(record?.title)
          ? { title: stringValue(record?.title) }
          : {}),
        ...(stringValue(record?.serverName)
          ? { serverName: stringValue(record?.serverName) }
          : {}),
        ...(stringValue(record?.toolName)
          ? { toolName: stringValue(record?.toolName) }
          : {}),
      };
    })
    .filter((item): item is McpAppDescriptor => item !== null);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isHtmlMimeType(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value
      .split(";", 1)[0]
      .trim()
      .toLowerCase() === "text/html"
  );
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
