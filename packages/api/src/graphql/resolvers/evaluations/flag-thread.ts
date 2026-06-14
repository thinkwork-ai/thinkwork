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
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
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
  isSkillDatasetSlug,
  skillEvalDatasetSlug,
} from "../../../lib/evals/skill-dataset.js";
import { listIndexedSkills } from "../../../lib/catalog-index.js";
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

/**
 * Tag stamped on a flagged case whose skill attribution came from the
 * low-confidence INSTALLED-skill fallback (Skill Tests & Evals U8): the
 * turn carried no recorded `activeSkills`, so the operator picked from the
 * tenant's currently-installed catalog skills, which may differ from what
 * was active when the (older) turn ran. The tag lets a later audit
 * quarantine a possible misattribution. NOT applied when the operator
 * picked an `active`-source candidate (high confidence).
 */
const ATTRIBUTION_FALLBACK_TAG = "attribution:fallback";

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
  /**
   * Skill attribution (Skill Tests & Evals U8). When provided, the case
   * routes into that skill's per-skill dataset (`skill-<slug>`), which is
   * created on demand if the skill has shipped no bundled cases yet.
   * Mutually exclusive with datasetSlug / newDatasetName.
   */
  skillSlug?: string | null;
  /**
   * True when the operator picked the skill from the low-confidence
   * INSTALLED-skill fallback (the turn had no recorded activeSkills) rather
   * than an `active`-source candidate. Stamps the case with
   * `attribution:fallback` so a later audit can quarantine a possible
   * misattribution. Only meaningful alongside skillSlug.
   */
  attributionFallback?: boolean | null;
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
  // Three-way attribution (U8): exactly one of skillSlug (route into the
  // skill's `skill-<slug>` dataset), datasetSlug (existing custom dataset),
  // or newDatasetName (create a custom dataset). "Not skill-specific" is
  // the existing datasetSlug/newDatasetName path, unchanged.
  const skillSlug = input.skillSlug?.trim() || null;
  const existingSlug = input.datasetSlug?.trim() || null;
  const newDatasetName = input.newDatasetName?.trim() || null;
  const targetCount =
    (skillSlug == null ? 0 : 1) +
    (existingSlug == null ? 0 : 1) +
    (newDatasetName == null ? 0 : 1);
  if (targetCount !== 1) {
    throw badInput(
      "Provide exactly one of skillSlug (attribute to a skill), datasetSlug (existing dataset), or newDatasetName (create one).",
    );
  }
  // Validate skillSlug shape up front (path-traversal guard) — it must form
  // a valid `skill-<slug>` dataset slug. skillEvalDatasetSlug throws on a
  // skill slug that overflows the dataset slug budget; surface as bad input.
  if (skillSlug) {
    try {
      skillEvalDatasetSlug(skillSlug);
    } catch (err) {
      throw badInput(
        `Invalid skillSlug "${skillSlug}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const attributionFallback = input.attributionFallback === true;
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
  if (skillSlug) {
    // Skill attribution: route into the skill's per-skill dataset. ENSURE
    // it exists — a skill that shipped no bundled cases has no dataset yet,
    // so create one (kind:'skill') on demand. An existing skill dataset is
    // a valid flag target (unlike the baseline-suite rejection below).
    datasetSlug = skillEvalDatasetSlug(skillSlug);
    const datasetRow = await loadDatasetRow(tenantId, datasetSlug);
    if (datasetRow) {
      if (datasetRow.archived_at) {
        throw badInput(`Skill dataset ${datasetSlug} is archived.`);
      }
    } else {
      const dctx: DatasetContext = {
        tenantId,
        tenantSlug,
        slug: datasetSlug,
      };
      try {
        await createDatasetInStore(
          dctx,
          { name: `Skill: ${skillSlug}`, kind: "skill" },
          storage,
          store,
        );
      } catch (err) {
        // Tolerate an "already exists" race (a concurrent flag or an
        // install-time seeder created it between the read and the write).
        const message = err instanceof Error ? err.message : String(err);
        if (!/already exists/i.test(message)) throw badInput(message);
      }
    }
  } else if (existingSlug) {
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
  // A skill-attributed case must NOT carry BUNDLED_CASE_TAG (origin:bundled)
  // — buildFlaggedCaseCore never adds it, so the case survives a skill
  // re-sync (the seeder only reconciles bundled cases). A low-confidence
  // INSTALLED-skill fallback attribution is tagged so an audit can
  // quarantine a possible misattribution.
  if (skillSlug && attributionFallback) {
    core.tags = [...core.tags, ATTRIBUTION_FALLBACK_TAG];
  }
  await putEvalDatasetCase(dctx, core, null, storage, store);

  const datasetRow = await loadDatasetRowOrThrow(tenantId, datasetSlug);
  const caseRow = await loadCaseRowOrThrow(String(datasetRow.id), caseId);
  return {
    case: caseRowToGraphql(caseRow),
    dataset: datasetToGraphql(datasetRow),
    completeness: snapshot.completeness,
  };
};

// ---------------------------------------------------------------------------
// flaggedTurnSkillCandidates — attribution suggestions (Skill Tests & Evals U8)
// ---------------------------------------------------------------------------

/**
 * Read-path tenant scoping — mirrors resolveReadTenantId in datasets.ts /
 * index.ts. `ctx.auth.tenantId` is null for Google-federated callers until
 * the Cognito pre-token trigger lands, so fall back to the DB-backed
 * resolver. Returns null when no tenant resolves; the caller fails closed.
 */
async function resolveReadTenantId(
  ctx: GraphQLContext,
): Promise<string | null> {
  return ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
}

interface SkillAttributionCandidate {
  skillSlug: string;
  /** "active" (intersected from the turn's recorded skills) | "installed". */
  source: "active" | "installed";
}

/**
 * Suggest skill-attribution candidates for a flagged turn (U8). Suggestion
 * only — the system NEVER auto-attributes; the dialog (U9) renders these +
 * a "not skill-specific" option and the operator confirms exactly one.
 *
 * Tenant discipline mirrors the mutation: verify the turn belongs to the
 * thread AND the caller's tenant; a cross-tenant/nonexistent thread or a
 * turn that isn't this thread's surfaces as NOT_FOUND (no existence oracle).
 *
 * Logic:
 *   - Read the turn's `context_snapshot.workspace_projection.activeSkills`
 *     (U7) and intersect with the tenant's installed catalog skill slugs —
 *     those are high-confidence `source:"active"`, `fallback:false`.
 *   - If the turn carries NO activeSkills (older turn) OR the intersection
 *     is empty, fall back to the tenant's installed catalog skills as
 *     low-confidence `source:"installed"`, `fallback:true`.
 */
const flaggedTurnSkillCandidates = async (
  _p: unknown,
  args: { tenantId: string; threadId: string; turnId: string },
  ctx: GraphQLContext,
): Promise<{ candidates: SkillAttributionCandidate[]; fallback: boolean }> => {
  const tenantId = await resolveReadTenantId(ctx);
  // Fail closed on a tenant mismatch — same NOT_FOUND outcome a foreign
  // thread id gets, so the read leaks no existence signal.
  if (!tenantId || tenantId !== args.tenantId) {
    throw notFound("Thread not found");
  }

  // The thread must exist under this tenant.
  const [thread] = await db
    .select({ id: threads.id, tenant_id: threads.tenant_id })
    .from(threads)
    .where(eq(threads.id, args.threadId));
  if (!thread || thread.tenant_id !== tenantId) {
    throw notFound("Thread not found");
  }

  // The turn must belong to this thread + tenant.
  const [turn] = await db
    .select({
      id: threadTurns.id,
      tenant_id: threadTurns.tenant_id,
      thread_id: threadTurns.thread_id,
      context_snapshot: threadTurns.context_snapshot,
    })
    .from(threadTurns)
    .where(eq(threadTurns.id, args.turnId));
  if (!turn || turn.thread_id !== thread.id || turn.tenant_id !== tenantId) {
    throw notFound("Turn not found");
  }

  // The tenant's installed catalog skills — the universe attribution maps
  // into (intersected with active skills, or the fallback set itself).
  const installed = await listIndexedSkills(tenantId);
  const installedSlugs = new Set(installed.map((s) => s.slug));

  // The turn's recorded active skill ids (U7). Absent on older turns.
  const snapshot = turn.context_snapshot as Record<string, unknown> | null;
  const projection = (snapshot?.workspace_projection ?? null) as Record<
    string,
    unknown
  > | null;
  const rawActive = projection?.activeSkills;
  const activeSkills = Array.isArray(rawActive)
    ? rawActive.filter((s): s is string => typeof s === "string")
    : [];

  // Intersect active skills down to real catalog skills (drops always-on
  // defaults/built-ins that aren't installed catalog skills). De-dup while
  // preserving the recorded order.
  const seen = new Set<string>();
  const activeCandidates: SkillAttributionCandidate[] = [];
  for (const slug of activeSkills) {
    if (!installedSlugs.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    activeCandidates.push({ skillSlug: slug, source: "active" });
  }

  if (activeCandidates.length > 0) {
    return { candidates: activeCandidates, fallback: false };
  }

  // Fallback (low-confidence): the turn had no usable activeSkills, so
  // suggest from the tenant's currently-installed catalog skills — which
  // may differ from what was active in an old turn. fallback:true signals
  // the dialog to pass attributionFallback through to the mutation.
  const installedCandidates: SkillAttributionCandidate[] = installed
    .filter((s) => isInstalledSkillSlug(s.slug))
    .map((s) => ({ skillSlug: s.slug, source: "installed" }));
  return { candidates: installedCandidates, fallback: true };
};

/**
 * Guard a candidate slug so it can become a `skill-<slug>` dataset slug
 * downstream (the mutation validates the same way). A catalog slug that
 * would overflow the dataset slug budget is dropped from suggestions
 * rather than offered as an un-attributable candidate.
 */
function isInstalledSkillSlug(slug: string): boolean {
  // A skill dataset slug is `skill-<slug>`; offering a candidate the
  // mutation would reject is pointless — and a slug that already looks like
  // a skill dataset slug is not itself an installable catalog skill.
  if (isSkillDatasetSlug(slug)) return false;
  try {
    skillEvalDatasetSlug(slug);
    return true;
  } catch {
    return false;
  }
}

export const flagThreadMutations = {
  flagThreadForEval,
};

export const flagThreadQueries = {
  flaggedTurnSkillCandidates,
};
