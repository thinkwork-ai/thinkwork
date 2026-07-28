/**
 * Routine promotion control plane (THINK-280 U6 — R13, R14, R15, R18;
 * A1, A2, A3; F2; AE6, AE7).
 *
 * A Routine proposal is an IMMUTABLE, NON-EXECUTABLE bundle: normalized
 * Python, typed input/output, minimized + SANITIZED fixtures, invariants,
 * exact capability dependency references ({twcap, contractHash,
 * definitionVersionId}), minimum grants, principal spec, effect/data/cost
 * summary, and source broker/turn evidence. Creation and edits touch
 * NEITHER Git NOR execution — that is the whole point of the proposal:
 * the operator reviews a fixed content-addressed artifact, and approval
 * binds to exactly one fingerprint.
 *
 * Immutability + exact approval:
 *   - createRoutineProposal computes payload_fingerprint =
 *     canonicalSha256Hex(bundle) over the whole immutable bundle and
 *     supersedes any prior open proposal for the same target. Any edit is
 *     a NEW row with a NEW fingerprint; the prior fingerprint can never be
 *     approved again (AE6).
 *   - approveRoutineProposal consumes EXACTLY one fingerprint through a
 *     conditional UPDATE ... WHERE payload_fingerprint = <reviewed> AND
 *     status = 'submitted' (the routine-approval-bridge idempotent-consume
 *     pattern). A stale fingerprint or an already-decided row matches 0
 *     rows and fails closed — no commit, no activation.
 *   - Repair auto-publish (approval_mode='repair') is the SOLE machine-
 *     approved exception (R14/AE6): a semantic diff proving dependencies,
 *     principals, effects, and budgets are unchanged-or-narrower may
 *     publish without an operator, recorded with the structured-field diff
 *     + green fixture evidence. Every EXPANSION creates a fresh proposal.
 *
 * The domain semantics live HERE (db-only, injectable promoter seam); the
 * GraphQL resolvers are thin authz + AWSJSON tolerance wrappers, matching
 * lib/capabilities/research.ts.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "@thinkwork/database-pg";
import {
  capabilityDefinitionVersions,
  capabilityRoutineProposals,
  inboxItems,
} from "@thinkwork/database-pg/schema";
import {
  CanonicalizationError,
  canonicalSha256Hex,
  type CapabilityDescriptor,
} from "@thinkwork/capability-contracts";
import {
  createRoutineOutputRedactor,
  scrubKnownTokenShapes,
} from "@thinkwork/lambda/routine-output-redactor";

export type Db = ReturnType<typeof getDb>;

export type CapabilityRoutineProposalRow =
  typeof capabilityRoutineProposals.$inferSelect;

/** Generic actor provenance (agent/user/system) for proposal rows. */
export interface RoutineProposalActor {
  type: "user" | "agent" | "system";
  id?: string | null;
}

/** One exact capability dependency reference the Routine consumes. */
export interface RoutineDependencyRef {
  /** twcap operation reference string. */
  twcap: string;
  /** Signed operation contract hash the dependency was proposed against. */
  contractHash: string;
  /** The admitted definition version this dependency resolves to. */
  definitionVersionId: string;
}

export interface RoutineProposalPrincipalSpec {
  /** requester | agent_owner | service — exactly one explicit mode (R6). */
  mode: "requester" | "agent_owner" | "service";
  /** Required for 'service' mode; the pinned tenant service principal. */
  servicePrincipalId?: string | null;
}

export interface RoutineProposalFixture {
  path: string;
  input: unknown;
  expected: unknown;
  /** exact (default) | shape — mirrors routine-exec-git fixture semantics. */
  mode?: "exact" | "shape";
  invariantPaths?: string[];
}

export interface RoutineEffectSummary {
  /** read | write | external_effect etc. — the maximal declared effect. */
  effect: string;
  dataClasses?: string[];
  costClass?: string;
  /** Free-form per-dependency budget envelope (page sizes, call caps, …). */
  budgets?: Record<string, unknown>;
}

