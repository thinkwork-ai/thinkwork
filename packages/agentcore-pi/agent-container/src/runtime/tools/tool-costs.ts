export {
  collectToolCosts,
  type ToolCostRecord,
} from "@thinkwork/pi-runtime-core";

import type { ToolCostRecord } from "@thinkwork/pi-runtime-core";

const AGENTCORE_BROWSER_VCPU_HOUR_USD = 0.0895;
const AGENTCORE_BROWSER_GB_HOUR_USD = 0.00945;
const SENSITIVE_QUERY_KEYS = [
  "access_token",
  "api_key",
  "apikey",
  "authorization",
  "code",
  "credential",
  "key",
  "refresh_token",
  "secret",
  "sig",
  "signature",
  "token",
];

function finiteNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sanitizeTelemetryUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("x-amz-") ||
        SENSITIVE_QUERY_KEYS.some((sensitive) => lower.includes(sensitive))
      ) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
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
  const telemetryUrl = sanitizeTelemetryUrl(args.url);

  return {
    provider: "agentcore_browser",
    event_type: "agentcore_browser_session",
    amount_usd: amountUsd.toFixed(6),
    duration_ms: args.durationMs,
    metadata: {
      runtime: "pi",
      url: telemetryUrl,
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
