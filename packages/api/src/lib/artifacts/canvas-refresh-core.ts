/**
 * Living Artifacts (THINK-145 U6): headless canvas-refresh core.
 *
 * Pure orchestration for the data-refresh loop (R6/R7/R8/R9), factored out of
 * the `canvas-refresh` Lambda handler so it is unit-testable WITHOUT a DB, S3,
 * or MCP transport: every side effect is an injected dependency. The handler
 * wires the real deps (Drizzle, Secrets-Manager-backed MCP resolution, S3 head
 * write, thread_turn_events append); tests wire fakes.
 *
 * NO model / Bedrock invocation happens here or in the handler — a headless
 * data-refresh consumes no agent turn and no tokens (Success Criteria). This
 * module has zero AWS imports by construction.
 *
 * Per-binding decision table:
 *   - per_user_oauth binding      → NEEDS_USER: no invoke, quality STALE, a
 *                                    "refresh needs you" affordance (R9/AE1) —
 *                                    UNLESS the verified requesting user IS the
 *                                    binding owner and an owner-scoped resolver
 *                                    is wired (THINK-172 U2b): then the refresh
 *                                    proceeds under the OWNER's credential and
 *                                    follows the ordinary outcome rows below.
 *   - tenant server unresolved    → SERVER_MISSING: terminal quality BAD (R8).
 *   - tool transport / isError    → FAILED: quality BAD, last-good retained (R8).
 *   - result-shape hash mismatch  → SCHEMA_STALE: head untouched, quality
 *                                    SCHEMA_STALE, escalation flagged (R7/AE2).
 *   - hash match + head applied   → REFRESHED: quality GOOD + timestamps.
 *   - hash match, head write raced
 *     by a spec re-emit           → SKIPPED: quality STALE, no clobber (KTD6).
 */

import {
  canvasShapeHashForToolResult,
  resultShapeHash,
  tabularEnvelopeFromRaw,
} from "@thinkwork/thread-json-render";

/** How a refresh was triggered — provenance only (no behavioral branch). */
export type CanvasRefreshTrigger = "user" | "schedule" | "agent";

/** Per-binding refresh outcome (maps 1:1 to a quality-state transition). */
export type CanvasRefreshOutcome =
  | "refreshed"
  | "schema_stale"
  | "needs_user"
  | "failed"
  | "server_missing"
  | "skipped";

/** Freshness quality persisted on the binding row (KTD2 vocabulary). */
export type CanvasBindingQuality = "good" | "stale" | "bad" | "schema_stale";

/** Minimal binding fields the refresh loop needs (subset of the DB row). */
export interface CanvasRefreshBinding {
  id: string;
  partId: string;
  elementId: string;
  serverName: string;
  serverRef: string;
  toolName: string;
  frozenArgs: Record<string, unknown>;
  resultShapeHash: string;
  authContext: "tenant_mcp" | "per_user_oauth";
  quality: string;
  /** Credential owner of a per-user binding (null for tenant bindings). */
  ownerUserId?: string | null;
}

export interface CanvasRefreshBindingResult {
  bindingId: string;
  partId: string;
  elementId: string;
  outcome: CanvasRefreshOutcome;
  quality: CanvasBindingQuality;
  reason: string | null;
  /** True when the model must be asked to re-emit the spec (R7 escalation). */
  escalate: boolean;
  /**
   * The saved source tool call behind the binding. Carried on every outcome so
   * a NEEDS_USER result is actionable in-turn: the agent (acting for the
   * credential owner) can re-run `toolName` on `serverName` and re-emit the
   * part instead of just reporting "needs the owner".
   */
  serverName: string;
  toolName: string;
  /**
   * THINK-233 sentinel signal: true when a SUCCESSFUL refresh produced a
   * payload that differs materially from the head's previous bound payload for
   * this element. False on every non-refreshed outcome and when there was no
   * prior payload (first population is never a "change"). Consumed headlessly
   * by the scheduled-refresh sentinel to decide whether to escalate a
   * re-narration turn — it is NOT a per-binding quality transition.
   */
  payloadChanged: boolean;
}

