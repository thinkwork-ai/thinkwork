/**
 * Per-turn runtime selection (THINK-311 U5b).
 *
 * The composer's runtime picker writes `metadata.requestedRuntime` on the
 * user message — the same channel as `requestedModelId`. Only the chat
 * dispatch honors it (KTD-7: the AgentCore trial is chat-only).
 */

export class InvalidRequestedRuntimeError extends Error {
  constructor(public readonly value: string) {
    super(
      `Invalid requestedRuntime "${value}". Expected "agentcore" (or omit for the agent's configured runtime).`,
    );
    this.name = "InvalidRequestedRuntimeError";
  }
}

/**
 * Parse `metadata.requestedRuntime`. An explicit Pi or Harness value pins the
 * thread even when the tenant's future-thread default changes. Anything else
 * throws — a mistyped runtime request must never silently run Pi (R4).
 */
export function requestedRuntimeFromMetadata(
  metadata: unknown,
): "pi" | "agentcore" | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).requestedRuntime;
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "pi") return "pi";
    if (normalized === "agentcore" || normalized === "harness")
      return "agentcore";
  }
  throw new InvalidRequestedRuntimeError(String(value));
}
