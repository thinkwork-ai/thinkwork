import { sweepN8nAgentStepRuns } from "../lib/n8n-agent-step/resume.js";

export interface N8nAgentStepExpirerEvent {
  limit?: number | string;
}

export async function handler(event: N8nAgentStepExpirerEvent = {}) {
  const limit = parseLimit(event.limit);
  const result = await sweepN8nAgentStepRuns({ limit });
  console.log("[n8n-agent-step-expirer] sweep complete", result);
  return {
    ok: true,
    ...result,
  };
}

function parseLimit(
  value: N8nAgentStepExpirerEvent["limit"],
): number | undefined {
  if (value === undefined) return undefined;
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}