/** Source broker / turn evidence backing the digest that produced this. */
export interface RoutineProposalEvidence {
  brokerSessionId?: string | null;
  brokerCallIds?: string[];
  threadTurnId?: string | null;
  routineExecutionId?: string | null;
}

/**
 * The IMMUTABLE proposal bundle. `canonicalSha256Hex` over exactly this
 * object is the fingerprint the operator approves. Sanitized before it is
 * ever written or fingerprinted.
 */
export interface RoutineProposalBundle {
  /** Repo-safe routine slug — routines/<slug>/main.py. */
  slug: string;
  /** Normalized Python module (def run(input) -> dict). */
  code: string;
  inputSchema: unknown;
  outputSchema: unknown;
  fixtures: RoutineProposalFixture[];
  invariants: unknown[];
  dependencies: RoutineDependencyRef[];
  /** Minimum grants requested per operation (upper-bound, never widened). */
  minimumGrants: unknown;
  principal: RoutineProposalPrincipalSpec;
  effectSummary: RoutineEffectSummary;
  evidence: RoutineProposalEvidence;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ---------------------------------------------------------------------------
// Normalization + fingerprint
// ---------------------------------------------------------------------------

/**
 * Deterministic Python normalization so semantically-identical source
 * fingerprints identically: CRLF/CR → LF, trailing whitespace stripped,
 * exactly one trailing newline. Never rewrites program logic.
 */
export function normalizePython(code: string): string {
  const lines = code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));
  // Drop trailing blank lines, then re-add a single newline.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

/** Recursively map every string leaf of a JSON value through `fn`. */
function mapStringLeaves(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStringLeaves(v, fn));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = mapStringLeaves(v, fn);
    }
    return out;
  }
  return value;
}

/** True if any string leaf still matches a known secret token shape. */
function hasResidualSecretShape(value: unknown): boolean {
  let residual = false;
  mapStringLeaves(value, (s) => {
    if (scrubKnownTokenShapes(s) !== s) residual = true;
    return s;
  });
  return residual;
}

// ---------------------------------------------------------------------------
// createRoutineProposal
// ---------------------------------------------------------------------------

export interface CreateRoutineProposalInput {
  tenantId: string;
  /** Existing Routine when updating; omit for a new Routine. */
  routineId?: string | null;
  /** Immutable bundle (code is normalized + fixtures sanitized here). */
  bundle: RoutineProposalBundle;
  /**
   * The broker's known secret sources (resolved credential material /
   * token bag). Fixtures are exact-redacted against these BEFORE the row
   * is written. Never persisted.
   */
  secretSources?: readonly unknown[];
  /** Persist as 'draft' (default) or 'submitted' (ready for review). */
  status?: "draft" | "submitted";
  actor: RoutineProposalActor;
}

export interface CreateRoutineProposalResult {
  outcome: "applied" | "rejected";
  reason?: string;
  proposal?: CapabilityRoutineProposalRow;
}

/**
 * Persist an immutable, non-executable Routine proposal. Sanitizes
 * fixtures, computes the fingerprint, validates dependencies against the
 * tenant's admitted definition versions, and supersedes any prior open
 * proposal for the same target (so the prior fingerprint can never be
 * approved — AE6). Touches neither Git nor execution.
 */