/**
 * Recursively normalize a JSON value into a canonical form for
 * order-INSENSITIVE deep comparison: object keys are sorted; object properties
 * that are `undefined` are dropped (a key present-as-undefined equals an absent
 * key); arrays keep their order (row/element order is semantically meaningful
 * for tabular widget payloads); primitives pass through. There is no
 * fetchedAt/refresh-metadata to strip here because the comparison operates on
 * the bound PAYLOAD (the tool result `raw`), not the head's `boundData`
 * wrapper — the freshness timestamps live on the wrapper, never inside `raw`.
 */
function normalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = normalizeForCompare(v);
    }
    return out;
  }
  return value;
}

/**
 * True when `next` differs materially from `previous` after normalization. A
 * refresh with NO prior payload (`previous === undefined`) is NOT a change —
 * the sentinel fires on a genuine value shift, never on first population.
 * Key ordering and present-as-undefined properties are ignored; array order is
 * significant. Pure + side-effect free (unit-tested).
 */
export function payloadChanged(previous: unknown, next: unknown): boolean {
  if (previous === undefined) return false;
  return (
    JSON.stringify(normalizeForCompare(previous)) !==
    JSON.stringify(normalizeForCompare(next))
  );
}

/** Result of resolving a tenant MCP server target for headless execution. */
export type ResolveServerTargetResult =
  | { kind: "ok"; target: unknown }
  | { kind: "missing"; reason: string }
  | { kind: "needs_user"; reason: string };

/** Result of a headless tool re-invoke (transport-normalized). */
export interface RefreshToolCallResult {
  isError: boolean;
  /** Raw JSON-RPC result — hashed ANALOGOUSLY to capture-time `details.raw`. */
  raw: unknown;
}

/** Outcome of the KTD6-guarded head data-slice write. */
export type ApplyHeadDataOutcome =
  /** Data slice applied to the head under the concurrency guard. */
  | "applied"
  /** A concurrent spec change (re-emit / save / pin) won — no write (KTD6). */
  | "stale";

/**
 * Injected side effects. Each is failure-isolated by the caller; the core only
 * sequences them and maps results to outcomes.
 */
