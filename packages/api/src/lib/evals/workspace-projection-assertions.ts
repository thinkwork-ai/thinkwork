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
 *
 * Content-aware sub-family (AE5): the `workspace-projection-agents-md-<op>`
 * types do NOT read JSONB metadata — they load the turn's write-once,
 * content-addressed AGENTS.md copy (`workspace_projection.agentsMdHistoryKey`)
 * from the workspace bucket and match the rendered markdown text. This lets a
 * test assert that, e.g., turn 3's rendered AGENTS.md listed Space B in its
 * routing section, regardless of the workspace's current state. The same
 * `evaluateAssertion` ops apply (contains / not-contains / equals / regex /
 * the i-variants). Edge cases all fail (never crash) with a distinct reason:
 * a turn with no `agentsMdHistoryKey` is explicitly reported as predating
 * immutable AGENTS.md history; a missing/expired S3 object is reported as
 * such. The S3 getter is injectable so tests never touch AWS.
 */

import { and, eq } from "drizzle-orm";
import { getConfig } from "@thinkwork/runtime-config";
import { S3Client } from "@aws-sdk/client-s3";
import { getDb, type Database } from "@thinkwork/database-pg";
import { threadTurns } from "@thinkwork/database-pg/schema";
import {
  evaluateAssertion,
  type EvalAssertion,
  type EvalAssertionResult,
} from "@thinkwork/evals-core";
import { S3WorkspaceRendererObjectStore } from "../workspace-renderer/s3-store.js";

export const WORKSPACE_PROJECTION_ASSERTION_PREFIX = "workspace-projection-";

/**
 * Sub-family prefix for the content-aware AGENTS.md assertions (AE5). These
 * still start with {@link WORKSPACE_PROJECTION_ASSERTION_PREFIX} so they
 * partition + tenant-scope like the metadata dot-path family, but instead of
 * reading a JSONB dot-path they load the turn's write-once, content-addressed
 * AGENTS.md copy (`workspace_projection.agentsMdHistoryKey`) from S3 and match
 * the rendered markdown text. Lets a Studio test assert on a *historical*
 * turn's rendered routing section, immune to later re-renders of the same
 * workspace.
 *
 *   {
 *     "type": "workspace-projection-agents-md-contains",
 *     "threadTurnId": "0c0ffee0-…",
 *     "value": "Spaces/board-pack"
 *   }
 */
export const WORKSPACE_PROJECTION_AGENTS_MD_ASSERTION_PREFIX =
  "workspace-projection-agents-md-";

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
 * True for the content-aware AGENTS.md sub-family
 * (`workspace-projection-agents-md-<op>`). These resolve the assertion target
 * by loading S3 content rather than walking the snapshot's JSONB.
 */
export function isWorkspaceProjectionAgentsMdAssertion(
  assertion: EvalAssertion,
): boolean {
  return (
    typeof assertion.type === "string" &&
    assertion.type.startsWith(WORKSPACE_PROJECTION_AGENTS_MD_ASSERTION_PREFIX)
  );
}

/**
 * Loads the rendered markdown text of a turn's write-once AGENTS.md history
 * object. Returns `null` when the object is absent (expired / transition-window
 * turn). Injectable so tests never reach AWS.
 */
export type AgentsMdHistoryLoader = (input: {
  bucket: string;
  key: string;
}) => Promise<string | null>;

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
  /**
   * Workspace bucket the `agents-md-history` objects live in. Defaults to the
   * runtime `WORKSPACE_BUCKET` config (same resolution the renderer uses).
   * Only consulted by the AGENTS.md content sub-family.
   */
  workspaceBucket?: string;
  /**
   * Loads a turn's write-once AGENTS.md history object content (AE5).
   * Defaults to a real S3-backed loader; injected in tests so the suite never
   * hits AWS. Only consulted by the AGENTS.md content sub-family.
   */
  loadAgentsMdHistory?: AgentsMdHistoryLoader;
}

/**
 * Default S3-backed AGENTS.md history loader. Mirrors how the renderer
 * constructs its client + reads objects: a region-pinned `S3Client` wrapped in
 * the shared `S3WorkspaceRendererObjectStore`, whose `getText` returns `null`
 * for a missing key (NoSuchKey/NotFound) rather than throwing.
 */
function defaultAgentsMdHistoryLoader(): AgentsMdHistoryLoader {
  const region =
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const store = new S3WorkspaceRendererObjectStore(new S3Client({ region }));
  return (input) => store.getText(input);
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
  // Resolved lazily — only the AGENTS.md sub-family needs S3 wiring, so a
  // metadata-only test case never constructs an S3 client.
  let agentsMdLoader: AgentsMdHistoryLoader | null = null;
  const resolveAgentsMdLoader = (): AgentsMdHistoryLoader => {
    if (!agentsMdLoader) {
      agentsMdLoader =
        options.loadAgentsMdHistory ?? defaultAgentsMdHistoryLoader();
    }
    return agentsMdLoader;
  };

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

    // ---- AGENTS.md content sub-family (AE5): match S3-stored render text ----
    if (isWorkspaceProjectionAgentsMdAssertion(assertion)) {
      const projection = turn.projection as Record<string, unknown>;
      const historyKey = projection.agentsMdHistoryKey;
      if (typeof historyKey !== "string" || historyKey.trim() === "") {
        results.push(
          failed(
            assertion,
            `Thread turn ${threadTurnId} predates immutable AGENTS.md history (no workspace_projection.agentsMdHistoryKey): its exact rendered AGENTS.md was never captured, so its content cannot be asserted. Only turns rendered after that capability shipped support content assertions.`,
          ),
        );
        continue;
      }

      const bucket =
        options.workspaceBucket ?? getConfig("WORKSPACE_BUCKET") ?? "";
      if (!bucket) {
        results.push(
          failed(
            assertion,
            `WORKSPACE_BUCKET is not configured; cannot load the AGENTS.md history object for turn ${threadTurnId}.`,
          ),
        );
        continue;
      }

      let agentsMd: string | null;
      try {
        agentsMd = await resolveAgentsMdLoader()({ bucket, key: historyKey });
      } catch (err) {
        results.push(
          failed(
            assertion,
            `Failed to load the AGENTS.md history object (${historyKey}) for turn ${threadTurnId}: ${err instanceof Error ? err.message : String(err)}.`,
          ),
        );
        continue;
      }
      if (agentsMd === null) {
        results.push(
          failed(
            assertion,
            `The AGENTS.md history object (${historyKey}) for turn ${threadTurnId} is missing from the workspace bucket (expired or rendered during a transition window); its content cannot be asserted.`,
          ),
        );
        continue;
      }

      const baseType = assertion.type.slice(
        WORKSPACE_PROJECTION_AGENTS_MD_ASSERTION_PREFIX.length,
      );
      const baseResult = await evaluateAssertion(
        { type: baseType, value: assertion.value },
        agentsMd,
        "",
      );
      results.push({
        ...assertion,
        passed: baseResult.passed,
        reason: `rendered AGENTS.md (turn ${threadTurnId}, ${historyKey}): ${baseResult.reason}`,
        ...(baseResult.score !== undefined ? { score: baseResult.score } : {}),
      });
      continue;
    }

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
