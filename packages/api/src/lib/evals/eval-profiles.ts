/**
 * Eval Profile lifecycle (THINK-107, Eval Profiles U2/U3).
 *
 * A profile is the agent-under-test as a named, reusable configuration:
 * agent model + pinned judge model + trial count. Runs stamp profile_id at
 * insert and pin the resolved snapshot at dispatch (eval-runner), so later
 * profile edits never reinterpret past runs.
 *
 * Invariants owned here:
 *   * Exactly one default per tenant (partial unique index in 0197);
 *     setDefault swaps atomically inside a transaction.
 *   * Archiving the current default is rejected — designate another first.
 *   * A tenant with no default gets one synthesized transactionally on
 *     first resolution (get-or-create), so automatic consumers (skill-eval
 *     gate, scheduled runs) can never fail on a missing default. This also
 *     heals any drift between the 0197 backfill literal and
 *     DEFAULT_EVAL_MODEL_ID.
 *   * model / judge_model validate against the tenant model catalog at
 *     write time (callers pass a validator to avoid an import cycle with
 *     the resolver layer's catalog wiring).
 */

import { and, db, eq, isNull, sql } from "../../graphql/utils.js";
import { evalProfiles } from "@thinkwork/database-pg/schema";
import { DEFAULT_EVAL_MODEL_ID } from "./eval-defaults.js";

export interface EvalProfileRow {
  id: string;
  tenant_id: string;
  name: string;
  model: string;
  judge_model: string | null;
  trials: number;
  is_default: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** The dispatch-time pin written to eval_runs.profile_snapshot. */
export interface EvalProfileSnapshot {
  profileId: string;
  name: string;
  model: string;
  /** Null = the deployed default judge (EVAL_JUDGE_MODEL_ID). */
  judgeModel: string | null;
  trials: number;
  /**
   * Installed-skills fingerprint of the agent the run executes against,
   * captured at dispatch (KTD2 — recorded, not enforced). Sorted
   * `slug@sha` entries; null when capture was unavailable.
   */
  workspaceFingerprint: string[] | null;
}

export class EvalProfileError extends Error {
  readonly code: string;
  constructor(message: string, code = "BAD_USER_INPUT") {
    super(message);
    this.code = code;
  }
}

const DEFAULT_PROFILE_NAME = "Default";
const MAX_TRIALS = 9;

export function assertTrials(trials: number): void {
  if (!Number.isInteger(trials) || trials < 1 || trials > MAX_TRIALS) {
    throw new EvalProfileError(
      `trials must be an integer between 1 and ${MAX_TRIALS}.`,
    );
  }
}

export async function listEvalProfiles(
  tenantId: string,
  includeArchived = false,
): Promise<EvalProfileRow[]> {
  const where = includeArchived
    ? eq(evalProfiles.tenant_id, tenantId)
    : and(
        eq(evalProfiles.tenant_id, tenantId),
        isNull(evalProfiles.archived_at),
      );
  const rows = await db
    .select()
    .from(evalProfiles)
    .where(where)
    .orderBy(evalProfiles.created_at);
  return rows as EvalProfileRow[];
}

export async function getEvalProfile(
  id: string,
): Promise<EvalProfileRow | null> {
  const rows = await db
    .select()
    .from(evalProfiles)
    .where(eq(evalProfiles.id, id))
    .limit(1);
  return (rows[0] as EvalProfileRow | undefined) ?? null;
}

export interface CreateEvalProfileArgs {
  tenantId: string;
  name: string;
  model: string;
  judgeModel?: string | null;
  trials?: number | null;
}

export async function createEvalProfile(
  args: CreateEvalProfileArgs,
): Promise<EvalProfileRow> {
  const name = args.name.trim();
  if (!name) throw new EvalProfileError("Profile name must be non-empty.");
  const trials = args.trials ?? 1;
  assertTrials(trials);
  try {
    const rows = await db
      .insert(evalProfiles)
      .values({
        tenant_id: args.tenantId,
        name,
        model: args.model,
        judge_model: args.judgeModel ?? null,
        trials,
        is_default: false,
      })
      .returning();
    return rows[0] as EvalProfileRow;
  } catch (err) {
    throw translateUniqueViolation(err, name);
  }
}

export interface UpdateEvalProfileArgs {
  name?: string | null;
  model?: string | null;
  judgeModel?: string | null;
  clearJudgeModel?: boolean | null;
  trials?: number | null;
}

export async function updateEvalProfile(
  id: string,
  args: UpdateEvalProfileArgs,
): Promise<EvalProfileRow> {
  const patch: Record<string, unknown> = { updated_at: sql`now()` };
  if (args.name != null) {
    const name = args.name.trim();
    if (!name) throw new EvalProfileError("Profile name must be non-empty.");
    patch.name = name;
  }
  if (args.model != null) patch.model = args.model;
  if (args.clearJudgeModel) patch.judge_model = null;
  else if (args.judgeModel != null) patch.judge_model = args.judgeModel;
  if (args.trials != null) {
    assertTrials(args.trials);
    patch.trials = args.trials;
  }
  try {
    const rows = await db
      .update(evalProfiles)
      .set(patch)
      .where(eq(evalProfiles.id, id))
      .returning();
    const row = rows[0] as EvalProfileRow | undefined;
    if (!row) throw new EvalProfileError("Profile not found.", "NOT_FOUND");
    return row;
  } catch (err) {
    throw translateUniqueViolation(err, String(patch.name ?? ""));
  }
}

export async function duplicateEvalProfile(
  id: string,
  name?: string | null,
): Promise<EvalProfileRow> {
  const source = await getEvalProfile(id);
  if (!source) throw new EvalProfileError("Profile not found.", "NOT_FOUND");
  const targetName = (name ?? `${source.name} copy`).trim();
  if (!targetName)
    throw new EvalProfileError("Profile name must be non-empty.");
  return createEvalProfile({
    tenantId: source.tenant_id,
    name: targetName,
    model: source.model,
    judgeModel: source.judge_model,
    trials: source.trials,
  });
}

export async function archiveEvalProfile(id: string): Promise<EvalProfileRow> {
  const source = await getEvalProfile(id);
  if (!source) throw new EvalProfileError("Profile not found.", "NOT_FOUND");
  if (source.is_default) {
    throw new EvalProfileError(
      "The default profile cannot be archived. Designate another profile as default first.",
    );
  }
  if (source.archived_at) return source; // idempotent
  const rows = await db
    .update(evalProfiles)
    .set({ archived_at: sql`now()`, updated_at: sql`now()` })
    .where(eq(evalProfiles.id, id))
    .returning();
  return rows[0] as EvalProfileRow;
}

export async function setDefaultEvalProfile(
  id: string,
): Promise<EvalProfileRow> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(evalProfiles)
      .where(eq(evalProfiles.id, id))
      .limit(1);
    const target = rows[0] as EvalProfileRow | undefined;
    if (!target) throw new EvalProfileError("Profile not found.", "NOT_FOUND");
    if (target.archived_at) {
      throw new EvalProfileError(
        "An archived profile cannot be the default. Unarchive it first by duplicating.",
      );
    }
    if (target.is_default) return target;
    // Unset-then-set inside one transaction — the partial unique index
    // (uq_eval_profiles_tenant_default) makes a race a constraint error,
    // never two defaults.
    await tx
      .update(evalProfiles)
      .set({ is_default: false, updated_at: sql`now()` })
      .where(
        and(
          eq(evalProfiles.tenant_id, target.tenant_id),
          eq(evalProfiles.is_default, true),
        ),
      );
    const updated = await tx
      .update(evalProfiles)
      .set({ is_default: true, updated_at: sql`now()` })
      .where(eq(evalProfiles.id, id))
      .returning();
    return updated[0] as EvalProfileRow;
  });
}

