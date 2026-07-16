/**
 * Per-turn runtime selection (THINK-311 U5b).
 *
 * The composer's runtime picker writes `metadata.requestedRuntime` on the
 * user message — the same channel as `requestedModelId`. Only the chat
 * dispatch honors it (KTD-7: the Harness trial is chat-only), and only
 * when the stage-level trial gate is enabled on chat-agent-invoke.
 */

export class InvalidRequestedRuntimeError extends Error {
  constructor(public readonly value: string) {
    super(
      `Invalid requestedRuntime "${value}". Expected "harness" (or omit for the agent's configured runtime).`,
    );
    this.name = "InvalidRequestedRuntimeError";
  }
}

/**
 * Parse `metadata.requestedRuntime`. Absent / "pi" → null (configured
 * runtime applies). "harness" → "harness". Anything else throws — a
 * mistyped runtime request must never silently run Pi (R4).
 */
export function requestedRuntimeFromMetadata(
  metadata: unknown,
): "harness" | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).requestedRuntime;
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "pi") return null;
    if (normalized === "harness") return "harness";
  }
  throw new InvalidRequestedRuntimeError(String(value));
}
