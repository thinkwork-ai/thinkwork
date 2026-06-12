/**
 * Workspace-projection eval assertions (plan 2026-06-12-002 U10, origin
 * R17/AE5).
 *
 * Lets a Studio test case assert against the STORED per-turn workspace
 * projection snapshot (`thread_turns.context_snapshot.workspace_projection`,
 * shape documented in `../workspace-projection-snapshot.ts`) instead of the
 * agent's output. Evaluation only ever reads the stored snapshot — it never
 * re-renders the workspace — so a passing assertion is stable regardless of
 * later renders of the same workspace.
 *
 * Assertion vocabulary: the existing evals-core types (`contains`,
 * `not-contains`, `icontains`, `not-icontains`, `equals`, `regex`) prefixed
 * with `workspace-projection-`, plus a required `threadTurnId` field naming
 * the turn whose snapshot to read. `path` (optional) is a dot-path into the
 * snapshot object; omitted = the whole snapshot serialized as JSON.
 *
 *   {
 *     "type": "workspace-projection-contains",
 *     "threadTurnId": "0c0ffee0-…",
 *     "path": "injectedFiles",
 *     "value": "AGENTS.md"
 *   }
 *
 * No new DSL beyond the prefix + target turn: the comparison itself is
 * delegated to evals-core's `evaluateAssertion`. Missing turn / missing
 * snapshot / bad path all fail the assertion with a clear reason — never a
 * crash (plan U10 edge scenario).
 */

import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "@thinkwork/database-pg";
import { threadTurns } from "@thinkwork/database-pg/schema";
import {
  evaluateAssertion,
  type EvalAssertion,
  type EvalAssertionResult,
} from "@thinkwork/evals-core";

export const WORKSPACE_PROJECTION_ASSERTION_PREFIX = "workspace-projection-";

/** An eval assertion targeting a stored turn's workspace projection. */
export interface WorkspaceProjectionAssertion extends EvalAssertion {
  /** `workspace-projection-<evals-core type>`, e.g. `workspace-projection-contains`. */
  type: string;
  /** The thread turn whose stored snapshot to assert against. Required. */
  threadTurnId?: string | null;
}

export function isWorkspaceProjectionAssertion(
  assertion: EvalAssertion,
): assertion is WorkspaceProjectionAssertion {
  return (
    typeof assertion.type === "string" &&
    assertion.type.startsWith(WORKSPACE_PROJECTION_ASSERTION_PREFIX)
  );
}

/**
 * Split a test case's assertions into the output-targeting ones (evaluated by
 * evals-core against the agent's response, unchanged behavior) and the
 * projection-targeting ones (evaluated here against stored snapshots).
 */
export function partitionEvalAssertions(assertions: EvalAssertion[]): {
  outputAssertions: EvalAssertion[];
  projectionAssertions: WorkspaceProjectionAssertion[];
} {
  const outputAssertions: EvalAssertion[] = [];
  const projectionAssertions: WorkspaceProjectionAssertion[] = [];
  for (const assertion of assertions) {
    if (isWorkspaceProjectionAssertion(assertion)) {
      projectionAssertions.push(assertion);
    } else {
      outputAssertions.push(assertion);
    }
  }
  return { outputAssertions, projectionAssertions };
}

/**
 * Resolve a dot-path into the snapshot (e.g. `"agentsMdKey"`,
 * `"sources.0.prefix"`, `"reconcile.rejectedCount"`). Returns `undefined`
 * when any segment is missing.
 */
export function resolveProjectionPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function targetText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export interface EvaluateWorkspaceProjectionAssertionsOptions {
  /**
   * Tenant scoping is mandatory: a test-case-supplied threadTurnId must never
   * read another tenant's turn snapshot.
   */
  tenantId: string;
  /** Injectable for tests; defaults to the shared singleton. */
  db?: Database;
}

export interface WorkspaceProjectionAssertionOutcome {
  results: EvalAssertionResult[];
  /**
   * The first turn (in assertion order) whose snapshot was successfully
   * loaded within the tenant — recorded as `eval_results.thread_turn_id` so
   * the result row links back to the asserted turn. Null when no referenced
   * turn could be loaded (the FK must only ever point at a real turn).
   */
  threadTurnId: string | null;
}

