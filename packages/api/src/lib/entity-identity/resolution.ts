/**
 * Entity resolution queue (THINK-193 U4).
 *
 * Ambiguous shared identity coalesces into `identity.entity_resolution_cases`
 * keyed by normalized identity signature — one OPEN case per signature per
 * tenant (partial unique index), with item_count tracking repeat sightings.
 *
 * Queue budgets (documented product defaults, tuned for the operator queue
 * staying reviewable rather than exhaustive — a dropped case re-opens on the
 * next ingest of the same signature, so expiry is never data loss):
 *   - MAX_OPEN_CASES_PER_TENANT = 200: at admission time, if the tenant is
 *     at the cap the OLDEST open cases (by updated_at) are expired to make
 *     room. Newest ambiguity is most actionable.
 *   - CASE_EXPIRY_DAYS = 30: open cases untouched for 30 days expire during
 *     the admission sweep. `updated_at` (not created_at) is the clock so a
 *     Defer decision or a repeat sighting resets it.
 *
 * V1 decisions: Link, Create, Defer, Reject (+ guarded Merge in merge.ts).
 * No Split. Every decision appends an entity_resolution_events audit row.
 */

import { and, asc, eq, lt, sql } from "drizzle-orm";
import {
  canonicalEntities,
  entityIdentityClaims,
  entityResolutionCases,
  entityResolutionEvents,
  entitySourceMappings,
} from "@thinkwork/database-pg/schema";
import type { IdentityDbClient } from "./matcher.js";
import {
  applyNormalization,
  hashIdentityValue,
  type IdentityRule,
} from "./normalizers.js";

export const MAX_OPEN_CASES_PER_TENANT = 200;
export const CASE_EXPIRY_DAYS = 30;

export interface ResolutionCaseKeyInput {
  keyKind: string;
  normalizedValue: string;
  ruleSlug?: string;
  ruleVersion?: number;
}

export interface OpenResolutionCaseInput {
  tenantId: string;
  signatureHash: string;
  entityTypeSlug: string;
  displayHint: string | null;
  /** Source-safe candidate summaries — NEVER private content. */
  candidates: Array<Record<string, unknown>>;
  conflictingClaims: Array<Record<string, unknown>>;
  impactSummary?: Record<string, unknown>;
  /**
   * Normalized natural keys carried on the case so a Link/Create decision
   * can seed identity claims and future ingests resolve deterministically.
   * Shared-evidence keys only (tenant-visible by definition).
   */
  pendingKeys?: ResolutionCaseKeyInput[];
}

export interface OpenResolutionCaseResult {
  caseId: string;
  coalesced: boolean;
}

/**
 * Expire stale open cases, then enforce the per-tenant open-case cap by
 * expiring the oldest (least recently touched) beyond the budget. Runs at
 * admission time — no separate sweeper Lambda.
 */
export async function enforceQueueBudgets(
  db: IdentityDbClient,
  tenantId: string,
): Promise<{ expiredStale: number; expiredOverBudget: number }> {
  const staleCutoff = new Date(
    Date.now() - CASE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );
  const staleRows = await db
    .update(entityResolutionCases)
    .set({ status: "expired", updated_at: new Date() })
    .where(
      and(
        eq(entityResolutionCases.tenant_id, tenantId),
        eq(entityResolutionCases.status, "open"),
        lt(entityResolutionCases.updated_at, staleCutoff),
      ),
    )
    .returning({ id: entityResolutionCases.id });

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entityResolutionCases)
    .where(
      and(
        eq(entityResolutionCases.tenant_id, tenantId),
        eq(entityResolutionCases.status, "open"),
      ),
    );
  const openCount = Number(countRow?.count ?? 0);
  let expiredOverBudget = 0;
  if (openCount >= MAX_OPEN_CASES_PER_TENANT) {
    const overflow = openCount - MAX_OPEN_CASES_PER_TENANT + 1;
    const victims = await db
      .select({ id: entityResolutionCases.id })
      .from(entityResolutionCases)
      .where(
        and(
          eq(entityResolutionCases.tenant_id, tenantId),
          eq(entityResolutionCases.status, "open"),
        ),
      )
      .orderBy(asc(entityResolutionCases.updated_at))
      .limit(overflow);
    for (const victim of victims) {
      await db
        .update(entityResolutionCases)
        .set({ status: "expired", updated_at: new Date() })
        .where(eq(entityResolutionCases.id, victim.id));
      expiredOverBudget += 1;
    }
  }
  return { expiredStale: staleRows.length, expiredOverBudget };
}

/**
 * Open a resolution case, or coalesce into the existing open case for the
 * same signature (item_count bump + refreshed candidates/hint).
 */