export async function createRoutineProposal(
  db: Db,
  input: CreateRoutineProposalInput,
): Promise<CreateRoutineProposalResult> {
  const reasons: string[] = [];
  const bundle = input.bundle;

  if (!bundle || typeof bundle !== "object") {
    return { outcome: "rejected", reason: "bundle: must be an object" };
  }
  if (typeof bundle.slug !== "string" || !SLUG_RE.test(bundle.slug)) {
    reasons.push("slug: must be a lowercase repo-safe slug");
  }
  if (typeof bundle.code !== "string" || bundle.code.trim() === "") {
    reasons.push("code: non-empty Python source is required");
  }
  if (!Array.isArray(bundle.fixtures) || bundle.fixtures.length === 0) {
    // R9 parity: no fixture, no promotion.
    reasons.push("fixtures: at least one fixture is required");
  }
  if (!Array.isArray(bundle.dependencies)) {
    reasons.push("dependencies: must be an array");
  }
  if (
    !bundle.principal ||
    !["requester", "agent_owner", "service"].includes(bundle.principal.mode)
  ) {
    reasons.push("principal.mode: must be requester | agent_owner | service");
  }
  if (reasons.length > 0) {
    return { outcome: "rejected", reason: reasons.join("; ") };
  }

  // ---- Fixture sanitization (BEFORE persistence + fingerprint) -----------
  // Exact-redact against the broker's declared secret sources, then treat
  // any RESIDUAL known-token-shape as an undeclared leak → fail closed.
  const redactor = createRoutineOutputRedactor(input.secretSources ?? []);
  const sanitizedFixtures = bundle.fixtures.map((fixture) => ({
    ...fixture,
    input: mapStringLeaves(fixture.input, (s) => exactRedact(redactor, s)),
    expected: mapStringLeaves(fixture.expected, (s) =>
      exactRedact(redactor, s),
    ),
  }));
  if (
    hasResidualSecretShape(sanitizedFixtures.map((f) => f.input)) ||
    hasResidualSecretShape(sanitizedFixtures.map((f) => f.expected))
  ) {
    return {
      outcome: "rejected",
      reason:
        "unsanitized_fixture: a fixture contains an undeclared secret-shaped " +
        "token — declare the credential source before proposing",
    };
  }

  // ---- Dependency validation against admitted versions -------------------
  const depIds = Array.from(
    new Set(bundle.dependencies.map((d) => d.definitionVersionId)),
  );
  if (depIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return {
      outcome: "rejected",
      reason: "dependencies: every dependency needs a definitionVersionId",
    };
  }
  if (depIds.length > 0) {
    const versionRows = (await db
      .select()
      .from(capabilityDefinitionVersions)
      .where(inArray(capabilityDefinitionVersions.id, depIds))) as Array<
      typeof capabilityDefinitionVersions.$inferSelect
    >;
    const admitted = new Map(
      versionRows
        .filter((row) => row.lifecycle === "admitted")
        .map((row) => [row.id, row]),
    );
    for (const dep of bundle.dependencies) {
      const row = admitted.get(dep.definitionVersionId);
      if (!row) {
        // Dependency not in the originating manifest / not admitted.
        return {
          outcome: "rejected",
          reason: `dependency_not_admitted: ${dep.definitionVersionId} is not an admitted capability version`,
        };
      }
      const hashes =
        row.contract_hashes_json && typeof row.contract_hashes_json === "object"
          ? (row.contract_hashes_json as Record<string, unknown>)
          : {};
      if (!Object.values(hashes).includes(dep.contractHash)) {
        return {
          outcome: "rejected",
          reason: `dependency_contract_mismatch: ${dep.twcap} contract hash is not part of ${dep.definitionVersionId}`,
        };
      }
    }
  }

  // ---- Build the immutable, fingerprinted bundle -------------------------
  const immutable: RoutineProposalBundle = {
    slug: bundle.slug,
    code: normalizePython(bundle.code),
    inputSchema: bundle.inputSchema ?? null,
    outputSchema: bundle.outputSchema ?? null,
    fixtures: sanitizedFixtures,
    invariants: Array.isArray(bundle.invariants) ? bundle.invariants : [],
    dependencies: bundle.dependencies,
    minimumGrants: bundle.minimumGrants ?? null,
    principal: {
      mode: bundle.principal.mode,
      servicePrincipalId: bundle.principal.servicePrincipalId ?? null,
    },
    effectSummary: bundle.effectSummary ?? { effect: "read" },
    evidence: {
      brokerSessionId: bundle.evidence?.brokerSessionId ?? null,
      brokerCallIds: bundle.evidence?.brokerCallIds ?? [],
      threadTurnId: bundle.evidence?.threadTurnId ?? null,
      routineExecutionId: bundle.evidence?.routineExecutionId ?? null,
    },
  };

  let payloadFingerprint: string;
  try {
    payloadFingerprint = canonicalSha256Hex(immutable);
  } catch (err) {
    return {
      outcome: "rejected",
      reason:
        err instanceof CanonicalizationError
          ? `bundle: not canonicalizable (${err.message})`
          : "bundle: not canonicalizable",
    };
  }

  // ---- Supersede prior open proposals for the same target (AE6) ----------
  // Any edit is a NEW row; prior draft/submitted proposals for the same
  // routine (or, for a new routine, the same slug) become 'superseded' so
  // their fingerprints can never be approved.
  const priorOpen = (await db
    .select()
    .from(capabilityRoutineProposals)
    .where(
      eq(capabilityRoutineProposals.tenant_id, input.tenantId),
    )) as CapabilityRoutineProposalRow[];
  const supersedeIds = priorOpen
    .filter(
      (row) =>
        (row.status === "draft" || row.status === "submitted") &&
        (input.routineId
          ? row.routine_id === input.routineId
          : row.routine_id == null && bundleSlugOf(row) === bundle.slug),
    )
    .map((row) => row.id);
  if (supersedeIds.length > 0) {
    await db
      .update(capabilityRoutineProposals)
      .set({ status: "superseded" })
      .where(inArray(capabilityRoutineProposals.id, supersedeIds));
  }

  const [proposal] = (await db
    .insert(capabilityRoutineProposals)
    .values({
      tenant_id: input.tenantId,
      routine_id: input.routineId ?? null,
      payload_json: immutable,
      payload_fingerprint: payloadFingerprint,
      evidence_refs_json: immutable.evidence as unknown as Record<
        string,
        unknown
      >,
      status: input.status ?? "draft",
      created_by_actor_type: input.actor.type,
      created_by_actor_id: input.actor.id ?? null,
    })
    .returning()) as CapabilityRoutineProposalRow[];

  return { outcome: "applied", proposal: proposal! };
}

