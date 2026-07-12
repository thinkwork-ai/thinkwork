/**
 * Structured claim extraction + upsert for external memory sources
 * (THINK-193 U2).
 *
 * `extractCompanyClaims` reduces a normalized company snapshot (see
 * adapters/twenty.ts normalizeCompany) into provider-NEUTRAL claims —
 * `customer.*` predicate slugs that the same contract can later serve for
 * firecrawl/email/kb sources; the only provider-specific piece is the
 * `twenty:` subject_key prefix. `upsertClaimsForEvidence` writes claims and
 * their evidence-support edges in one transaction, superseding stale
 * single-valued claims. `buildClaimProjection` renders ACTIVE claims into
 * deterministic markdown with per-line claim-id provenance comments.
 *
 * NOTE on schema access: the memory_claims / memory_claim_evidence tables
 * land in a parallel change to @thinkwork/database-pg. Tables are accessed
 * via a namespace import so the pure extraction/projection functions stay
 * loadable (and unit-testable) even while the schema exports are pending.
 */

import { and, eq, isNull, ne, inArray } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import * as dbSchema from "@thinkwork/database-pg/schema";

import { computeContentHash } from "./evidence.js";
import type { DbHandle, SharedTargetScope } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One extracted claim, ready for upsert. */
export interface ClaimUpsert {
  subjectKey: string;
  subjectEntityType: string;
  ontologyPredicate: string;
  value: Record<string, unknown>;
  /** sha256 hex of the stable-stringified value (computeContentHash). */
  valueHash: string;
  effectiveFrom: Date | null;
  extractionVersion: string;
}

/** Default extraction recipe version stamped on claims. */
const DEFAULT_EXTRACTION_VERSION = "u2.1";

/**
 * Predicates that hold at most ONE current value per subject: a new value
 * supersedes prior ACTIVE claims. Multi-valued predicates (person /
 * opportunity / note) are only superseded by retraction.
 */
export const SINGLE_VALUED_PREDICATES = [
  "customer.name",
  "customer.domain",
  "customer.employees",
  "customer.annual_recurring_revenue",
  "customer.address",
] as const;

const SINGLE_VALUED = new Set<string>(SINGLE_VALUED_PREDICATES);

/**
 * Thrown when a claim's value_hash matches an existing row whose stored
 * value differs — a sha256 collision. Effectively unreachable; failing loud
 * beats silently merging two distinct facts under one claim.
 */
export class ClaimHashCollisionError extends Error {
  readonly name = "ClaimHashCollisionError";
}

// ---------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseDate(value: unknown): Date | null {
  const raw = stringOrNull(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Assign only when the value is neither null nor undefined. */
function setIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== null && value !== undefined) target[key] = value;
}

/** Deep structural equality via the same stable encoding as the hash. */
function deepEquals(a: unknown, b: unknown): boolean {
  return computeContentHash(a) === computeContentHash(b);
}

// ---------------------------------------------------------------------------
// extractCompanyClaims (pure)
// ---------------------------------------------------------------------------

/**
 * PURE: reduce a normalized company snapshot into claims. Empty values are
 * skipped rather than emitted; relation items without an id are skipped
 * (nothing to key the claim on).
 */
