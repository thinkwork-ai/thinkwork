import { requestedRuntimeFromMetadata } from "../turn-runtime-selection.js";

// THINK-324: Pi is the only runtime; legacy "agentcore"/"harness" values in
// tenant runtime_config or thread metadata normalize to "pi".
export type PinnedThreadRuntime = "pi";
export type RequestedTurnRuntime = "pi";

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function defaultThreadRuntimeFromConfig(
  runtimeConfig: unknown,
): PinnedThreadRuntime {
  void objectRecord(runtimeConfig).defaultThreadRuntime;
  return "pi";
}

export function pinThreadRuntimeMetadata(
  metadata: unknown,
  runtime: PinnedThreadRuntime,
): Record<string, unknown> {
  return {
    ...objectRecord(metadata),
    requestedRuntime: runtime,
  };
}

export function requestedRuntimeForTurn(
  turnMetadata: unknown,
  threadMetadata: unknown,
): RequestedTurnRuntime | null {
  return (
    requestedRuntimeFromMetadata(turnMetadata) ??
    requestedRuntimeFromMetadata(threadMetadata)
  );
}
