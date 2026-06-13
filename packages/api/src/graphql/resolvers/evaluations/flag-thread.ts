/**
 * flagThreadForEval — flag a completed thread turn into a custom eval
 * dataset (Evaluations Trust Core U7).
 *
 * Tenant triangle, pinned BEFORE any S3 write:
 *   1. load the thread → NOT_FOUND when missing,
 *   2. requireTenantAdmin(ctx, thread.tenant_id) — failures surface as
 *      NOT_FOUND so a cross-tenant thread id is indistinguishable from a
 *      nonexistent one (no existence oracle),
 *   3. the target dataset must belong to the same tenant (slug lookup is
 *      tenant-scoped, so a foreign dataset can never resolve) and must
 *      be a custom dataset (the baseline suite is not a flag target),
 *   4. the turn must belong to the thread and must not be in flight.
 *
 * The flag-time snapshot (lib/evals/thread-snapshot.ts) is written to
 * the dataset's guarded S3 prefix first; the case file lands last so a
 * case never points at missing payloads. Everything the case needs
 * lives in the dataset prefix — it survives source-thread deletion
 * (AE5) and degrades gracefully on pre-THNK-10 threads (history-only
 * completeness badge).
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  asc,
  db,
  eq,
  and,
  messages,
  threadTurns,
  threads,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  EVAL_DATASET_SLUG_RE,
  assertValidCaseId,
  createEvalDataset as createDatasetInStore,
  getEvalDatasetCase,
  putEvalDatasetCase,
  type DatasetContext,
  type EvalCaseOutcomeKind,
} from "../../../lib/evals/dataset-store.js";
import {
  buildFlaggedCaseCore,
  buildThreadSnapshot,
  flaggedCaseIdBase,
  writeFlaggedCasePayloads,
  type FlaggedTurnRow,
  type ThreadMessageRow,
} from "../../../lib/evals/thread-snapshot.js";
import {
  badInput,
  caseRowToGraphql,
  datasetDeps,
  datasetToGraphql,
  loadCaseRowOrThrow,
  loadDatasetRow,
  loadDatasetRowOrThrow,
  loadTenantSlug,
} from "./datasets.js";

function notFound(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "NOT_FOUND" },
  });
}

/**
 * Non-terminal turn statuses (thread_turns vocabulary: queued | running |
 * succeeded | failed | cancelled | timed_out | skipped, plus legacy
 * pending/claimed/completed spellings). Flagging an in-flight turn would
 * snapshot a half-written conversation.
 */
const IN_FLIGHT_TURN_STATUSES = new Set([
  "queued",
  "running",
  "pending",
  "claimed",
]);

/** Slug budget is 64; keep room for collision suffixes (-2 … -99). */
const DATASET_SLUG_BASE_MAX = 60;

export function slugifyDatasetName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, DATASET_SLUG_BASE_MAX)
    .replace(/-+$/, "");
  const slug = /^[a-z]/.test(base) ? base : base ? `ds-${base}` : "";
  if (!slug || !EVAL_DATASET_SLUG_RE.test(slug)) {
    throw badInput(
      `Could not derive a dataset slug from "${name}": the name needs at least one letter or digit.`,
    );
  }
  return slug;
}

interface FlagThreadForEvalInput {
  threadId: string;
  turnId: string;
  datasetSlug?: string | null;
  newDatasetName?: string | null;
  resolutionTarget: string;
  outcomeKind: string;
}

