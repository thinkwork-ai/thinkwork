import type { ToolCostRecord } from "./types.js";

function isToolCostRecord(value: unknown): value is ToolCostRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.provider === "string" &&
    typeof record.event_type === "string" &&
    (typeof record.amount_usd === "string" ||
      typeof record.amount_usd === "number")
  );
}

export function collectToolCosts(value: unknown): ToolCostRecord[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const candidates = [
    record.tool_costs,
    (record.details as Record<string, unknown> | undefined)?.tool_costs,
    (record.result as Record<string, unknown> | undefined)?.tool_costs,
  ];
  const costs: ToolCostRecord[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (isToolCostRecord(item)) costs.push(item);
    }
  }
  return costs;
}