function exactRedact(
  redactor: ReturnType<typeof createRoutineOutputRedactor>,
  s: string,
): string {
  let out = s;
  for (const secret of redactor.exactValues) {
    if (secret) out = out.split(secret).join("<redacted>");
  }
  return out;
}

/** Slug embedded in a stored proposal's bundle (best-effort). */
function bundleSlugOf(row: CapabilityRoutineProposalRow): string | null {
  const payload = row.payload_json as { slug?: unknown } | null;
  return payload && typeof payload.slug === "string" ? payload.slug : null;
}

// ---------------------------------------------------------------------------
// Promotion seam
// ---------------------------------------------------------------------------

export interface RoutinePromotionResult {
  outcome: "promoted" | "validation_failed" | "commit_conflict" | "error";
  commitSha?: string;
  validatedSha?: string | null;
  hermetic?: {
    status: "green" | "red";
    fixtures: Array<{ path: string; passed: boolean; detail?: string }>;
  };
  readiness?: { ready: boolean; reasons?: string[] };
  reason?: string;
}

/**
 * The single Routine-bundle publisher: commits the exact bundle with the
 * expected-head lock, fetches the commit into the S3/code cache, runs a
 * hermetic fixture gate against a fixture adapter registry, and promotes a
 * hermetic-green SHA with ready dependencies to `validated_sha`. There is
 * NO second Routine publisher — production wires this to
 * `@thinkwork/lambda` routine-repo-tools + routine-exec-git; tests inject
 * a fake.
 */
