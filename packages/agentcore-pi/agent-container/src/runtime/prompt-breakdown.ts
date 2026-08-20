/**
 * THINK-910 — per-turn prompt-size self-report.
 *
 * A simple KB question in a fresh thread was observed burning ~60K input
 * tokens PER model call on `mcpherson`, with tool assembly reporting 86 tools.
 * Nothing in the turn record said WHERE those tokens went, so every
 * investigation had to be re-run by hand against a live stage.
 *
 * This builds a small, cheap breakdown that rides `thread_turns.usage_json ->
 * diagnostics -> prompt_breakdown`, next to `agentcore_phases`, so the split
 * between "system prompt text" and "tool schemas" is queryable per turn.
 *
 * Honesty about the tool-schema figure: the runtime hands the SDK
 * `customTools` (platform + MCP + manifest capability tools) plus an allowlist
 * of built-in and extension tool NAMES. Only the custom tools' JSON schemas
 * are visible from here — built-in and extension schemas are owned by
 * `@earendil-works/pi-coding-agent` and are not reachable without reaching
 * into SDK internals. The fields are therefore named for exactly what they
 * measure (`custom_tool_schema_chars`, `custom_tool_count`) rather than
 * implying a total, and the counts of the other two sources are reported
 * alongside so an operator can see the shape of the residual.
 *
 * Cost: one JSON.stringify over the tool specs. Measured in the low
 * single-digit milliseconds for ~90 tools — cheap enough to run every turn.
 */

import { buildDocumentPlatesContract } from "@thinkwork/pi-extensions";

export interface PromptBreakdownTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface BuildPromptBreakdownArgs {
  /** The composed system prompt actually sent for this turn. */
  systemPrompt: string;
  /** The custom AgentTools handed to the session. */
  tools: readonly PromptBreakdownTool[];
  /** Pi built-in tool names enabled for this turn. */
  builtinToolNames: readonly string[];
  /** Extension-registered tool names enabled for this turn. */
  extensionToolNames: readonly string[];
  /** The invocation payload — used to re-derive the separable
   *  document-plates contract block. */
  payload?: Record<string, unknown>;
}

export interface PromptBreakdown {
  system_prompt_chars: number;
  /** ~chars/4; a rough orientation figure, NOT a tokenizer result. */
  system_prompt_est_tokens: number;
  /** JSON.stringify length of the `{name, description, parameters}` specs of
   *  the custom tools actually handed to the session. */
  custom_tool_schema_chars: number;
  custom_tool_schema_est_tokens: number;
  /** Total tool names enabled for the turn (custom + builtin + extension,
   *  de-duplicated) — the same arithmetic `buildToolAllowlist` does. */
  tool_count: number;
  custom_tool_count: number;
  builtin_tool_count: number;
  extension_tool_count: number;
  /** How many of the custom tools came from an MCP server. */
  mcp_tool_count: number;
  /** Size of the document-plates contract block inside the system prompt, 0
   *  when the turn carried no plates. Separable because it is rebuilt from
   *  the same payload + tool-name inputs the composer used. */
  document_plates_chars: number;
  /** The five largest custom tool schemas, so an operator can see which
   *  connector is dominating the tool block. */
  largest_tool_schemas: Array<{ name: string; chars: number }>;
}

function estimateTokens(chars: number): number {
  return Math.round(chars / 4);
}

function toolSpecChars(tool: PromptBreakdownTool): number {
  try {
    return JSON.stringify({
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.parameters ?? {},
    }).length;
  } catch {
    // A tool schema with a cycle or a BigInt must not fail the turn.
    return 0;
  }
}

export function buildPromptBreakdown(
  args: BuildPromptBreakdownArgs,
): PromptBreakdown {
  const perTool = args.tools.map((tool) => ({
    name: tool.name,
    chars: toolSpecChars(tool),
  }));
  const customToolSchemaChars = perTool.reduce(
    (total, entry) => total + entry.chars,
    0,
  );
  const allNames = new Set<string>([
    ...args.builtinToolNames,
    ...args.tools.map((tool) => tool.name),
    ...args.extensionToolNames,
  ]);
  const mcpToolCount = args.tools.filter((tool) =>
    tool.name.startsWith("mcp_"),
  ).length;

  let documentPlatesChars = 0;
  if (args.payload) {
    try {
      documentPlatesChars = buildDocumentPlatesContract(
        args.payload as Parameters<typeof buildDocumentPlatesContract>[0],
        [...allNames],
      ).length;
    } catch {
      documentPlatesChars = 0;
    }
  }

  return {
    system_prompt_chars: args.systemPrompt.length,
    system_prompt_est_tokens: estimateTokens(args.systemPrompt.length),
    custom_tool_schema_chars: customToolSchemaChars,
    custom_tool_schema_est_tokens: estimateTokens(customToolSchemaChars),
    tool_count: allNames.size,
    custom_tool_count: args.tools.length,
    builtin_tool_count: args.builtinToolNames.length,
    extension_tool_count: new Set(args.extensionToolNames).size,
    mcp_tool_count: mcpToolCount,
    document_plates_chars: documentPlatesChars,
    largest_tool_schemas: perTool.sort((a, b) => b.chars - a.chars).slice(0, 5),
  };
}