/**
 * Resolve the tenant's default profile, synthesizing one when absent
 * (KTD10 get-or-create). Safe under concurrency: the partial unique index
 * turns a double-create race into a retry-read.
 */
export async function getOrCreateDefaultEvalProfile(
  tenantId: string,
): Promise<EvalProfileRow> {
  const existing = await db
    .select()
    .from(evalProfiles)
    .where(
      and(
        eq(evalProfiles.tenant_id, tenantId),
        eq(evalProfiles.is_default, true),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0] as EvalProfileRow;
  try {
    const rows = await db
      .insert(evalProfiles)
      .values({
        tenant_id: tenantId,
        name: DEFAULT_PROFILE_NAME,
        model: DEFAULT_EVAL_MODEL_ID,
        judge_model: null,
        trials: 1,
        is_default: true,
      })
      .returning();
    return rows[0] as EvalProfileRow;
  } catch {
    // Lost a create race (default-partial-unique or tenant+name unique) —
    // the winner's row is the default; read it back.
    const raced = await db
      .select()
      .from(evalProfiles)
      .where(
        and(
          eq(evalProfiles.tenant_id, tenantId),
          eq(evalProfiles.is_default, true),
        ),
      )
      .limit(1);
    if (raced[0]) return raced[0] as EvalProfileRow;
    throw new EvalProfileError(
      "Failed to resolve a default eval profile for the tenant.",
      "INTERNAL",
    );
  }
}

/**
 * Resolve the profile a run executes against: explicit profileId →
 * tenant default (get-or-create). Rejects archived and cross-tenant
 * profiles.
 */
export async function resolveEvalProfileForRun(
  tenantId: string,
  profileId?: string | null,
): Promise<EvalProfileRow> {
  if (!profileId) return getOrCreateDefaultEvalProfile(tenantId);
  const profile = await getEvalProfile(profileId);
  if (!profile || profile.tenant_id !== tenantId) {
    throw new EvalProfileError("Profile not found.", "NOT_FOUND");
  }
  if (profile.archived_at) {
    throw new EvalProfileError(
      "An archived profile cannot be used for new runs.",
    );
  }
  return profile;
}

function translateUniqueViolation(err: unknown, name: string): unknown {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("uq_eval_profiles_tenant_name")) {
    return new EvalProfileError(
      `A profile named "${name}" already exists for this tenant.`,
    );
  }
  return err;
}
