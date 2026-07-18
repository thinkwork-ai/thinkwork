import { requestedRuntimeFromMetadata } from "../turn-runtime-selection.js";

export type PinnedThreadRuntime = "pi" | "harness";
export type RequestedTurnRuntime = "pi" | "agentcore";

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function defaultThreadRuntimeFromConfig(
  runtimeConfig: unknown,
): PinnedThreadRuntime {
  const value = objectRecord(runtimeConfig).defaultThreadRuntime;
  return typeof value === "string" &&
    ["harness", "agentcore"].includes(value.toLowerCase())
    ? "harness"
    : "pi";
}

export function pinThreadRuntimeMetadata(
  metadata: unknown,
  runtime: PinnedThreadRuntime,
): Record<string, unknown> {
  return {
    ...objectRecord(metadata),
    requestedRuntime: runtime === "harness" ? "agentcore" : "pi",
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