export interface RoutineProposalPromoter {
  promote(input: {
    proposal: CapabilityRoutineProposalRow;
    bundle: RoutineProposalBundle;
  }): Promise<RoutinePromotionResult>;
}

// ---------------------------------------------------------------------------
// approveRoutineProposal (operator, exact single-use)
// ---------------------------------------------------------------------------

export interface ApproveRoutineProposalInput {
  tenantId: string;
  proposalId: string;
  /** The exact fingerprint the operator reviewed. */
  reviewedFingerprint: string;
  /** Deciding admin user id (operator approval is never machine-approved). */
  adminUserId: string;
}

export interface ApproveRoutineProposalResult {
  outcome: "applied" | "rejected";
  reason?: string;
  proposal?: CapabilityRoutineProposalRow;
  promotion?: RoutinePromotionResult;
}

export async function approveRoutineProposal(
  db: Db,
  input: ApproveRoutineProposalInput,
  deps: { promoter: RoutineProposalPromoter; now?: () => Date },
): Promise<ApproveRoutineProposalResult> {
  const now = deps.now ?? (() => new Date());

  // Read the target for the inbox linkage + bundle (not authoritative for
  // the consume — the conditional UPDATE below is).
  const [current] = (await db
    .select()
    .from(capabilityRoutineProposals)
    .where(eq(capabilityRoutineProposals.id, input.proposalId))
    .limit(1)) as CapabilityRoutineProposalRow[];
  if (!current || current.tenant_id !== input.tenantId) {
    return { outcome: "rejected", reason: "proposal_not_found" };
  }

  // Inbox linkage — records the human decision this approval belongs to.
  const [inboxRow] = (await db
    .insert(inboxItems)
    .values({
      tenant_id: input.tenantId,
      type: "routine_promotion_approval",
      status: "approved",
      title: `Routine promotion approved: ${bundleSlugOf(current) ?? current.id}`,
      description: `Operator approved fingerprint ${input.reviewedFingerprint.slice(0, 12)} for promotion.`,
      entity_type: "capability_routine_proposal",
      entity_id: current.id,
      decided_by: input.adminUserId,
      decided_at: now(),
      config: {
        proposalId: current.id,
        reviewedFingerprint: input.reviewedFingerprint,
      },
    })
    .returning({ id: inboxItems.id })) as Array<{ id: string }>;

  // EXACT single-use consume: bind approval to one fingerprint. A stale
  // fingerprint (post-review edit → new row / superseded status) or an
  // already-decided row matches 0 rows and fails closed — no commit.
  const consumed = (await db
    .update(capabilityRoutineProposals)
    .set({
      status: "approved",
      approval_mode: "operator",
      inbox_item_id: inboxRow?.id ?? null,
      decided_at: now(),
      decided_by_user_id: input.adminUserId,
    })
    .where(
      and(
        eq(capabilityRoutineProposals.id, input.proposalId),
        eq(
          capabilityRoutineProposals.payload_fingerprint,
          input.reviewedFingerprint,
        ),
        eq(capabilityRoutineProposals.status, "submitted"),
      ),
    )
    .returning()) as CapabilityRoutineProposalRow[];

  if (consumed.length === 0) {
    return {
      outcome: "rejected",
      reason: "stale_or_decided_fingerprint",
    };
  }
  const approved = consumed[0];

  // Promote: commit + hermetic validation. A failure leaves the proposal
  // 'approved' (a reviewable candidate) but never 'promoted'.
  const promotion = await deps.promoter.promote({
    proposal: approved,
    bundle: approved.payload_json as RoutineProposalBundle,
  });

  await recordPromotionOutcome(db, approved.id, promotion, "operator", now);

  return {
    outcome: "applied",
    proposal: {
      ...approved,
      status: promotion.outcome === "promoted" ? "promoted" : "approved",
      promoted_commit_sha:
        promotion.outcome === "promoted" ? (promotion.commitSha ?? null) : null,
    },
    promotion,
  };
}