export function extractCompanyClaims(input: {
  snapshot: Record<string, unknown>;
  sourceItemId: string;
  targetScope: SharedTargetScope;
  targetId: string;
  extractionVersion?: string;
}): ClaimUpsert[] {
  const { snapshot } = input;
  const subjectKey = `twenty:company:${input.sourceItemId}`;
  const extractionVersion =
    input.extractionVersion ?? DEFAULT_EXTRACTION_VERSION;
  const companyEffectiveFrom = parseDate(snapshot.updatedAt);
  const claims: ClaimUpsert[] = [];

  const push = (
    ontologyPredicate: string,
    value: Record<string, unknown>,
    effectiveFrom: Date | null = companyEffectiveFrom,
  ): void => {
    if (Object.keys(value).length === 0) return;
    claims.push({
      subjectKey,
      subjectEntityType: "customer",
      ontologyPredicate,
      value,
      valueHash: computeContentHash(value),
      effectiveFrom,
      extractionVersion,
    });
  };

  const name = stringOrNull(snapshot.name);
  if (name) push("customer.name", { text: name });

  const domain = stringOrNull(snapshot.domainName);
  if (domain) push("customer.domain", { url: domain });

  if (typeof snapshot.employees === "number") {
    push("customer.employees", { count: snapshot.employees });
  }

  const arr = recordOrNull(snapshot.annualRecurringRevenue);
  if (arr && typeof arr.amountMicros === "number") {
    const value: Record<string, unknown> = { amountMicros: arr.amountMicros };
    setIfPresent(value, "currencyCode", stringOrNull(arr.currencyCode));
    push("customer.annual_recurring_revenue", value);
  }

  const address = recordOrNull(snapshot.address);
  if (address) {
    // Drop empty-string fields; emit only when at least one field survives.
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(address)) {
      if (value === undefined) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      kept[key] = value;
    }
    push("customer.address", kept);
  }

  const relationEffectiveFrom = (item: Record<string, unknown>): Date | null =>
    parseDate(item.updatedAt) ?? companyEffectiveFrom;

  if (Array.isArray(snapshot.people)) {
    for (const raw of snapshot.people) {
      const person = recordOrNull(raw);
      const externalId = stringOrNull(person?.id);
      if (!person || !externalId) continue;
      const value: Record<string, unknown> = { externalId };
      setIfPresent(value, "name", stringOrNull(person.name));
      setIfPresent(value, "jobTitle", stringOrNull(person.jobTitle));
      setIfPresent(value, "email", stringOrNull(person.email));
      push("customer.person", value, relationEffectiveFrom(person));
    }
  }

  if (Array.isArray(snapshot.opportunities)) {
    for (const raw of snapshot.opportunities) {
      const opp = recordOrNull(raw);
      const externalId = stringOrNull(opp?.id);
      if (!opp || !externalId) continue;
      const value: Record<string, unknown> = { externalId };
      setIfPresent(value, "name", stringOrNull(opp.name));
      setIfPresent(value, "stage", stringOrNull(opp.stage));
      setIfPresent(value, "amount", recordOrNull(opp.amount));
      setIfPresent(value, "closeDate", stringOrNull(opp.closeDate));
      push("customer.opportunity", value, relationEffectiveFrom(opp));
    }
  }

  if (Array.isArray(snapshot.notes)) {
    for (const raw of snapshot.notes) {
      const note = recordOrNull(raw);
      const externalId = stringOrNull(note?.id);
      if (!note || !externalId) continue;
      const value: Record<string, unknown> = { externalId };
      setIfPresent(value, "title", stringOrNull(note.title));
      setIfPresent(value, "body", stringOrNull(note.body));
      push("customer.note", value, relationEffectiveFrom(note));
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// upsertClaimsForEvidence
// ---------------------------------------------------------------------------

/**
 * Transactionally upsert claims and their support edges from one evidence
 * item, then supersede stale single-valued claims:
 *  (a) per claim, find the existing row by fingerprint (tenant, scope,
 *      target, subject_key, predicate, value_hash, effective_from
 *      null-safe); insert when missing (status 'active'); hash matches with
 *      a differing stored value throw ClaimHashCollisionError;
 *  (b) ensure a memory_claim_evidence support edge (claim_id,
 *      evidence_item_id) exists and is active — previously retracted edges
 *      are re-activated;
 *  (c) for SINGLE_VALUED_PREDICATES, mark other ACTIVE claims for the same
 *      (tenant, scope, target, subject_key, predicate) with a different
 *      value_hash as 'superseded'. Multi-valued predicates are left alone.
 */
export async function upsertClaimsForEvidence(
  db: Database,
  args: {
    tenantId: string;
    targetScope: SharedTargetScope;
    targetId: string;
    sourceConfigId: string;
    evidenceItemId: string;
    claims: ClaimUpsert[];
  },
): Promise<{ created: number; supported: number; supersededSupports: number }> {
  const { memoryClaims, memoryClaimEvidence } = dbSchema;
  return await db.transaction(async (tx) => {
    let created = 0;
    let supported = 0;
    let supersededSupports = 0;

    for (const claim of args.claims) {
      const fingerprint = and(
        eq(memoryClaims.tenant_id, args.tenantId),
        eq(memoryClaims.target_scope, args.targetScope),
        eq(memoryClaims.target_id, args.targetId),
        eq(memoryClaims.subject_key, claim.subjectKey),
        eq(memoryClaims.ontology_predicate, claim.ontologyPredicate),
        eq(memoryClaims.value_hash, claim.valueHash),
        claim.effectiveFrom === null
          ? isNull(memoryClaims.effective_from)
          : eq(memoryClaims.effective_from, claim.effectiveFrom),
      );
      const [existing] = await tx
        .select()
        .from(memoryClaims)
        .where(fingerprint)
        .limit(1);

      let claimId: string;
      if (existing) {
        if (!deepEquals(existing.value, claim.value)) {
          throw new ClaimHashCollisionError(
            `value_hash ${claim.valueHash} for ${claim.subjectKey} ${claim.ontologyPredicate} matches claim ${existing.id} but the stored value differs — sha256 collision, refusing to merge`,
          );
        }
        claimId = existing.id;
      } else {
        const [inserted] = await tx
          .insert(memoryClaims)
          .values({
            tenant_id: args.tenantId,
            target_scope: args.targetScope,
            target_id: args.targetId,
            subject_key: claim.subjectKey,
            subject_entity_type: claim.subjectEntityType,
            ontology_predicate: claim.ontologyPredicate,
            value: claim.value,
            value_hash: claim.valueHash,
            effective_from: claim.effectiveFrom,
            effective_to: null,
            status: "active",
            extraction_version: claim.extractionVersion,
          })
          .returning();
        claimId = inserted.id;
        created += 1;
      }

      // (b) Support edge — idempotent; re-activate if previously retracted.
      const insertedEdge = await tx
        .insert(memoryClaimEvidence)
        .values({
          tenant_id: args.tenantId,
          claim_id: claimId,
          evidence_item_id: args.evidenceItemId,
          source_config_id: args.sourceConfigId,
          status: "active",
        })
        .onConflictDoNothing({
          target: [
            memoryClaimEvidence.claim_id,
            memoryClaimEvidence.evidence_item_id,
          ],
        })
        .returning({ id: memoryClaimEvidence.id });
      if (insertedEdge.length === 0) {
        await tx
          .update(memoryClaimEvidence)
          .set({ status: "active", retracted_at: null })
          .where(
            and(
              eq(memoryClaimEvidence.claim_id, claimId),
              eq(memoryClaimEvidence.evidence_item_id, args.evidenceItemId),
              eq(memoryClaimEvidence.status, "retracted"),
            ),
          );
      }
      supported += 1;
    }

    // (c) Supersede stale single-valued claims by predicate.
    const supersededFor = new Set<string>();
    for (const claim of args.claims) {
      if (!SINGLE_VALUED.has(claim.ontologyPredicate)) continue;
      const dedupeKey = `${claim.subjectKey} ${claim.ontologyPredicate} ${claim.valueHash}`;
      if (supersededFor.has(dedupeKey)) continue;
      supersededFor.add(dedupeKey);
      const stale = await tx
        .update(memoryClaims)
        .set({ status: "superseded", updated_at: new Date() })
        .where(
          and(
            eq(memoryClaims.tenant_id, args.tenantId),
            eq(memoryClaims.target_scope, args.targetScope),
            eq(memoryClaims.target_id, args.targetId),
            eq(memoryClaims.subject_key, claim.subjectKey),
            eq(memoryClaims.ontology_predicate, claim.ontologyPredicate),
            eq(memoryClaims.status, "active"),
            ne(memoryClaims.value_hash, claim.valueHash),
          ),
        )
        .returning({ id: memoryClaims.id });
      supersededSupports += stale.length;
    }

    return { created, supported, supersededSupports };
  });
}

// ---------------------------------------------------------------------------
// listActiveClaimsForSubject
// ---------------------------------------------------------------------------

/** Active claims for one subject, stably ordered for projection building. */
export async function listActiveClaimsForSubject(
  db: DbHandle,
  args: {
    tenantId: string;
    targetScope: SharedTargetScope;
    targetId: string;
    subjectKey: string;
  },
): Promise<Array<typeof dbSchema.memoryClaims.$inferSelect>> {
  const { memoryClaims } = dbSchema;
  return await db
    .select()
    .from(memoryClaims)
    .where(
      and(
        eq(memoryClaims.tenant_id, args.tenantId),
        eq(memoryClaims.target_scope, args.targetScope),
        eq(memoryClaims.target_id, args.targetId),
        eq(memoryClaims.subject_key, args.subjectKey),
        eq(memoryClaims.status, "active"),
      ),
    )
    .orderBy(memoryClaims.ontology_predicate, memoryClaims.value_hash);
}

// ---------------------------------------------------------------------------
// deactivateOrphanedClaims
// ---------------------------------------------------------------------------

/**
 * Retraction sweep: after support edges from one evidence item have been
 * retracted, flip claims with ZERO remaining active support edges to
 * status 'retracted'. Corroborated claims (active edges from other
 * evidence) stay active. Returns the number of claims retracted.
 */
export async function deactivateOrphanedClaims(
  db: DbHandle,
  args: { tenantId: string; sourceConfigId: string; evidenceItemId: string },
): Promise<number> {
  const { memoryClaims, memoryClaimEvidence } = dbSchema;
  return await db.transaction(async (tx) => {
    const touched = await tx
      .select({ claimId: memoryClaimEvidence.claim_id })
      .from(memoryClaimEvidence)
      .where(
        and(
          eq(memoryClaimEvidence.tenant_id, args.tenantId),
          eq(memoryClaimEvidence.source_config_id, args.sourceConfigId),
          eq(memoryClaimEvidence.evidence_item_id, args.evidenceItemId),
        ),
      );
    const candidateIds = [...new Set(touched.map((row) => row.claimId))];
    if (candidateIds.length === 0) return 0;

    const stillSupported = await tx
      .select({ claimId: memoryClaimEvidence.claim_id })
      .from(memoryClaimEvidence)
      .where(
        and(
          inArray(memoryClaimEvidence.claim_id, candidateIds),
          eq(memoryClaimEvidence.status, "active"),
        ),
      );
    const supportedSet = new Set(stillSupported.map((row) => row.claimId));
    const orphaned = candidateIds.filter((id) => !supportedSet.has(id));
    if (orphaned.length === 0) return 0;

    const retracted = await tx
      .update(memoryClaims)
      .set({ status: "retracted", updated_at: new Date() })
      .where(
        and(
          inArray(memoryClaims.id, orphaned),
          eq(memoryClaims.status, "active"),
        ),
      )
      .returning({ id: memoryClaims.id });
    return retracted.length;
  });
}

// ---------------------------------------------------------------------------
// buildClaimProjection (pure)
// ---------------------------------------------------------------------------

/** Flatten embedded newlines so interpolated CRM text cannot inject
 * markdown structure (headings/bullets). */
function inlineText(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, " ").trim();
}

function formatMicros(value: Record<string, unknown>): string {
  const micros =
    typeof value.amountMicros === "number" ? value.amountMicros : null;
  const code = stringOrNull(value.currencyCode);
  if (micros === null) return code ?? "";
  const amount = micros / 1_000_000;
  const formatted = Number.isInteger(amount)
    ? amount.toLocaleString("en-US")
    : amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  return code ? `${formatted} ${code}` : formatted;
}

/** Non-empty string fields of the address value, in a fixed field order. */
function formatAddressValue(value: Record<string, unknown>): string {
  const preferredOrder = [
    "addressStreet1",
    "addressStreet2",
    "addressCity",
    "addressState",
    "addressPostcode",
    "addressCountry",
  ];
  const keys = [
    ...preferredOrder.filter((key) => key in value),
    ...Object.keys(value)
      .filter((key) => !preferredOrder.includes(key))
      .sort(),
  ];
  const parts: string[] = [];
  for (const key of keys) {
    const part = stringOrNull(value[key]);
    if (part) parts.push(inlineText(part));
  }
  return parts.join(", ");
}

interface ProjectionClaim {
  id: string;
  ontologyPredicate: string;
  value: Record<string, unknown>;
  effectiveFrom: Date | null;
}

/** Overview render order + labels for single-valued predicates. */
const OVERVIEW_RENDERERS: Array<{
  predicate: string;
  render: (value: Record<string, unknown>) => string;
}> = [
  { predicate: "customer.name", render: (v) => `Name: ${text(v.text)}` },
  { predicate: "customer.domain", render: (v) => `Domain: ${text(v.url)}` },
  {
    predicate: "customer.employees",
    render: (v) =>
      `Employees: ${typeof v.count === "number" ? v.count.toLocaleString("en-US") : text(v.count)}`,
  },
  {
    predicate: "customer.annual_recurring_revenue",
    render: (v) => `Annual recurring revenue: ${formatMicros(v)}`,
  },
  {
    predicate: "customer.address",
    render: (v) => {
      const formatted = formatAddressValue(v);
      return `Address: ${formatted || inlineText(JSON.stringify(v))}`;
    },
  },
];

function text(value: unknown): string {
  const str = stringOrNull(value);
  return str ? inlineText(str) : inlineText(JSON.stringify(value ?? null));
}

const MULTI_VALUED_SECTIONS: Array<{
  predicate: string;
  heading: string;
  render: (value: Record<string, unknown>) => string;
}> = [
  {
    predicate: "customer.person",
    heading: "People",
    render: (v) => {
      const parts = [v.name, v.jobTitle, v.email]
        .map(stringOrNull)
        .filter((part): part is string => part !== null)
        .map(inlineText);
      return parts.join(" — ") || text(v.externalId);
    },
  },
  {
    predicate: "customer.opportunity",
    heading: "Opportunities",
    render: (v) => {
      const amount = recordOrNull(v.amount);
      const closeDate = stringOrNull(v.closeDate);
      const parts = [
        stringOrNull(v.name)
          ? inlineText(v.name as string)
          : text(v.externalId),
        stringOrNull(v.stage) ? inlineText(v.stage as string) : null,
        amount ? formatMicros(amount) : null,
        closeDate ? `closes ${inlineText(closeDate)}` : null,
      ].filter((part): part is string => part !== null && part !== "");
      return parts.join(" — ");
    },
  },
  {
    predicate: "customer.note",
    heading: "Notes",
    render: (v) => {
      const title = stringOrNull(v.title)
        ? inlineText(v.title as string)
        : text(v.externalId);
      const body = stringOrNull(v.body);
      return body ? `**${title}** — ${inlineText(body)}` : `**${title}**`;
    },
  },
];

/**
 * PURE, deterministic markdown from ACTIVE claims: Overview single-valued
 * lines first, then People/Opportunities/Notes sections, then any unknown
 * predicates under Other. Each line carries an HTML comment embedding the
 * claim id so downstream provenance survives the projection. Ordering is
 * stable: by predicate render order, then by value hash within a predicate.
 */
export function buildClaimProjection(
  claims: ProjectionClaim[],
  opts: { title: string; subjectKey: string },
): { markdown: string } {
  const byPredicate = new Map<string, ProjectionClaim[]>();
  for (const claim of claims) {
    const list = byPredicate.get(claim.ontologyPredicate) ?? [];
    list.push(claim);
    byPredicate.set(claim.ontologyPredicate, list);
  }
  const stableSort = (list: ProjectionClaim[]): ProjectionClaim[] =>
    [...list].sort((a, b) =>
      computeContentHash(a.value).localeCompare(computeContentHash(b.value)),
    );
  const line = (claim: ProjectionClaim, rendered: string): string =>
    `- ${rendered} <!-- claim:${claim.id} -->`;

  const sections: Array<{ heading: string; lines: string[] }> = [];

  const overviewLines: string[] = [];
  for (const { predicate, render } of OVERVIEW_RENDERERS) {
    for (const claim of stableSort(byPredicate.get(predicate) ?? [])) {
      overviewLines.push(line(claim, render(claim.value)));
    }
  }
  if (overviewLines.length > 0) {
    sections.push({ heading: "Overview", lines: overviewLines });
  }

  for (const { predicate, heading, render } of MULTI_VALUED_SECTIONS) {
    const list = stableSort(byPredicate.get(predicate) ?? []);
    if (list.length === 0) continue;
    sections.push({
      heading,
      lines: list.map((claim) => line(claim, render(claim.value))),
    });
  }

  const knownPredicates = new Set([
    ...OVERVIEW_RENDERERS.map((r) => r.predicate),
    ...MULTI_VALUED_SECTIONS.map((s) => s.predicate),
  ]);
  const otherLines: string[] = [];
  for (const predicate of [...byPredicate.keys()]
    .filter((p) => !knownPredicates.has(p))
    .sort()) {
    for (const claim of stableSort(byPredicate.get(predicate) ?? [])) {
      otherLines.push(
        line(claim, `${predicate}: ${inlineText(JSON.stringify(claim.value))}`),
      );
    }
  }
  if (otherLines.length > 0) {
    sections.push({ heading: "Other", lines: otherLines });
  }

  const blocks = [
    `# ${inlineText(opts.title)}`,
    `<!-- subject:${inlineText(opts.subjectKey)} -->`,
  ];
  for (const section of sections) {
    blocks.push(`## ${section.heading}\n${section.lines.join("\n")}`);
  }
  return { markdown: blocks.join("\n\n") };
}