/**
 * Load `context_snapshot.workspace_projection` for one turn, tenant-scoped.
 * Returns `{ found, projection }` so callers can distinguish "turn missing"
 * from "turn exists but has no stored snapshot".
 */
export async function loadStoredWorkspaceProjection(input: {
  threadTurnId: string;
  tenantId: string;
  db?: Database;
}): Promise<{ found: boolean; projection: unknown }> {
  const db = input.db ?? getDb();
  const rows = await db
    .select({ context_snapshot: threadTurns.context_snapshot })
    .from(threadTurns)
    .where(
      and(
        eq(threadTurns.id, input.threadTurnId),
        eq(threadTurns.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { found: false, projection: undefined };
  const snapshot = row.context_snapshot as Record<string, unknown> | null;
  return { found: true, projection: snapshot?.workspace_projection };
}

function failed(
  assertion: WorkspaceProjectionAssertion,
  reason: string,
): EvalAssertionResult {
  return { ...assertion, passed: false, score: 0, reason };
}

/**
 * Evaluate projection-targeting assertions against STORED snapshots only.
 * Each distinct turn is loaded once; the comparison is delegated to
 * evals-core's `evaluateAssertion` with the `workspace-projection-` prefix
 * stripped, then the result is stamped back with the original type so the
 * persisted `eval_results.assertions` snapshot stays self-describing.
 */
export async function evaluateWorkspaceProjectionAssertions(
  assertions: WorkspaceProjectionAssertion[],
  options: EvaluateWorkspaceProjectionAssertionsOptions,
): Promise<WorkspaceProjectionAssertionOutcome> {
  const results: EvalAssertionResult[] = [];
  let linkedThreadTurnId: string | null = null;
  const loaded = new Map<string, { found: boolean; projection: unknown }>();

  for (const assertion of assertions) {
    const threadTurnId =
      typeof assertion.threadTurnId === "string"
        ? assertion.threadTurnId.trim()
        : "";
    if (!threadTurnId) {
      results.push(
        failed(
          assertion,
          `Assertion type "${assertion.type}" requires a threadTurnId naming the turn whose stored workspace projection to read.`,
        ),
      );
      continue;
    }

    let turn = loaded.get(threadTurnId);
    if (!turn) {
      try {
        turn = await loadStoredWorkspaceProjection({
          threadTurnId,
          tenantId: options.tenantId,
          db: options.db,
        });
      } catch (err) {
        turn = { found: false, projection: undefined };
        console.warn(
          `[workspace-projection-assertions] failed to load turn ${threadTurnId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      loaded.set(threadTurnId, turn);
    }

    if (!turn.found) {
      results.push(
        failed(
          assertion,
          `Thread turn ${threadTurnId} was not found for this tenant; cannot read its workspace projection snapshot.`,
        ),
      );
      continue;
    }
    if (turn.projection === undefined || turn.projection === null) {
      results.push(
        failed(
          assertion,
          `Thread turn ${threadTurnId} has no stored workspace projection snapshot (pre-feature turn or non-dispatch turn).`,
        ),
      );
      continue;
    }
    if (!linkedThreadTurnId) linkedThreadTurnId = threadTurnId;

    const path = assertion.path?.trim() || "";
    const target = path
      ? resolveProjectionPath(turn.projection, path)
      : turn.projection;
    if (path && target === undefined) {
      results.push(
        failed(
          assertion,
          `Snapshot path "${path}" not found in the stored workspace projection of turn ${threadTurnId}.`,
        ),
      );
      continue;
    }

    const baseType = assertion.type.slice(
      WORKSPACE_PROJECTION_ASSERTION_PREFIX.length,
    );
    const baseResult = await evaluateAssertion(
      { type: baseType, value: assertion.value, path: assertion.path },
      targetText(target),
      "",
    );
    results.push({
      ...assertion,
      passed: baseResult.passed,
      reason: `workspace projection (turn ${threadTurnId}${path ? `, path "${path}"` : ""}): ${baseResult.reason}`,
      ...(baseResult.score !== undefined ? { score: baseResult.score } : {}),
    });
  }

  return { results, threadTurnId: linkedThreadTurnId };
}