export interface CanvasRefreshDeps {
  /** Resolve the binding's tenant server to a callable target (headless). */
  resolveServerTarget(input: {
    serverName: string;
  }): Promise<ResolveServerTargetResult>;
  /**
   * The VERIFIED user who initiated this refresh, when it was user-initiated
   * (THINK-172 U2b). Set only from an authenticated interactive caller —
   * scheduled/unattended refreshes leave it unset, preserving the R9 posture.
   */
  actingUserId?: string | null;
  /**
   * Owner-scoped server resolution: resolve the binding's server under the
   * named user's stored credential (`user_mcp_tokens`). Only consulted when
   * `actingUserId` matches the binding's `ownerUserId`.
   */
  resolveOwnerServerTarget?(input: {
    serverName: string;
    userId: string;
  }): Promise<ResolveServerTargetResult>;
  /** Re-invoke the saved tool call under the binding's identity. */
  callTool(input: {
    target: unknown;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<RefreshToolCallResult>;
  /**
   * Apply the fresh payload to the head's bound-part data slice under the KTD6
   * conditional-UPDATE guard. Must re-read the head, re-validate the binding's
   * CURRENT result-shape hash against `fetchedShapeHash`, and abort (`"stale"`)
   * on mismatch or on losing the write race — never clobbering a spec change.
   */
  applyHeadData(input: {
    bindingId: string;
    partId: string;
    elementId: string;
    payload: unknown;
    fetchedShapeHash: string;
    fetchedAt: Date;
  }): Promise<ApplyHeadDataOutcome>;
  /**
   * THINK-233: read the head's CURRENT bound payload for this element BEFORE
   * applyHeadData overwrites it, so the core can report `payloadChanged` on a
   * successful refresh. Optional — unset (or returning `undefined`) means no
   * prior payload is known, so `payloadChanged` reads false. Never throws for a
   * missing head/element; returns `undefined`.
   */
  readPreviousPayload?(input: {
    bindingId: string;
    partId: string;
    elementId: string;
  }): Promise<unknown>;
  /** Persist the binding's new quality + freshness timestamps. */
  writeBindingQuality(input: {
    bindingId: string;
    quality: CanvasBindingQuality;
    /** Stamp `last_fetched_at = now` when a fetch was actually attempted. */
    markFetched: boolean;
    /** Stamp `last_good_at = now` on a successful data application. */
    markGood: boolean;
    now: Date;
  }): Promise<void>;
  now(): Date;
}

/**
 * Refresh a single binding. Never throws for transport/tool faults — a fault is
 * a BAD quality with last-good retained (R8). Deps that throw are surfaced to
 * the caller (handler decides). Returns the per-binding result.
 */
export async function refreshBinding(
  binding: CanvasRefreshBinding,
  deps: CanvasRefreshDeps,
): Promise<CanvasRefreshBindingResult> {
  const base = {
    bindingId: binding.id,
    partId: binding.partId,
    elementId: binding.elementId,
    serverName: binding.serverName,
    toolName: binding.toolName,
    // Default: no material change. Only the successful-apply path recomputes
    // this against the prior head payload (THINK-233 sentinel signal).
    payloadChanged: false,
  };

  // R9 / AE1: per-user OAuth bindings are excluded from UNATTENDED refresh.
  // Owner-eligible exception (THINK-172 U2b): when the verified requesting
  // user IS the binding's credential owner and an owner-scoped resolver is
  // wired, refresh proceeds under the owner's credential. Anything less —
  // no acting user, unknown owner, mismatch, no resolver — degrades to
  // STALE + NEEDS_USER exactly as before.
  const ownerEligible =
    binding.authContext === "per_user_oauth" &&
    typeof deps.actingUserId === "string" &&
    deps.actingUserId.length > 0 &&
    typeof binding.ownerUserId === "string" &&
    binding.ownerUserId.length > 0 &&
    deps.actingUserId === binding.ownerUserId &&
    typeof deps.resolveOwnerServerTarget === "function";
  if (binding.authContext === "per_user_oauth" && !ownerEligible) {
    await deps.writeBindingQuality({
      bindingId: binding.id,
      quality: "stale",
      markFetched: false,
      markGood: false,
      now: deps.now(),
    });
    return {
      ...base,
      outcome: "needs_user",
      quality: "stale",
      reason: "Refresh needs the credential owner (per-user OAuth).",
      escalate: false,
    };
  }

  // Resolve the server: under the owner's credential for an owner-eligible
  // per-user binding, else the tenant identity. A vanished / disabled /
  // unresolved server is a TERMINAL bad state distinct from a transient tool
  // failure (R8).
  const resolved = ownerEligible
    ? await deps.resolveOwnerServerTarget!({
        serverName: binding.serverName,
        userId: deps.actingUserId as string,
      })
    : await deps.resolveServerTarget({
        serverName: binding.serverName,
      });
  if (resolved.kind === "missing") {
    await deps.writeBindingQuality({
      bindingId: binding.id,
      quality: "bad",
      markFetched: true,
      markGood: false,
      now: deps.now(),
    });
    return {
      ...base,
      outcome: "server_missing",
      quality: "bad",
      reason: resolved.reason,
      escalate: false,
    };
  }
  if (resolved.kind === "needs_user") {
    // Defense in depth: a server that resolves as per-user despite a tenant_mcp
    // binding classification degrades to STALE, never a mis-scoped invoke.
    await deps.writeBindingQuality({
      bindingId: binding.id,
      quality: "stale",
      markFetched: false,
      markGood: false,
      now: deps.now(),
    });
    return {
      ...base,
      outcome: "needs_user",
      quality: "stale",
      reason: resolved.reason,
      escalate: false,
    };
  }

  // Headless re-invoke. A transport throw or an MCP `isError` result keeps the
  // last-good data and marks BAD (never blanks the widget — R8).
  let call: RefreshToolCallResult;
  try {
    call = await deps.callTool({
      target: resolved.target,
      toolName: binding.toolName,
      args: binding.frozenArgs,
    });
  } catch (err) {
    await deps.writeBindingQuality({
      bindingId: binding.id,
      quality: "bad",
      markFetched: true,
      markGood: false,
      now: deps.now(),
    });
    return {
      ...base,
      outcome: "failed",
      quality: "bad",
      reason: err instanceof Error ? err.message : String(err),
      escalate: false,
    };
  }
  if (call.isError) {
    await deps.writeBindingQuality({
      bindingId: binding.id,
      quality: "bad",
      markFetched: true,
      markGood: false,
      now: deps.now(),
    });
    return {
      ...base,
      outcome: "failed",
      quality: "bad",
      reason: "Tool returned an error result.",
      escalate: false,
    };
  }

  // R7 / AE2: a result-shape hash mismatch is a SCHEMA refresh, not a data
  // refresh. Keep last-good rendering, flag SCHEMA_STALE, escalate to an agent
  // turn — the mismatched payload is NEVER applied to the head (no applyHeadData).
  // Shape-detecting hashing (THINK-228 KTD2): a tabular envelope hashes its
  // value-invariant columns descriptor so nullable-key/staging churn never
  // trips this gate; only a genuine column-set change does.
  const fetchedShapeHash = canvasShapeHashForToolResult({
    raw: call.raw,
    genericHash: resultShapeHash,
  });
  if (fetchedShapeHash !== binding.resultShapeHash) {
    await deps.writeBindingQuality({
      bindingId: binding.id,
      quality: "schema_stale",
      markFetched: true,
      markGood: false,
      now: deps.now(),
    });
    return {
      ...base,
      outcome: "schema_stale",
      quality: "schema_stale",
      reason: "Result shape changed; spec re-emission required.",
      escalate: true,
    };
  }

  // THINK-228 R14 (truncated drift): the columns descriptor is deliberately
  // value-invariant, so a `truncated` flip alone never changes the hash — but
  // silently applying a truncated result would render a PARTIAL aggregate as
  // if it were complete. Escalate instead (explicit check, per plan KTD2/U7).
  const fetchedEnvelope = tabularEnvelopeFromRaw(call.raw);
  if (fetchedEnvelope?.truncated) {
    await deps.writeBindingQuality({
      bindingId: binding.id,
      quality: "schema_stale",
      markFetched: true,
      markGood: false,
      now: deps.now(),
    });
    return {
      ...base,
      outcome: "schema_stale",
      quality: "schema_stale",
      reason:
        "Refreshed result is truncated; re-aggregation by the agent required.",
      escalate: true,
    };
  }

  // THINK-233 sentinel: capture the PRIOR head payload for this element before
  // applyHeadData overwrites it, so a successful refresh can report whether the
  // fresh payload materially changed. Best-effort — an unreadable head reads as
  // "no prior payload" (→ not a change), never a refresh failure.
  const previousPayload = deps.readPreviousPayload
    ? await deps
        .readPreviousPayload({
          bindingId: binding.id,
          partId: binding.partId,
          elementId: binding.elementId,
        })
        .catch(() => undefined)
    : undefined;

  // Hash match: apply the fresh data slice to the head under the KTD6 guard.
  const fetchedAt = deps.now();
  const applied = await deps.applyHeadData({
    bindingId: binding.id,
    partId: binding.partId,
    elementId: binding.elementId,
    payload: call.raw,
    fetchedShapeHash,
    fetchedAt,
  });

  if (applied === "stale") {
    // Lost the head-write race to a concurrent spec change (or the binding was
    // re-captured with a new shape mid-flight). No clobber; degrade to STALE.
    await deps.writeBindingQuality({
      bindingId: binding.id,
      quality: "stale",
      markFetched: true,
      markGood: false,
      now: deps.now(),
    });
    return {
      ...base,
      outcome: "skipped",
      quality: "stale",
      reason: "Head changed concurrently; refresh not applied.",
      escalate: false,
    };
  }

  await deps.writeBindingQuality({
    bindingId: binding.id,
    quality: "good",
    markFetched: true,
    markGood: true,
    now: deps.now(),
  });
  return {
    ...base,
    outcome: "refreshed",
    quality: "good",
    reason: null,
    escalate: false,
    payloadChanged: payloadChanged(previousPayload, call.raw),
  };
}

/**
 * Refresh every binding of a canvas (or just the one part). Bindings are
 * refreshed sequentially — a canvas has a handful of parts, and sequential
 * keeps head writes ordered so their KTD6 guards don't fight each other.
 */
export async function refreshCanvasBindings(
  bindings: readonly CanvasRefreshBinding[],
  deps: CanvasRefreshDeps,
): Promise<CanvasRefreshBindingResult[]> {
  const results: CanvasRefreshBindingResult[] = [];
  for (const binding of bindings) {
    results.push(await refreshBinding(binding, deps));
  }
  return results;
}