async function recordPromotionOutcome(
  db: Db,
  proposalId: string,
  promotion: RoutinePromotionResult,
  mode: "operator" | "repair",
  now: () => Date,
): Promise<void> {
  const evidence: Record<string, unknown> = {
    approvalMode: mode,
    promotionOutcome: promotion.outcome,
    ...(promotion.commitSha ? { commitSha: promotion.commitSha } : {}),
    ...(promotion.validatedSha ? { validatedSha: promotion.validatedSha } : {}),
    ...(promotion.hermetic ? { hermetic: promotion.hermetic } : {}),
    ...(promotion.readiness ? { readiness: promotion.readiness } : {}),
    ...(promotion.reason ? { reason: promotion.reason } : {}),
  };
  if (promotion.outcome === "promoted") {
    await db
      .update(capabilityRoutineProposals)
      .set({
        status: "promoted",
        promoted_commit_sha: promotion.commitSha ?? null,
        approval_evidence_json: evidence,
        decided_at: now(),
      })
      .where(eq(capabilityRoutineProposals.id, proposalId));
  } else {
    // Keep the approved/decided row but record why promotion did not land.
    await db
      .update(capabilityRoutineProposals)
      .set({ approval_evidence_json: evidence })
      .where(eq(capabilityRoutineProposals.id, proposalId));
  }
}

// ---------------------------------------------------------------------------
// rejectRoutineProposal
// ---------------------------------------------------------------------------

const REJECTABLE_STATUSES = new Set(["draft", "submitted"]);

/**
 * A proposal the operator can still kill: any undecided one, plus an
 * approved-but-NOT-promoted one (e.g. an autonomous approval whose hermetic
 * gate came back red — nothing was activated, so rejection is safe and gives
 * the operator a way to close out a bad machine approval). A promoted
 * proposal is immutable history — its code is live; deactivation happens at
 * the Routine, not here.
 */
function isRejectable(proposal: CapabilityRoutineProposalRow): boolean {
  if (REJECTABLE_STATUSES.has(proposal.status)) return true;
  return proposal.status === "approved" && proposal.promoted_commit_sha == null;
}

export async function rejectRoutineProposal(
  db: Db,
  input: {
    tenantId: string;
    proposalId: string;
    adminUserId: string | null;
    reason?: string | null;
  },
): Promise<{
  outcome: "applied" | "rejected";
  reason?: string;
  proposal?: CapabilityRoutineProposalRow;
}> {
  const [proposal] = (await db
    .select()
    .from(capabilityRoutineProposals)
    .where(eq(capabilityRoutineProposals.id, input.proposalId))
    .limit(1)) as CapabilityRoutineProposalRow[];
  if (!proposal || proposal.tenant_id !== input.tenantId) {
    return { outcome: "rejected", reason: "proposal_not_found" };
  }
  if (!isRejectable(proposal)) {
    return { outcome: "rejected", reason: "proposal_already_decided" };
  }
  const [updated] = (await db
    .update(capabilityRoutineProposals)
    .set({
      status: "rejected",
      decided_at: new Date(),
      decided_by_user_id: input.adminUserId,
    })
    .where(eq(capabilityRoutineProposals.id, proposal.id))
    .returning()) as CapabilityRoutineProposalRow[];
  return { outcome: "applied", proposal: updated ?? proposal };
}

// ---------------------------------------------------------------------------
// Repair auto-publish (R14/AE6 sole exception)
// ---------------------------------------------------------------------------

export interface RepairDiffField {
  field: string;
  verdict: "unchanged" | "narrower" | "expanded";
  detail?: string;
}

export interface RepairDiffResult {
  autoPublish: boolean;
  fields: RepairDiffField[];
  /** Fields that expanded — always forces a fresh operator proposal. */
  expansions: string[];
}

