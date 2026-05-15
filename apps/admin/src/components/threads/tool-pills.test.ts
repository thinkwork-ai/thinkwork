import { describe, expect, it } from "vitest";
import { summarizeToolInvocations } from "./tool-pills";

describe("summarizeToolInvocations", () => {
  it("returns empty for missing usage / no invocations", () => {
    expect(summarizeToolInvocations(null)).toEqual([]);
    expect(summarizeToolInvocations(undefined)).toEqual([]);
    expect(summarizeToolInvocations({})).toEqual([]);
    expect(summarizeToolInvocations({ tool_invocations: [] })).toEqual([]);
  });

  it("summarizes a single mcp_tool invocation", () => {
    const pills = summarizeToolInvocations({
      tool_invocations: [
        {
          tool_name: "file_read",
          type: "mcp_tool",
          status: "success",
          input_preview: "{\"path\": \"/tmp/.../Financial Sample.xlsx\"}",
        },
      ],
    });
    expect(pills).toEqual([
      { key: "mcp_tool:file_read", toolName: "file_read", type: "mcp_tool", count: 1 },
    ]);
  });

  it("dedupes the same tool called multiple times into one pill with count", () => {
    const pills = summarizeToolInvocations({
      tool_invocations: [
        { tool_name: "file_read", type: "mcp_tool" },
        { tool_name: "file_read", type: "mcp_tool" },
        { tool_name: "file_read", type: "mcp_tool" },
      ],
    });
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatchObject({ toolName: "file_read", count: 3 });
  });

  it("classifies sub_agent invocations as sub_agent pills", () => {
    const pills = summarizeToolInvocations({
      tool_invocations: [
        { tool_name: "researcher", type: "sub_agent" },
      ],
    });
    expect(pills[0]).toMatchObject({ toolName: "researcher", type: "sub_agent" });
  });

  it("classifies explicit skill type as a skill pill", () => {
    const pills = summarizeToolInvocations({
      tool_invocations: [
        { tool_name: "finance_statement_analysis", type: "skill" },
      ],
    });
    expect(pills[0]).toMatchObject({
      toolName: "finance_statement_analysis",
      type: "skill",
    });
  });

  it("classifies names beginning with 'Skill' as a skill pill even when type says tool", () => {
    // The Skill meta-tool registers itself as a single tool named
    // "Skill"/"Skill_<name>" under the hood; we want it surfaced as a
    // skill rather than a generic tool until tool_invocations carries
    // an explicit `type: "skill"` from the runtime.
    const pills = summarizeToolInvocations({
      tool_invocations: [
        { tool_name: "Skill_finance_audit_xls", type: "tool" },
        { tool_name: "Skill", type: "mcp_tool" },
      ],
    });
    expect(pills.every((p) => p.type === "skill")).toBe(true);
  });

  it("falls back to tools_called when tool_invocations is missing", () => {
    const pills = summarizeToolInvocations({
      tools_called: ["file_read", "file_read", "recall"],
    });
    expect(pills.map((p) => `${p.toolName}x${p.count}`).sort()).toEqual([
      "file_readx2",
      "recallx1",
    ]);
  });

  it("preserves type discrimination when multiple types share a tool_name", () => {
    // Same name under two different types should remain two pills, not
    // collapse into one — the type-prefix in the dedup key prevents that.
    const pills = summarizeToolInvocations({
      tool_invocations: [
        { tool_name: "search", type: "mcp_tool" },
        { tool_name: "search", type: "sub_agent" },
      ],
    });
    expect(pills).toHaveLength(2);
    expect(pills.map((p) => p.type).sort()).toEqual(["mcp_tool", "sub_agent"]);
  });

  it("treats empty/whitespace tool_name defensively as 'tool'", () => {
    const pills = summarizeToolInvocations({
      tool_invocations: [
        { tool_name: "", type: "mcp_tool" },
        { tool_name: "   ", type: "mcp_tool" },
      ],
    });
    expect(pills).toEqual([
      { key: "mcp_tool:tool", toolName: "tool", type: "mcp_tool", count: 2 },
    ]);
  });

  it("ignores malformed tool_invocations (non-array)", () => {
    expect(
      summarizeToolInvocations({ tool_invocations: "not-an-array" } as unknown as Record<
        string,
        unknown
      >),
    ).toEqual([]);
  });
});
