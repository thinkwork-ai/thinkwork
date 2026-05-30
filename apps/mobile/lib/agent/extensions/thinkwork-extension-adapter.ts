import { defineExtension } from "./define-extension";
import type {
  ExtensionAPI,
  ExtensionEventName,
  ExtensionFactory,
} from "./types";
import type { JsonSchema, Tool, ToolResult } from "../types";

export type ProviderBundleLike = {
  model?: unknown;
  workspace?: unknown;
  memory?: unknown;
  delegation?: unknown;
  [key: string]: unknown;
};

export interface ThinkworkExtensionLike {
  name: string;
  toolNames?: readonly string[];
  register(pi: unknown, providers: ProviderBundleLike): void | Promise<void>;
}

export interface ThinkworkToolDefinitionLike {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
  ): unknown | Promise<unknown>;
}

export interface ThinkworkExtensionAdapterOptions {
  providers?: ProviderBundleLike;
  /**
   * Stable tool-call id prefix for shared Pi tools. Mobile's current ToolContext
   * does not expose provider tool-call ids yet; U7 can replace this bridge with
   * call-id threading once the session transcript becomes durable.
   */
  toolCallIdPrefix?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function schemaFor(value: unknown): JsonSchema {
  const record = asRecord(value);
  if (!record) return { type: "object" };
  return typeof record.type === "string"
    ? (record as JsonSchema)
    : { ...record, type: "object" };
}

function textFromContentBlock(block: unknown): string {
  if (typeof block === "string") return block;
  const record = asRecord(block);
  if (!record) return JSON.stringify(block ?? "");
  if (typeof record.text === "string") return record.text;
  const resource = asRecord(record.resource);
  if (resource) {
    if (typeof resource.text === "string") return resource.text;
    if (typeof resource.uri === "string") return resource.uri;
  }
  if (typeof record.uri === "string") return record.uri;
  return JSON.stringify(record);
}

export function thinkworkToolResultToMobile(result: unknown): ToolResult {
  if (typeof result === "string") return { content: result };

  const record = asRecord(result);
  if (!record) return { content: JSON.stringify(result ?? "") };

  const rawContent = record.content;
  let content: string;
  if (typeof rawContent === "string") {
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    content =
      rawContent
        .map(textFromContentBlock)
        .filter((part) => part.length > 0)
        .join("\n") || JSON.stringify(rawContent);
  } else if (rawContent !== undefined) {
    content = JSON.stringify(rawContent);
  } else {
    content = JSON.stringify(record);
  }

  return {
    content,
    isError: record.isError === true,
  };
}

export function adaptThinkworkTool(
  tool: ThinkworkToolDefinitionLike,
  options: Pick<ThinkworkExtensionAdapterOptions, "toolCallIdPrefix"> = {},
): Tool {
  return {
    name: tool.name,
    description: tool.description ?? tool.label ?? tool.name,
    parameters: schemaFor(tool.parameters),
    execute: async (args, ctx) => {
      const result = await tool.execute(
        `${options.toolCallIdPrefix ?? "mobile"}:${tool.name}`,
        args,
        ctx.signal,
      );
      return thinkworkToolResultToMobile(result);
    },
  };
}

function supportsMobileEvent(type: string): type is ExtensionEventName {
  return (
    type === "before_agent_start" ||
    type === "agent_start" ||
    type === "agent_end" ||
    type === "tool_call" ||
    type === "after_tool_call"
  );
}

function createThinkworkApi(pi: ExtensionAPI): unknown {
  return {
    registerTool(tool: ThinkworkToolDefinitionLike) {
      return pi.registerTool(adaptThinkworkTool(tool));
    },
    on(type: string, handler: (...args: unknown[]) => unknown) {
      if (!supportsMobileEvent(type)) {
        pi.logger.debug(
          `thinkwork extension event "${type}" is not wired on mobile yet; handler skipped`,
        );
        return () => {};
      }
      return pi.on(type, (event) => handler(event));
    },
    logger: pi.logger,
  };
}

export function adaptThinkworkExtension(
  extension: ThinkworkExtensionLike,
  options: ThinkworkExtensionAdapterOptions = {},
): ExtensionFactory {
  return defineExtension({
    name: extension.name,
    toolNames: extension.toolNames,
    register(pi) {
      return extension.register(
        createThinkworkApi(pi),
        options.providers ?? {},
      );
    },
  });
}

export function adaptThinkworkExtensions(
  extensions: readonly ThinkworkExtensionLike[],
  options: ThinkworkExtensionAdapterOptions = {},
): ExtensionFactory[] {
  return extensions.map((extension) =>
    adaptThinkworkExtension(extension, options),
  );
}