export async function openOrCoalesceResolutionCase(
  db: IdentityDbClient,
  input: OpenResolutionCaseInput,
): Promise<OpenResolutionCaseResult> {
  const [existing] = await db
    .select({ id: entityResolutionCases.id })
    .from(entityResolutionCases)
    .where(
      and(
        eq(entityResolutionCases.tenant_id, input.tenantId),
        eq(entityResolutionCases.signature_hash, input.signatureHash),
        eq(entityResolutionCases.status, "open"),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(entityResolutionCases)
      .set({
        item_count: sql`${entityResolutionCases.item_count} + 1`,
        candidates: input.candidates,
        conflicting_claims: input.conflictingClaims,
        display_hint: input.displayHint,
        ...(input.impactSummary ? { impact_summary: input.impactSummary } : {}),
        updated_at: new Date(),
      })
      .where(eq(entityResolutionCases.id, existing.id));
    return { caseId: existing.id, coalesced: true };
  }

  await enforceQueueBudgets(db, input.tenantId);

  const [inserted] = await db
    .insert(entityResolutionCases)
    .values({
      tenant_id: input.tenantId,
      signature_hash: input.signatureHash,
      entity_type_slug: input.entityTypeSlug,
      display_hint: input.displayHint,
      candidates: input.candidates,
      conflicting_claims: input.conflictingClaims,
      impact_summary: {
        ...(input.impactSummary ?? {}),
        ...(input.pendingKeys ? { pendingKeys: input.pendingKeys } : {}),
      },
    })
    .onConflictDoNothing()
    .returning({ id: entityResolutionCases.id });

  if (inserted) return { caseId: inserted.id, coalesced: false };

  // Lost a race with a concurrent open — coalesce onto the winner.
  const [winner] = await db
    .select({ id: entityResolutionCases.id })
    .from(entityResolutionCases)
    .where(
      and(
        eq(entityResolutionCases.tenant_id, input.tenantId),
        eq(entityResolutionCases.signature_hash, input.signatureHash),
        eq(entityResolutionCases.status, "open"),
      ),
    )
    .limit(1);
  if (!winner) {
    throw new Error(
      "openOrCoalesceResolutionCase: conflict without an open winner row",
    );
  }
  await db
    .update(entityResolutionCases)
    .set({
      item_count: sql`${entityResolutionCases.item_count} + 1`,
      updated_at: new Date(),
    })
    .where(eq(entityResolutionCases.id, winner.id));
  return { caseId: winner.id, coalesced: true };
}

// ---------------------------------------------------------------------------
// Canonical entity creation + claim seeding (shared by decisions + pipeline)
// ---------------------------------------------------------------------------

export interface CreateCanonicalEntityInput {
  tenantId: string;
  entityTypeSlug: string;
  displayName: string;
  createdBy: "rule" | "operator" | "backfill";
  sourceKeys?: Array<{
    sourceSystem: string;
    namespace?: string;
    externalId: string;
  }>;
  identityKeys?: ResolutionCaseKeyInput[];
  visibility?: "tenant" | "private";
}

export async function createCanonicalEntity(
  db: IdentityDbClient,
  input: CreateCanonicalEntityInput,
): Promise<{ canonicalEntityId: string }> {
  const [entity] = await db
    .insert(canonicalEntities)
    .values({
      tenant_id: input.tenantId,
      entity_type_slug: input.entityTypeSlug,
      display_name: input.displayName,
      normalized_name: applyNormalization("name", input.displayName),
    })
    .returning({ id: canonicalEntities.id });
  const canonicalEntityId = entity!.id;
  await attachIdentityEvidence(db, {
    tenantId: input.tenantId,
    canonicalEntityId,
    createdBy: input.createdBy,
    sourceKeys: input.sourceKeys,
    identityKeys: input.identityKeys,
    visibility: input.visibility ?? "tenant",
  });
  return { canonicalEntityId };
}

/** Idempotently attach source mappings + identity claims to a canonical id. */
export async function attachIdentityEvidence(
  db: IdentityDbClient,
  args: {
    tenantId: string;
    canonicalEntityId: string;
    createdBy: "rule" | "operator" | "backfill";
    sourceKeys?: Array<{
      sourceSystem: string;
      namespace?: string;
      externalId: string;
    }>;
    identityKeys?: ResolutionCaseKeyInput[];
    visibility?: "tenant" | "private";
  },
): Promise<void> {
  for (const key of args.sourceKeys ?? []) {
    await db
      .insert(entitySourceMappings)
      .values({
        tenant_id: args.tenantId,
        canonical_entity_id: args.canonicalEntityId,
        source_system: key.sourceSystem,
        namespace: key.namespace ?? "",
        external_id: key.externalId,
        visibility: args.visibility ?? "tenant",
        created_by: args.createdBy,
      })
      .onConflictDoNothing();
  }
  for (const key of args.identityKeys ?? []) {
    const existing = await db
      .select({ id: entityIdentityClaims.id })
      .from(entityIdentityClaims)
      .where(
        and(
          eq(entityIdentityClaims.tenant_id, args.tenantId),
          eq(entityIdentityClaims.canonical_entity_id, args.canonicalEntityId),
          eq(entityIdentityClaims.key_kind, key.keyKind),
          eq(
            entityIdentityClaims.value_hash,
            hashIdentityValue(key.normalizedValue),
          ),
          eq(entityIdentityClaims.state, "active"),
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(entityIdentityClaims).values({
      tenant_id: args.tenantId,
      canonical_entity_id: args.canonicalEntityId,
      rule_slug: key.ruleSlug ?? "operator-decision",
      rule_version: key.ruleVersion ?? 1,
      key_kind: key.keyKind,
      normalized_value: key.normalizedValue,
      value_hash: hashIdentityValue(key.normalizedValue),
      visibility: args.visibility ?? "tenant",
    });
  }
}

// ---------------------------------------------------------------------------
// Decision application
// ---------------------------------------------------------------------------

export type ResolutionDecisionInput =
  | { decision: "link"; canonicalEntityId: string }
  | { decision: "create"; displayName?: string }
  | { decision: "defer" }
  | { decision: "reject" };

export interface ApplyResolutionDecisionArgs {
  tenantId: string;
  caseId: string;
  actorUserId: string | null;
  input: ResolutionDecisionInput;
}

export interface ApplyResolutionDecisionResult {
  caseId: string;
  status: "open" | "resolved";
  decision: "link" | "create" | "defer" | "reject";
  canonicalEntityId: string | null;
}

function pendingKeysFromCase(impactSummary: unknown): ResolutionCaseKeyInput[] {
  const summary = impactSummary as Record<string, unknown> | null;
  const raw = summary?.pendingKeys;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is ResolutionCaseKeyInput =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).keyKind === "string" &&
      typeof (entry as Record<string, unknown>).normalizedValue === "string",
  );
}

/**
 * Apply a Link / Create / Defer / Reject decision to an open case.
 * Link/Create seed identity claims from the case's pending keys so the next
 * ingest of the same signature resolves deterministically. Defer keeps the
 * case open (updated_at reset — snoozes the expiry clock). All decisions
 * append an audit event.
 */
export async function applyResolutionDecision(
  db: IdentityDbClient,
  args: ApplyResolutionDecisionArgs,
): Promise<ApplyResolutionDecisionResult> {
  const [caseRow] = await db
    .select()
    .from(entityResolutionCases)
    .where(
      and(
        eq(entityResolutionCases.id, args.caseId),
        eq(entityResolutionCases.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!caseRow) throw new Error("Resolution case not found");
  if (caseRow.status !== "open") {
    throw new Error(`Resolution case is ${caseRow.status}, not open`);
  }

  const pendingKeys = pendingKeysFromCase(caseRow.impact_summary);
  let canonicalEntityId: string | null = null;
  let status: "open" | "resolved" = "resolved";

  switch (args.input.decision) {
    case "link": {
      const [target] = await db
        .select({ id: canonicalEntities.id, status: canonicalEntities.status })
        .from(canonicalEntities)
        .where(
          and(
            eq(canonicalEntities.id, args.input.canonicalEntityId),
            eq(canonicalEntities.tenant_id, args.tenantId),
          ),
        )
        .limit(1);
      if (!target) throw new Error("Link target canonical entity not found");
      if (target.status !== "active") {
        throw new Error(`Link target is ${target.status}, not active`);
      }
      canonicalEntityId = target.id;
      await attachIdentityEvidence(db, {
        tenantId: args.tenantId,
        canonicalEntityId,
        createdBy: "operator",
        identityKeys: pendingKeys,
      });
      break;
    }
    case "create": {
      const displayName =
        args.input.displayName?.trim() ||
        caseRow.display_hint ||
        "Unnamed entity";
      const created = await createCanonicalEntity(db, {
        tenantId: args.tenantId,
        entityTypeSlug: caseRow.entity_type_slug,
        displayName,
        createdBy: "operator",
        identityKeys: pendingKeys,
      });
      canonicalEntityId = created.canonicalEntityId;
      break;
    }
    case "defer":
      status = "open";
      break;
    case "reject":
      break;
  }

  await db
    .update(entityResolutionCases)
    .set({
      status,
      decision: args.input.decision,
      decided_by_user_id: args.actorUserId,
      resolved_canonical_entity_id: canonicalEntityId,
      decided_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(entityResolutionCases.id, args.caseId));

  await appendResolutionEvent(db, {
    tenantId: args.tenantId,
    caseId: args.caseId,
    canonicalEntityId,
    eventType: args.input.decision,
    actorUserId: args.actorUserId,
    payload: { pendingKeyCount: pendingKeys.length },
  });

  return {
    caseId: args.caseId,
    status,
    decision: args.input.decision,
    canonicalEntityId,
  };
}

export async function appendResolutionEvent(
  db: IdentityDbClient,
  args: {
    tenantId: string;
    caseId: string | null;
    canonicalEntityId: string | null;
    eventType: "create" | "link" | "defer" | "reject" | "merge";
    actorUserId: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(entityResolutionEvents).values({
    tenant_id: args.tenantId,
    case_id: args.caseId,
    canonical_entity_id: args.canonicalEntityId,
    event_type: args.eventType,
    actor_user_id: args.actorUserId,
    payload: args.payload ?? {},
  });
}
