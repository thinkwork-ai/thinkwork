/**
 * Tool-invocation pill summarizer.
 *
 * Surfaces the agent turn's tool / sub-agent / skill calls inline on the
 * collapsed Thinking row of the admin Thread Detail Activity panel.
 * Source: `usage.tool_invocations` (and `usage.tools_called` fallback for
 * older turn records). Lives in its own module so the pure summarization
 * logic can be unit-tested without pulling in React.
 */

export type ToolPillType = "mcp_tool" | "sub_agent" | "skill" | "tool";

export interface ToolPill {
  key: string;
  toolName: string;
  type: ToolPillType;
  count: number;
}

export function summarizeToolInvocations(
  usage: Record<string, unknown> | null | undefined,
): ToolPill[] {
  if (!usage) return [];

  const raw = usage.tool_invocations as unknown;
  const fromInvocations = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>).map((inv) => ({
        toolName: String(inv.tool_name ?? "").trim() || "tool",
        rawType: String(inv.type ?? "tool"),
      }))
    : [];

  const fallback =
    fromInvocations.length === 0 && Array.isArray(usage.tools_called)
      ? (usage.tools_called as unknown[]).map((name) => ({
          toolName: String(name ?? "").trim() || "tool",
          rawType: "tool",
        }))
      : [];

  const entries = [...fromInvocations, ...fallback];
  if (entries.length === 0) return [];

  const counts = new Map<string, ToolPill>();
  for (const entry of entries) {
    const type = normalizePillType(entry.rawType, entry.toolName);
    const key = `${type}:${entry.toolName}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { key, toolName: entry.toolName, type, count: 1 });
    }
  }
  return Array.from(counts.values());
}

function normalizePillType(rawType: string, toolName: string): ToolPillType {
  if (rawType === "sub_agent") return "sub_agent";
  if (rawType === "skill") return "skill";
  // Skill meta-tool surfaces as a single `tool_name: "Skill"` with the
  // chosen skill in input_preview; until that cutover lands we still match
  // a "Skill" prefix so any name like `Skill_finance_audit_xls` surfaces
  // as a skill pill rather than a generic tool.
  if (toolName.toLowerCase().startsWith("skill")) return "skill";
  if (rawType === "mcp_tool") return "mcp_tool";
  return "tool";
}
