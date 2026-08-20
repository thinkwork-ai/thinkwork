import { describe, expect, it } from "vitest";

import { buildPromptBreakdown } from "../src/runtime/prompt-breakdown.js";

const tool = (name: string, propertyCount = 1) => ({
  name,
  description: `The ${name} tool.`,
  parameters: {
    type: "object",
    properties: Object.fromEntries(
      Array.from({ length: propertyCount }, (_, i) => [
        `p${i}`,
        { type: "string", description: `parameter ${i}` },
      ]),
    ),
  },
});

describe("buildPromptBreakdown", () => {
  it("reports the full documented shape", () => {
    const breakdown = buildPromptBreakdown({
      systemPrompt: "x".repeat(4000),
      tools: [tool("execute_code"), tool("mcp_brain_brain_ask", 6)],
      builtinToolNames: ["read", "bash", "edit"],
      extensionToolNames: ["recall", "reflect", "recall"],
    });

    expect(Object.keys(breakdown).sort()).toEqual(
      [
        "builtin_tool_count",
        "custom_tool_count",
        "custom_tool_schema_chars",
        "custom_tool_schema_est_tokens",
        "document_plates_chars",
        "extension_tool_count",
        "largest_tool_schemas",
        "mcp_tool_count",
        "system_prompt_chars",
        "system_prompt_est_tokens",
        "tool_count",
      ].sort(),
    );
    expect(breakdown.system_prompt_chars).toBe(4000);
    expect(breakdown.system_prompt_est_tokens).toBe(1000);
    expect(breakdown.custom_tool_count).toBe(2);
    expect(breakdown.builtin_tool_count).toBe(3);
    // De-duplicated: "recall" listed twice counts once.
    expect(breakdown.extension_tool_count).toBe(2);
    expect(breakdown.mcp_tool_count).toBe(1);
    // read/bash/edit + 2 custom + recall/reflect
    expect(breakdown.tool_count).toBe(7);
  });

  it("measures the tool schemas actually handed to the session", () => {
    const tools = [tool("a", 2), tool("b", 20)];
    const breakdown = buildPromptBreakdown({
      systemPrompt: "",
      tools,
      builtinToolNames: [],
      extensionToolNames: [],
    });
    const expected = tools.reduce(
      (total, t) =>
        total +
        JSON.stringify({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }).length,
      0,
    );
    expect(breakdown.custom_tool_schema_chars).toBe(expected);
    expect(breakdown.custom_tool_schema_est_tokens).toBe(
      Math.round(expected / 4),
    );
    // Ranked largest-first so the dominating connector is visible.
    expect(breakdown.largest_tool_schemas.map((entry) => entry.name)).toEqual([
      "b",
      "a",
    ]);
  });

  it("caps largest_tool_schemas at five entries", () => {
    const breakdown = buildPromptBreakdown({
      systemPrompt: "",
      tools: Array.from({ length: 12 }, (_, i) => tool(`t${i}`, i + 1)),
      builtinToolNames: [],
      extensionToolNames: [],
    });
    expect(breakdown.largest_tool_schemas).toHaveLength(5);
    expect(breakdown.largest_tool_schemas[0]!.name).toBe("t11");
  });

  it("reports 0 plate chars when the turn carries no plates", () => {
    expect(
      buildPromptBreakdown({
        systemPrompt: "hi",
        tools: [],
        builtinToolNames: [],
        extensionToolNames: [],
        payload: {},
      }).document_plates_chars,
    ).toBe(0);
  });

  it("separates the document-plates contract when emit_document is present", () => {
    const breakdown = buildPromptBreakdown({
      systemPrompt: "hi",
      tools: [tool("emit_document")],
      builtinToolNames: [],
      extensionToolNames: [],
      payload: {
        document_plates: [
          {
            slug: "qbr",
            displayName: "Quarterly Business Review",
            useFor: "quarterly account reviews",
            sections: [
              { title: "Summary", tier: "required" },
              { title: "Pipeline", tier: "required-if-material" },
            ],
          },
        ],
      },
    });
    expect(breakdown.document_plates_chars).toBeGreaterThan(0);
  });

  it("survives an unserializable tool schema without throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const breakdown = buildPromptBreakdown({
      systemPrompt: "hi",
      tools: [{ name: "bad", parameters: cyclic }, tool("good")],
      builtinToolNames: [],
      extensionToolNames: [],
    });
    expect(breakdown.custom_tool_count).toBe(2);
    expect(breakdown.custom_tool_schema_chars).toBeGreaterThan(0);
  });
});
