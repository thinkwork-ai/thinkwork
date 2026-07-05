/**
 * Unified tool-name collision registry (THINK-173 plan U3, R10, KTD-5).
 *
 * One module owns tool-name reservation and precedence across every
 * capability source. Today reserved sets are rebuilt ad hoc per call
 * site (agent-container server.ts) and only dynamic extensions defend
 * collisions at all; folder-defined tools would have added a fourth
 * unprotected source. Render (packages/api, U2) applies this registry
 * so collisions fail entries visibly at compile time (R10); the runtime
 * (packages/agentcore-pi, U6) applies it again as a second line of
 * defense over the same precedence.
 *
 * Precedence (KTD-5): builtin > platform > extension > binding > script.
 * Within the same source, first claim wins and later duplicates fail.
 * Comparison is case-sensitive exact match and names must satisfy
 * TOOL_NAME_RE — both deliberately identical to the runtime's existing
 * dynamic-extension checks so render-time verdicts predict runtime
 * behavior.
 */

/** Same shape the runtime enforces in dynamic-extensions.ts. */
export const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/**
 * Full Pi built-in tool set. Declared here (a zero-import module) so
 * packages/api's render pipeline can seed the reserved set without
 * pulling the agent-loop module; agent-loop re-exports it unchanged.
 * We pass an explicit allowlist so all seven are active in the cloud
 * sandbox — "leverage built-ins, disable nothing"
 * (feedback_pi_leverage_builtin_tools). Note: when `tools` is provided
 * to `createAgentSession` it is an allowlist that gates BOTH built-ins
 * and custom tools, so our platform tool names are appended in
 * `buildToolAllowlist`.
 */
export const BUILTIN_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export const CAPABILITY_TOOL_SOURCES = [
  "builtin",
  "platform",
  "extension",
  "binding",
  "script",
] as const;
export type CapabilityToolSource = (typeof CAPABILITY_TOOL_SOURCES)[number];

const PRECEDENCE: Record<CapabilityToolSource, number> = {
  builtin: 0,
  platform: 1,
  extension: 2,
  binding: 3,
  script: 4,
};

export interface ToolNameClaim {
  name: string;
  source: CapabilityToolSource;
  /** Where the claim came from (slug, extension id, "pi") — for verdicts. */
  origin?: string;
}

export type ToolNameVerdict =
  | { name: string; source: CapabilityToolSource; origin?: string; ok: true }
  | {
      name: string;
      source: CapabilityToolSource;
      origin?: string;
      ok: false;
      reason: "malformed_name" | "collision";
      /** The claim that holds the name (collision only). */
      winner?: { source: CapabilityToolSource; origin?: string };
    };

/**
 * Resolve a full set of tool-name claims into per-claim verdicts.
 *
 * Higher-precedence sources win regardless of claim order; ties within a
 * source go to the first claim. Losing claims fail with `collision` and
 * name the winner so render can surface "who holds this name" (AE2).
 */
export function resolveToolNameClaims(
  claims: readonly ToolNameClaim[],
): ToolNameVerdict[] {
  // Winner per name = lowest precedence rank, then earliest claim index.
  const winners = new Map<string, { claim: ToolNameClaim; index: number }>();
  claims.forEach((claim, index) => {
    if (!TOOL_NAME_RE.test(claim.name)) return;
    const current = winners.get(claim.name);
    if (
      !current ||
      PRECEDENCE[claim.source] < PRECEDENCE[current.claim.source]
    ) {
      winners.set(claim.name, { claim, index });
    }
  });

  return claims.map((claim, index) => {
    const base = {
      name: claim.name,
      source: claim.source,
      ...(claim.origin !== undefined ? { origin: claim.origin } : {}),
    };
    if (!TOOL_NAME_RE.test(claim.name)) {
      return { ...base, ok: false as const, reason: "malformed_name" as const };
    }
    const winner = winners.get(claim.name);
    if (!winner || (winner.claim === claim && winner.index === index)) {
      return { ...base, ok: true as const };
    }
    return {
      ...base,
      ok: false as const,
      reason: "collision" as const,
      winner: {
        source: winner.claim.source,
        ...(winner.claim.origin !== undefined
          ? { origin: winner.claim.origin }
          : {}),
      },
    };
  });
}

/**
 * Convenience for callers holding a fixed reserved set (the seven Pi
 * built-ins plus platform tool names): seeds them as builtin/platform
 * claims ahead of the candidate claims.
 */
export function resolveAgainstReserved(
  reserved: {
    builtinNames: readonly string[];
    platformNames?: readonly string[];
  },
  claims: readonly ToolNameClaim[],
): ToolNameVerdict[] {
  const seeded: ToolNameClaim[] = [
    ...reserved.builtinNames.map((name) => ({
      name,
      source: "builtin" as const,
      origin: "pi",
    })),
    ...(reserved.platformNames ?? []).map((name) => ({
      name,
      source: "platform" as const,
      origin: "platform",
    })),
    ...claims,
  ];
  // Only the caller's claims come back — the seeds are context.
  return resolveToolNameClaims(seeded).slice(
    reserved.builtinNames.length + (reserved.platformNames?.length ?? 0),
  );
}

/**
 * Deterministic binding tool name for backfilled/derived bindings
 * (R19): `<connection-slug>_<operation>`, sanitized to TOOL_NAME_RE's
 * alphabet. Namespacing makes builtin collisions rare, not impossible
 * (`web` + `search` → `web_search`) — the result must still pass
 * through the registry.
 */
export function bindingToolName(
  connectionSlug: string,
  operation: string,
): string {
  const raw = `${connectionSlug}_${operation}`;
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  const trimmed = sanitized.replace(/^[^a-zA-Z]+/, "");
  return (trimmed || "tool").slice(0, 64);
}
