export interface ToolCostRecord {
  provider: string;
  event_type: string;
  amount_usd: number | string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

const AGENTCORE_BROWSER_VCPU_HOUR_USD = 0.0895;
const AGENTCORE_BROWSER_GB_HOUR_USD = 0.00945;

function finiteNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildAgentCoreBrowserCost(args: {
  durationMs: number;
  url: string;
  task: string;
  sessionId: string;
  browserIdentifier: string;
  screenshotBytes?: number;
  error?: string;
}): ToolCostRecord {
  const estimatedVcpu = finiteNumber(
    process.env.BROWSER_AUTOMATION_ESTIMATED_VCPU,
    1,
  );
  const estimatedMemoryGb = finiteNumber(
    process.env.BROWSER_AUTOMATION_ESTIMATED_MEMORY_GB,
    2,
  );
  const amountUsd =
    (args.durationMs / 3_600_000) *
    (estimatedVcpu * AGENTCORE_BROWSER_VCPU_HOUR_USD +
      estimatedMemoryGb * AGENTCORE_BROWSER_GB_HOUR_USD);

  return {
    provider: "agentcore_browser",
    event_type: "agentcore_browser_session",
    amount_usd: amountUsd.toFixed(6),
    duration_ms: args.durationMs,
    metadata: {
      runtime: "pi",
      url: args.url,
      task: args.task.slice(0, 100),
      session_id: args.sessionId,
      browser_identifier: args.browserIdentifier,
      screenshot_bytes: args.screenshotBytes ?? 0,
      estimated: true,
      estimated_vcpu: estimatedVcpu,
      estimated_memory_gb: estimatedMemoryGb,
      pricing_source: "aws-agentcore-pricing",
      ...(args.error ? { error: args.error.slice(0, 200) } : {}),
    },
  };
}

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