/**
 * Structured semantic diff proving a repaired bundle's dependencies,
 * principals, effects, and budgets are unchanged-or-narrower. Any
 * expansion (a new dependency/principal/effect, or a higher budget)
 * returns autoPublish=false — an expansion ALWAYS creates a fresh
 * operator proposal. This is the only machine-approval gate (R18/AE6).
 */
export function evaluateRepairDiff(
  prior: RoutineProposalBundle,
  next: RoutineProposalBundle,
): RepairDiffResult {
  const fields: RepairDiffField[] = [];
  const expansions: string[] = [];

  // Dependencies: the new set must be a subset of the prior set (by twcap).
  const priorDeps = new Set(prior.dependencies.map((d) => d.twcap));
  const addedDeps = next.dependencies
    .map((d) => d.twcap)
    .filter((t) => !priorDeps.has(t));
  pushField(
    fields,
    expansions,
    "dependencies",
    addedDeps.length === 0,
    addedDeps.length ? `adds ${addedDeps.join(", ")}` : undefined,
    next.dependencies.length < prior.dependencies.length,
  );

  // Principal: mode must not change (a mode change is an expansion).
  pushField(
    fields,
    expansions,
    "principal",
    prior.principal.mode === next.principal.mode &&
      (prior.principal.servicePrincipalId ?? null) ===
        (next.principal.servicePrincipalId ?? null),
    "principal spec changed",
    false,
  );

  // Effect: must not widen. Ordered from least to most powerful.
  const rank = effectRank(next.effectSummary.effect);
  const priorRank = effectRank(prior.effectSummary.effect);
  pushField(
    fields,
    expansions,
    "effect",
    rank <= priorRank,
    `effect ${prior.effectSummary.effect} → ${next.effectSummary.effect}`,
    rank < priorRank,
  );

  // Budgets: every numeric budget must be <= the prior value; a new budget
  // key or a higher value is an expansion.
  const budgetOk = budgetsNotWidened(
    (prior.effectSummary.budgets ?? {}) as Record<string, unknown>,
    (next.effectSummary.budgets ?? {}) as Record<string, unknown>,
  );
  pushField(
    fields,
    expansions,
    "budgets",
    budgetOk.ok,
    budgetOk.detail,
    budgetOk.narrower,
  );

  return {
    autoPublish: expansions.length === 0,
    fields,
    expansions,
  };
}

function pushField(
  fields: RepairDiffField[],
  expansions: string[],
  field: string,
  withinEnvelope: boolean,
  detail: string | undefined,
  narrower: boolean,
): void {
  if (!withinEnvelope) {
    fields.push({ field, verdict: "expanded", detail });
    expansions.push(field);
  } else {
    fields.push({
      field,
      verdict: narrower ? "narrower" : "unchanged",
      detail,
    });
  }
}

// Ordered least→most powerful, matching @thinkwork/capability-contracts
// OPERATION_EFFECTS. A repair may keep or lower the effect, never raise it.
const EFFECT_ORDER = [
  "none",
  "read",
  "create",
  "update",
  "delete",
  "execute",
] as const;

function effectRank(effect: string): number {
  const idx = EFFECT_ORDER.indexOf(effect as (typeof EFFECT_ORDER)[number]);
  // Unknown effects rank highest so an unrecognized effect never counts as
  // a narrowing.
  return idx === -1 ? EFFECT_ORDER.length : idx;
}

function budgetsNotWidened(
  prior: Record<string, unknown>,
  next: Record<string, unknown>,
): { ok: boolean; narrower: boolean; detail?: string } {
  let narrower = false;
  for (const [key, value] of Object.entries(next)) {
    if (typeof value !== "number") continue;
    const priorValue = prior[key];
    if (typeof priorValue !== "number") {
      return { ok: false, narrower: false, detail: `new budget ${key}` };
    }
    if (value > priorValue) {
      return {
        ok: false,
        narrower: false,
        detail: `budget ${key} ${priorValue} → ${value}`,
      };
    }
    if (value < priorValue) narrower = true;
  }
  return { ok: true, narrower };
}