const flagThreadForEval = async (
  _p: unknown,
  args: { input: FlagThreadForEvalInput },
  ctx: GraphQLContext,
) => {
  const input = args.input;

  // Input validation first — AE3: no resolution target → rejected with
  // zero side effects (no case, no S3 writes).
  const resolutionTarget = (input.resolutionTarget ?? "").trim();
  if (!resolutionTarget) {
    throw badInput(
      "A resolution target is required: describe what a correct response looks like.",
    );
  }
  const outcomeKind = String(input.outcomeKind ?? "")
    .trim()
    .toLowerCase() as EvalCaseOutcomeKind;
  if (outcomeKind !== "security" && outcomeKind !== "quality") {
    throw badInput(`Invalid outcome kind: must be 'security' or 'quality'.`);
  }
  const existingSlug = input.datasetSlug?.trim() || null;
  const newDatasetName = input.newDatasetName?.trim() || null;
  if ((existingSlug == null) === (newDatasetName == null)) {
    throw badInput(
      "Provide exactly one of datasetSlug (existing dataset) or newDatasetName (create one).",
    );
  }
  if (existingSlug && !EVAL_DATASET_SLUG_RE.test(existingSlug)) {
    throw badInput(`Invalid dataset slug "${existingSlug}".`);
  }

  // Tenant triangle (1): thread row → NOT_FOUND when missing.
  const [thread] = await db
    .select({
      id: threads.id,
      tenant_id: threads.tenant_id,
      title: threads.title,
    })
    .from(threads)
    .where(eq(threads.id, input.threadId));
  if (!thread) throw notFound("Thread not found");

  // Tenant triangle (2): operator of the THREAD's tenant — derived from
  // the row, never caller input. Authz failures surface as NOT_FOUND so
  // cross-tenant thread ids don't leak existence.
  try {
    await requireTenantAdmin(ctx, thread.tenant_id);
  } catch {
    throw notFound("Thread not found");
  }
  const tenantId = thread.tenant_id;

  // Tenant triangle (4): the turn must be this thread's, and completed.
  const [turn] = await db
    .select({
      id: threadTurns.id,
      tenant_id: threadTurns.tenant_id,
      thread_id: threadTurns.thread_id,
      status: threadTurns.status,
      started_at: threadTurns.started_at,
      finished_at: threadTurns.finished_at,
      context_snapshot: threadTurns.context_snapshot,
    })
    .from(threadTurns)
    .where(eq(threadTurns.id, input.turnId));
  if (!turn || turn.thread_id !== thread.id || turn.tenant_id !== tenantId) {
    throw badInput("Turn does not belong to this thread.");
  }
  const turnStatus = String(turn.status ?? "")
    .trim()
    .toLowerCase();
  if (IN_FLIGHT_TURN_STATUSES.has(turnStatus)) {
    throw badInput(
      "This turn is still in flight — flag it once it has completed.",
    );
  }

  const tenantSlug = await loadTenantSlug(tenantId);
  const { storage, store } = datasetDeps();

  // Tenant triangle (3): resolve the target dataset under THIS tenant.
  let datasetSlug: string;
  if (existingSlug) {
    const datasetRow = await loadDatasetRow(tenantId, existingSlug);
    if (!datasetRow) {
      // Tenant-scoped lookup: a dataset belonging to another tenant can
      // never resolve here — same outcome as a nonexistent slug.
      throw notFound(`Dataset ${existingSlug} not found`);
    }
    if (datasetRow.kind === "baseline") {
      throw badInput(
        "Flagged cases go into custom datasets — the baseline suite is not a flag target.",
      );
    }
    if (datasetRow.archived_at) {
      throw badInput(`Dataset ${existingSlug} is archived.`);
    }
    datasetSlug = existingSlug;
  } else {
    const baseSlug = slugifyDatasetName(newDatasetName as string);
    let created: string | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      const dctx: DatasetContext = { tenantId, tenantSlug, slug: candidate };
      try {
        await createDatasetInStore(
          dctx,
          { name: newDatasetName, kind: "custom" },
          storage,
          store,
        );
        created = candidate;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/already exists/i.test(message)) throw badInput(message);
      }
    }
    if (!created) {
      throw badInput(
        `Could not create dataset "${newDatasetName}": too many similarly named datasets.`,
      );
    }
    datasetSlug = created;
  }
  const dctx: DatasetContext = { tenantId, tenantSlug, slug: datasetSlug };

  // Snapshot capture — message history up to and including the flagged
  // turn, the THNK-10 workspace projection when present, tool traces
  // when retrievable. All from rows already loaded here; no live-thread
  // reference survives into the case (AE5).
  const messageRows = (await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      parts: messages.parts,
      tool_calls: messages.tool_calls,
      tool_results: messages.tool_results,
      created_at: messages.created_at,
    })
    .from(messages)
    .where(
      and(eq(messages.thread_id, thread.id), eq(messages.tenant_id, tenantId)),
    )
    .orderBy(asc(messages.created_at))) as ThreadMessageRow[];

  const snapshot = buildThreadSnapshot({
    messages: messageRows,
    turn: turn as FlaggedTurnRow,
  });

  // Stable-ish case id from (thread, turn); suffix on collision.
  const caseIdBase = flaggedCaseIdBase(thread.id, turn.id);
  let caseId = caseIdBase;
  for (let attempt = 2; ; attempt += 1) {
    assertValidCaseId(caseId);
    const existing = await getEvalDatasetCase(dctx, caseId, storage);
    if (!existing) break;
    if (attempt > 50) {
      throw new GraphQLError(`Could not allocate a case id for ${caseIdBase}`, {
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      });
    }
    caseId = `${caseIdBase}-${attempt}`;
  }

  // Payload objects first, case file last — a case never points at
  // missing payloads.
  await writeFlaggedCasePayloads(dctx, caseId, snapshot, storage);
  const core = buildFlaggedCaseCore({
    caseId,
    threadId: thread.id,
    turnId: turn.id,
    threadTitle: thread.title,
    snapshot,
    resolutionTarget,
    outcomeKind,
  });
  await putEvalDatasetCase(dctx, core, null, storage, store);

  const datasetRow = await loadDatasetRowOrThrow(tenantId, datasetSlug);
  const caseRow = await loadCaseRowOrThrow(String(datasetRow.id), caseId);
  return {
    case: caseRowToGraphql(caseRow),
    dataset: datasetToGraphql(datasetRow),
    completeness: snapshot.completeness,
  };
};

export const flagThreadMutations = {
  flagThreadForEval,
};
