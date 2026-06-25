/**
 * trace-invocation-reconciler
 *
 * Scheduled by EventBridge to reconcile recent runtime-reported LLM cost rows
 * against Bedrock model invocation logs. Also accepts a targeted direct event:
 * `{ tenantId, turnId }` for operator retry/repair.
 */

import type { ScheduledEvent } from "aws-lambda";
import {
  reconcileBedrockInvocationsForTurn,
  reconcileRecentBedrockInvocations,
} from "../lib/trace-ledger/bedrock-invocation-reconciler.js";

type TargetedEvent = {
  tenantId?: unknown;
  turnId?: unknown;
  limit?: unknown;
  lookbackMinutes?: unknown;
};

const DEFAULT_LIMIT = envInt("TRACE_INVOCATION_RECONCILE_LIMIT", 50);
const DEFAULT_LOOKBACK_MINUTES = envInt(
  "TRACE_INVOCATION_RECONCILE_LOOKBACK_MINUTES",
  180,
);

export async function handler(
  event: ScheduledEvent | TargetedEvent,
): Promise<unknown> {
  const targeted = event as TargetedEvent;
  if (
    typeof targeted.tenantId === "string" &&
    typeof targeted.turnId === "string"
  ) {
    const result = await reconcileBedrockInvocationsForTurn({
      tenantId: targeted.tenantId,
      turnId: targeted.turnId,
    });
    console.log(
      JSON.stringify({
        msg: "trace-invocation-reconciler.targeted.complete",
        ...result,
        decisions: result.decisions.map((decision) => ({
          runtimeRequestId: decision.runtime.requestId,
          providerRequestId: decision.provider?.requestId,
          state: decision.state,
          reason: decision.reason,
          confidence: decision.confidence,
        })),
      }),
    );
    return result;
  }

  const result = await reconcileRecentBedrockInvocations({
    limit: numberValue(targeted.limit) ?? DEFAULT_LIMIT,
    lookbackMinutes:
      numberValue(targeted.lookbackMinutes) ?? DEFAULT_LOOKBACK_MINUTES,
  });
  console.log(
    JSON.stringify({
      msg: "trace-invocation-reconciler.scheduled.complete",
      ...result,
    }),
  );
  return result;
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}