/**
 * Machine-approve + promote a repair proposal. Consumes exactly one
 * fingerprint (same conditional-UPDATE guarantee as the operator path) and
 * stamps approval_mode='repair' with the structured-field diff as evidence.
 * The caller MUST have already verified `evaluateRepairDiff(...).autoPublish`;
 * this fails closed if the recomputed diff shows any expansion.
 */
export async function publishRepairProposal(
  db: Db,
  input: {
    tenantId: string;
    proposalId: string;
    reviewedFingerprint: string;
    priorBundle: RoutineProposalBundle;
  },
  deps: { promoter: RoutineProposalPromoter; now?: () => Date },
): Promise<ApproveRoutineProposalResult> {
  const now = deps.now ?? (() => new Date());
  const [current] = (await db
    .select()
    .from(capabilityRoutineProposals)
    .where(eq(capabilityRoutineProposals.id, input.proposalId))
    .limit(1)) as CapabilityRoutineProposalRow[];
  if (!current || current.tenant_id !== input.tenantId) {
    return { outcome: "rejected", reason: "proposal_not_found" };
  }

  const bundle = current.payload_json as RoutineProposalBundle;
  const diff = evaluateRepairDiff(input.priorBundle, bundle);
  if (!diff.autoPublish) {
    // An expansion never auto-publishes — a fresh operator proposal owns it.
    return {
      outcome: "rejected",
      reason: `repair_expansion_requires_operator: ${diff.expansions.join(", ")}`,
    };
  }

  const consumed = (await db
    .update(capabilityRoutineProposals)
    .set({
      status: "approved",
      approval_mode: "repair",
      decided_at: now(),
      // Machine-approved: decided_by_user_id stays NULL, distinguishing
      // repair-approved from operator-approved in evidence + UI.
      decided_by_user_id: null,
    })
    .where(
      and(
        eq(capabilityRoutineProposals.id, input.proposalId),
        eq(
          capabilityRoutineProposals.payload_fingerprint,
          input.reviewedFingerprint,
        ),
        eq(capabilityRoutineProposals.status, "submitted"),
      ),
    )
    .returning()) as CapabilityRoutineProposalRow[];
  if (consumed.length === 0) {
    return { outcome: "rejected", reason: "stale_or_decided_fingerprint" };
  }
  const approved = consumed[0];

  const promotion = await deps.promoter.promote({
    proposal: approved,
    bundle,
  });

  // Repair evidence: structured-field diff + green fixture run + machine
  // attribution, recorded so the SHA is auditable and never silent.
  const evidence: Record<string, unknown> = {
    approvalMode: "repair",
    promotionOutcome: promotion.outcome,
    diff: diff.fields,
    ...(promotion.commitSha ? { commitSha: promotion.commitSha } : {}),
    ...(promotion.hermetic ? { hermetic: promotion.hermetic } : {}),
    ...(promotion.readiness ? { readiness: promotion.readiness } : {}),
    ...(promotion.reason ? { reason: promotion.reason } : {}),
  };
  if (promotion.outcome === "promoted") {
    await db
      .update(capabilityRoutineProposals)
      .set({
        status: "promoted",
        promoted_commit_sha: promotion.commitSha ?? null,
        approval_evidence_json: evidence,
        decided_at: now(),
      })
      .where(eq(capabilityRoutineProposals.id, approved.id));
  } else {
    await db
      .update(capabilityRoutineProposals)
      .set({ approval_evidence_json: evidence })
      .where(eq(capabilityRoutineProposals.id, approved.id));
  }

  return {
    outcome: "applied",
    proposal: {
      ...approved,
      status: promotion.outcome === "promoted" ? "promoted" : "approved",
    },
    promotion,
  };
}
