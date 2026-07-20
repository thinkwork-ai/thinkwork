import { describe, expect, it } from "vitest";
import {
  entityResolutionCases,
  entityResolutionEvents,
  entitySourceMappings,
  mappingCandidateSets,
  mappingRejections,
} from "@thinkwork/database-pg/schema";
import { createFakeIdentityDb } from "./fake-db.test-helper.js";
import { hashIdentityValue } from "./normalizers.js";
import {
  authorEntitySourceMapping,
  confirmMapping,
  declineCandidates,
  declineCaseSignature,
  deriveCandidateId,
  mappingCaveat,
  proposeMappingCandidates,
  rankMappingCandidates,
  recordCandidateSelection,
  resolveEntities,
  revokeEntitySourceMapping,
  validateCandidateConfirmation,
  DECLINED_CANDIDATE_MARKER,
  DEFAULT_RESOLVE_PAGE_SIZE,
  type CandidateSetRow,
  type EntityRef,
  type MappingCandidate,
} from "./routing.js";

const TENANT = "tenant-1";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("mappingCaveat", () => {
  it("maps created_by to the provenance caveat", () => {
    expect(mappingCaveat("rule")).toBe("matched");
    expect(mappingCaveat("operator")).toBe("curated");
    expect(mappingCaveat("backfill")).toBe("curated");
    expect(mappingCaveat("user")).toBe("user_confirmed");
  });
});

describe("deriveCandidateId", () => {
  it("is stable for the same source identity and distinct otherwise", () => {
    expect(deriveCandidateId("twenty", "", "tw-1")).toBe(
      deriveCandidateId("twenty", "", "tw-1"),
    );
    expect(deriveCandidateId("twenty", "", "tw-1")).not.toBe(
      deriveCandidateId("twenty", "", "tw-2"),
    );
    expect(deriveCandidateId("twenty", "", "tw-1")).not.toBe(
      deriveCandidateId("lastmile", "", "tw-1"),
    );
  });
});

const candidate = (overrides: Partial<MappingCandidate>): MappingCandidate => ({
  id: deriveCandidateId("twenty", "", overrides.externalId ?? "tw-1"),
  sourceSystem: "twenty",
  namespace: "",
  externalId: "tw-1",
  sourceCanonicalEntityId: "c-shadow",
  matchedKeyKinds: ["domain"],
  normalizedValues: { domain: "acme.com" },
  confidence: null,
  ...overrides,
});

describe("rankMappingCandidates", () => {
  it("ranks by matched key kinds, then confidence, then stable order", () => {
    const ranked = rankMappingCandidates([
      candidate({ externalId: "tw-low", confidence: 0.2 }),
      candidate({
        externalId: "tw-two-keys",
        matchedKeyKinds: ["domain", "email"],
        confidence: 0.1,
      }),
      candidate({ externalId: "tw-high", confidence: 0.9 }),
    ]);
    expect(ranked.map((entry) => entry.externalId)).toEqual([
      "tw-two-keys",
      "tw-high",
      "tw-low",
    ]);
  });
});

describe("declineCaseSignature", () => {
  it("is stable per (entity, target system) and distinct across targets", () => {
    const target = {
      entityTypeSlug: "company",
      canonicalEntityId: "c-1",
      targetSystem: "twenty",
    };
    expect(declineCaseSignature(target)).toBe(declineCaseSignature(target));
    expect(declineCaseSignature(target)).not.toBe(
      declineCaseSignature({ ...target, targetSystem: "lastmile" }),
    );
    expect(declineCaseSignature(target)).not.toBe(
      declineCaseSignature({ ...target, canonicalEntityId: "c-2" }),
    );
  });
});

// ---------------------------------------------------------------------------
// validateCandidateConfirmation (KTD-2 consent binding, pure core)
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-19T12:00:00Z");
const FUTURE = new Date(NOW.getTime() + 60 * 60 * 1000);

const openSet = (overrides: Partial<CandidateSetRow>): CandidateSetRow => ({
  id: "set-1",
  thread_ref: "thread-1",
  source_system: "twenty",
  status: "open",
  selected_candidate_id: "cand-1",
  candidates: [
    {
      id: "cand-1",
      sourceSystem: "twenty",
      namespace: "",
      externalId: "tw-1",
    },
  ],
  target_entity_ref: {
    canonicalEntityId: "c-sub",
    entityTypeSlug: "company",
    displayName: "Acme",
    targetSystem: "twenty",
  },
  expires_at: FUTURE,
  ...overrides,
});

describe("validateCandidateConfirmation", () => {
  const args = { threadRef: "thread-1", candidateId: "cand-1", now: NOW };

  it("accepts an open set with a matching recorded selection", () => {
    const verdict = validateCandidateConfirmation(openSet({}), args);
    expect(verdict.ok).toBe(true);
  });

  it("refuses a missing set", () => {
    expect(validateCandidateConfirmation(null, args)).toEqual({
      ok: false,
      reason: "set_not_found",
    });
  });

  it("refuses superseded / confirmed / declined (stale) sets", () => {
    for (const status of ["superseded", "confirmed", "declined", "expired"]) {
      expect(validateCandidateConfirmation(openSet({ status }), args)).toEqual({
        ok: false,
        reason: "set_not_open",
      });
    }
  });

  it("refuses an expired set", () => {
    expect(
      validateCandidateConfirmation(
        openSet({ expires_at: new Date(NOW.getTime() - 1000) }),
        args,
      ),
    ).toEqual({ ok: false, reason: "set_expired" });
  });

  it("refuses a thread mismatch — the set is bound to the asking thread", () => {
    expect(
      validateCandidateConfirmation(openSet({}), {
        ...args,
        threadRef: "other-thread",
      }),
    ).toEqual({ ok: false, reason: "thread_mismatch" });
  });

  it("refuses a candidate id not in the persisted set", () => {
    expect(
      validateCandidateConfirmation(openSet({}), {
        ...args,
        candidateId: "cand-invented",
      }),
    ).toEqual({ ok: false, reason: "candidate_not_in_set" });
  });

  it("refuses when no user selection was recorded at answer intake", () => {
    expect(
      validateCandidateConfirmation(
        openSet({ selected_candidate_id: null }),
        args,
      ),
    ).toEqual({ ok: false, reason: "no_selection_recorded" });
  });

  it("refuses when the echoed id differs from the recorded selection", () => {
    expect(
      validateCandidateConfirmation(
        openSet({ selected_candidate_id: "cand-2" }),
        args,
      ),
    ).toEqual({ ok: false, reason: "selection_mismatch" });
  });

  it("refuses a confirm when the recorded selection is the decline marker", () => {
    expect(
      validateCandidateConfirmation(
        openSet({ selected_candidate_id: DECLINED_CANDIDATE_MARKER }),
        args,
      ),
    ).toEqual({ ok: false, reason: "selection_mismatch" });
  });
});

// ---------------------------------------------------------------------------
// resolveEntities (R1/R2, KTD-1 provenance, KTD-5 fail-closed)
// ---------------------------------------------------------------------------

describe("resolveEntities", () => {
  it("bulk-resolves 50 source-keyed refs into 40 hits + 10 explicit misses, no drops", async () => {
    const fake = createFakeIdentityDb();
    const refs: EntityRef[] = Array.from({ length: 50 }, (_, i) => ({
      sourceSystem: "lastmile",
      externalId: `ext-${i}`,
    }));
    const mapped = Array.from({ length: 40 }, (_, i) => i);
    fake.selectQueue.push(
      // 1. crosswalk reverse lookup — 40 of 50 identities mapped
      mapped.map((i) => ({
        source_system: "lastmile",
        namespace: "",
        external_id: `ext-${i}`,
        canonical_entity_id: `c-${i}`,
      })),
      // 2. canonical entity load
      mapped.map((i) => ({
        id: `c-${i}`,
        status: "active",
        merged_into_id: null,
        display_name: `Customer ${i}`,
        entity_type_slug: "customer",
      })),
      // 3. mappings for resolved entities
      mapped.map((i) => ({
        canonical_entity_id: `c-${i}`,
        source_system: "lastmile",
        namespace: "",
        external_id: `ext-${i}`,
        created_by: "rule",
        created_by_user_id: null,
        created_thread_ref: null,
        created_at: new Date("2026-07-01T00:00:00Z"),
      })),
      // 4. connector links
      [{ source_system: "lastmile", connector_slug: "lastmile-data-catalog" }],
      // 5. claim confidence
      [{ canonical_entity_id: "c-0", confidence: "0.9500" }],
    );

    const result = await resolveEntities(fake.db as never, {
      tenantId: TENANT,
      refs,
    });

    expect(result.results).toHaveLength(50);
    expect(result.totalRefs).toBe(50);
    expect(result.hasMore).toBe(false);
    const hits = result.results.filter((entry) => entry.status === "hit");
    const misses = result.results.filter((entry) => entry.status === "miss");
    expect(hits).toHaveLength(40);
    expect(misses).toHaveLength(10);
    for (const miss of misses) {
      expect(miss.status === "miss" && miss.unroutable).toBe("not_found");
    }
    // Order preserved: result i corresponds to ref i.
    result.results.forEach((entry, i) => {
      expect(entry.ref).toBe(refs[i]);
    });
    // Full provenance payload on hits (KTD-1).
    const first = result.results[0]!;
    expect(first.status).toBe("hit");
    if (first.status === "hit") {
      expect(first.entity.canonicalEntityId).toBe("c-0");
      expect(first.entity.mappings).toEqual([
        {
          sourceSystem: "lastmile",
          namespace: "",
          externalId: "ext-0",
          connectorSlug: "lastmile-data-catalog",
          fetchable: true,
          unroutableReason: null,
          createdBy: "rule",
          createdByUserId: null,
          createdThreadRef: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          caveat: "matched",
          confidence: 0.95,
        },
      ]);
    }
  });

  it("reports a mapping unroutable when its source system has no connector link (fail-closed)", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push(
      [
        {
          source_system: "twenty",
          namespace: "",
          external_id: "tw-1",
          canonical_entity_id: "c-1",
        },
      ],
      [
        {
          id: "c-1",
          status: "active",
          merged_into_id: null,
          display_name: "Acme",
          entity_type_slug: "company",
        },
      ],
      [
        {
          canonical_entity_id: "c-1",
          source_system: "twenty",
          namespace: "",
          external_id: "tw-1",
          created_by: "user",
          created_by_user_id: "user-7",
          created_thread_ref: "thread-9",
          created_at: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      [], // NO connector links for the tenant
      [], // no claims
    );

    const result = await resolveEntities(fake.db as never, {
      tenantId: TENANT,
      refs: [{ sourceSystem: "twenty", externalId: "tw-1" }],
    });
    const [entry] = result.results;
    expect(entry!.status).toBe("hit");
    if (entry!.status === "hit") {
      const [mapping] = entry!.entity.mappings;
      // Never a fetchable key, never an invented slug.
      expect(mapping!.connectorSlug).toBeNull();
      expect(mapping!.fetchable).toBe(false);
      expect(mapping!.unroutableReason).toBe("unroutable_no_connector");
      expect(mapping!.caveat).toBe("user_confirmed");
      expect(mapping!.createdByUserId).toBe("user-7");
      expect(mapping!.createdThreadRef).toBe("thread-9");
    }
  });

  it("resolves canonical-id and name refs; ambiguous names and invalid refs are explicit misses", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push(
      // 1. name lookup (two name refs; "Dup Co" matches twice)
      [
        {
          id: "c-2",
          status: "active",
          merged_into_id: null,
          display_name: "Acme",
          entity_type_slug: "company",
          normalized_name: "acme",
        },
        {
          id: "c-3",
          status: "active",
          merged_into_id: null,
          display_name: "Dup Co",
          entity_type_slug: "company",
          normalized_name: "dup co",
        },
        {
          id: "c-4",
          status: "active",
          merged_into_id: null,
          display_name: "Dup Co.",
          entity_type_slug: "company",
          normalized_name: "dup co",
        },
      ],
      // 2. canonical-ref entity load
      [
        {
          id: "c-1",
          status: "active",
          merged_into_id: null,
          display_name: "Direct",
          entity_type_slug: "company",
        },
      ],
      [], // mappings
      [], // connectors
      [], // claims
    );

    const result = await resolveEntities(fake.db as never, {
      tenantId: TENANT,
      refs: [
        { canonicalId: "c-1" },
        { name: "Acme", entityTypeSlug: "company" },
        { name: "Dup Co", entityTypeSlug: "company" },
        {} as EntityRef,
      ],
    });
    expect(result.results.map((entry) => entry.status)).toEqual([
      "hit",
      "hit",
      "miss",
      "miss",
    ]);
    expect(
      result.results[2]!.status === "miss" && result.results[2]!.unroutable,
    ).toBe("ambiguous_name");
    expect(
      result.results[3]!.status === "miss" && result.results[3]!.unroutable,
    ).toBe("invalid_ref");
  });

  it("pages and caps refs — the 6MB envelope discipline", async () => {
    const fake = createFakeIdentityDb();
    const refs: EntityRef[] = Array.from({ length: 250 }, (_, i) => ({
      canonicalId: `c-${i}`,
    }));
    fake.selectQueue.push([]); // entity load — none found
    const capped = await resolveEntities(fake.db as never, {
      tenantId: TENANT,
      refs,
    });
    expect(capped.limit).toBe(DEFAULT_RESOLVE_PAGE_SIZE);
    expect(capped.results).toHaveLength(200);
    expect(capped.totalRefs).toBe(250);
    expect(capped.hasMore).toBe(true);

    const fake2 = createFakeIdentityDb();
    fake2.selectQueue.push([]);
    const paged = await resolveEntities(fake2.db as never, {
      tenantId: TENANT,
      refs,
      page: 1,
      limit: 100,
    });
    expect(paged.results).toHaveLength(100);
    expect(paged.results[0]!.ref).toBe(refs[100]);
    expect(paged.hasMore).toBe(true);

    const fake3 = createFakeIdentityDb();
    fake3.selectQueue.push([]);
    const overCap = await resolveEntities(fake3.db as never, {
      tenantId: TENANT,
      refs,
      limit: 10_000,
    });
    expect(overCap.limit).toBe(200); // caller cannot exceed the cap
  });
});

// ---------------------------------------------------------------------------
// proposeMappingCandidates (KTD-1 drift-bounded, KTD-2 persisted set)
// ---------------------------------------------------------------------------

describe("proposeMappingCandidates", () => {
  it("ranks candidates from existing claims, excludes rejected pairings, persists the set", async () => {
    const fake = createFakeIdentityDb();
    const hash = hashIdentityValue("acme.com");
    fake.selectQueue.push(
      // 1. subject entity
      [
        {
          id: "c-sub",
          status: "active",
          entity_type_slug: "company",
          display_name: "Acme",
        },
      ],
      // 2. ontology identity rules
      [
        {
          slug: "company",
          identity_rules: [
            {
              slug: "company-domain",
              keyKind: "domain",
              normalization: "domain",
              unique: true,
              autoLink: true,
              version: 1,
            },
          ],
        },
      ],
      // 3. subject's active claims
      [{ key_kind: "domain", normalized_value: "acme.com", value_hash: hash }],
      // 4. overlapping claims on other canonical entities
      [
        {
          canonical_entity_id: "c-shadow",
          key_kind: "domain",
          value_hash: hash,
          normalized_value: "acme.com",
          confidence: "0.9",
        },
        {
          canonical_entity_id: "c-shadow2",
          key_kind: "domain",
          value_hash: hash,
          normalized_value: "acme.com",
          confidence: null,
        },
      ],
      // 5. target-system mappings on the overlapping entities
      [
        {
          canonical_entity_id: "c-shadow",
          source_system: "twenty",
          namespace: "",
          external_id: "tw-1",
        },
        {
          canonical_entity_id: "c-shadow2",
          source_system: "twenty",
          namespace: "",
          external_id: "tw-2",
        },
      ],
      // 6. rejection rows: tw-2 was previously revoked against the subject
      [{ namespace: "", external_id: "tw-2" }],
    );
    fake.insertReturningQueue.push([{ id: "set-1" }]);

    const result = await proposeMappingCandidates(fake.db as never, {
      tenantId: TENANT,
      canonicalEntityId: "c-sub",
      targetSystem: "twenty",
      threadRef: "thread-1",
    });

    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    expect(result.candidateSetId).toBe("set-1");
    // Rejected pairing tw-2 is never re-proposed (AE4).
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: deriveCandidateId("twenty", "", "tw-1"),
      externalId: "tw-1",
      matchedKeyKinds: ["domain"],
      normalizedValues: { domain: "acme.com" },
      confidence: 0.9,
    });
    // Prior open sets for the same (thread, target system) are superseded.
    const supersede = fake.updates.find(
      (update) => update.table === mappingCandidateSets,
    );
    expect(supersede?.values).toEqual({ status: "superseded" });
    // The set persists with the presented candidates + thread binding.
    const persisted = fake.inserts.find(
      (insert) => insert.table === mappingCandidateSets,
    );
    expect(persisted?.values).toMatchObject({
      tenant_id: TENANT,
      thread_ref: "thread-1",
      source_system: "twenty",
      status: "open",
    });
    expect(
      (persisted?.values.candidates as MappingCandidate[]).map(
        (entry) => entry.externalId,
      ),
    ).toEqual(["tw-1"]);
  });

  it("refuses when the subject entity does not exist", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([]);
    const result = await proposeMappingCandidates(fake.db as never, {
      tenantId: TENANT,
      canonicalEntityId: "c-missing",
      targetSystem: "twenty",
      threadRef: "thread-1",
    });
    expect(result).toEqual({ status: "refused", reason: "entity_not_found" });
    expect(fake.inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// recordCandidateSelection + confirmMapping (KTD-2)
// ---------------------------------------------------------------------------

const dbSetRow = (overrides: Record<string, unknown> = {}) => ({
  id: "set-1",
  thread_ref: "thread-1",
  source_system: "twenty",
  status: "open",
  selected_candidate_id: "cand-1",
  candidates: [
    { id: "cand-1", sourceSystem: "twenty", namespace: "", externalId: "tw-1" },
  ],
  target_entity_ref: {
    canonicalEntityId: "c-sub",
    entityTypeSlug: "company",
    displayName: "Acme",
    targetSystem: "twenty",
  },
  expires_at: FUTURE,
  ...overrides,
});

describe("recordCandidateSelection", () => {
  const recordArgs = {
    tenantId: TENANT,
    threadRef: "thread-1",
    candidateSetId: "set-1",
    candidateId: "cand-1",
    now: NOW,
  };

  it("records the user's selection on an open set", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([dbSetRow({ selected_candidate_id: null })]);
    const result = await recordCandidateSelection(fake.db as never, recordArgs);
    expect(result).toEqual({ status: "recorded" });
    expect(fake.updates[0]?.values).toEqual({
      selected_candidate_id: "cand-1",
    });
  });

  it("records the decline marker for a 'None of these' pick without a set-membership check", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([dbSetRow({ selected_candidate_id: null })]);
    const result = await recordCandidateSelection(fake.db as never, {
      ...recordArgs,
      candidateId: DECLINED_CANDIDATE_MARKER,
    });
    expect(result).toEqual({ status: "recorded" });
    expect(fake.updates[0]?.values).toEqual({
      selected_candidate_id: DECLINED_CANDIDATE_MARKER,
    });
  });

  it("refuses a candidate id that is not in the set", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([dbSetRow({ selected_candidate_id: null })]);
    const result = await recordCandidateSelection(fake.db as never, {
      ...recordArgs,
      candidateId: "cand-forged",
    });
    expect(result).toEqual({
      status: "refused",
      reason: "candidate_not_in_set",
    });
    expect(fake.updates).toHaveLength(0);
  });

  it("refuses a set bound to another thread (forged candidateSetId)", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([
      dbSetRow({ selected_candidate_id: null, thread_ref: "other-thread" }),
    ]);
    const result = await recordCandidateSelection(fake.db as never, recordArgs);
    expect(result).toEqual({ status: "refused", reason: "thread_mismatch" });
    expect(fake.updates).toHaveLength(0);
  });

  it("refuses non-open and expired sets", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([
      dbSetRow({ selected_candidate_id: null, status: "superseded" }),
    ]);
    expect(
      await recordCandidateSelection(fake.db as never, recordArgs),
    ).toEqual({ status: "refused", reason: "set_not_open" });

    fake.selectQueue.push([
      dbSetRow({
        selected_candidate_id: null,
        expires_at: new Date(NOW.getTime() - 1),
      }),
    ]);
    expect(
      await recordCandidateSelection(fake.db as never, recordArgs),
    ).toEqual({ status: "refused", reason: "set_expired" });
    expect(fake.updates).toHaveLength(0);
  });

  it("refuses a missing set", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([]);
    expect(
      await recordCandidateSelection(fake.db as never, recordArgs),
    ).toEqual({ status: "refused", reason: "set_not_found" });
  });
});

describe("confirmMapping", () => {
  const confirmArgs = {
    tenantId: TENANT,
    threadRef: "thread-1",
    candidateSetId: "set-1",
    candidateId: "cand-1",
    userId: "user-7",
    now: NOW,
  };

  it("writes a user-attributed mapping + link audit event carrying the thread ref", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([dbSetRow()]);
    fake.insertReturningQueue.push([{ id: "map-1" }]);

    const result = await confirmMapping(fake.db as never, confirmArgs);
    expect(result).toEqual({
      status: "confirmed",
      mappingId: "map-1",
      canonicalEntityId: "c-sub",
      sourceSystem: "twenty",
      namespace: "",
      externalId: "tw-1",
    });
    // Server-derived attribution on the mapping row (AE3).
    const mappingInsert = fake.inserts.find(
      (insert) => insert.table === entitySourceMappings,
    );
    expect(mappingInsert?.values).toMatchObject({
      canonical_entity_id: "c-sub",
      source_system: "twenty",
      external_id: "tw-1",
      created_by: "user",
      created_by_user_id: "user-7",
      created_thread_ref: "thread-1",
    });
    // The set is marked confirmed.
    const setUpdate = fake.updates.find(
      (update) => update.table === mappingCandidateSets,
    );
    expect(setUpdate?.values).toMatchObject({ status: "confirmed" });
    // Link audit event references the thread/turn.
    const event = fake.inserts.find(
      (insert) => insert.table === entityResolutionEvents,
    );
    expect(event?.values).toMatchObject({
      event_type: "link",
      actor_user_id: "user-7",
    });
    expect(event?.values.payload).toMatchObject({
      threadRef: "thread-1",
      candidateId: "cand-1",
      createdBy: "user",
    });
  });

  it("maps a unique-index conflict to a typed already_linked result", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push(
      [dbSetRow()],
      // existing-mapping lookup after the conflict
      [{ id: "map-exist", canonical_entity_id: "c-other" }],
    );
    fake.insertReturningQueue.push([]); // onConflictDoNothing returned no row

    const result = await confirmMapping(fake.db as never, confirmArgs);
    expect(result).toEqual({
      status: "already_linked",
      existingMappingId: "map-exist",
      existingCanonicalEntityId: "c-other",
    });
    // No event, no set state change on the losing confirm.
    expect(
      fake.inserts.filter((insert) => insert.table === entityResolutionEvents),
    ).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });

  it("refuses when no selection was recorded at answer intake", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([dbSetRow({ selected_candidate_id: null })]);
    const result = await confirmMapping(fake.db as never, confirmArgs);
    expect(result).toEqual({
      status: "refused",
      reason: "no_selection_recorded",
    });
    expect(fake.inserts).toHaveLength(0);
  });

  it("refuses a candidate id not in the persisted set", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([dbSetRow()]);
    const result = await confirmMapping(fake.db as never, {
      ...confirmArgs,
      candidateId: "cand-invented",
    });
    expect(result).toEqual({
      status: "refused",
      reason: "candidate_not_in_set",
    });
    expect(fake.inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// declineCandidates (AE7: at-most-one open case per signature)
// ---------------------------------------------------------------------------

describe("declineCandidates", () => {
  it("files one deduped case across repeat declines of the same target", async () => {
    const fake = createFakeIdentityDb();
    // First decline — no open case yet, a new one is filed. The set carries
    // the decline marker recorded at answer intake (consent gate).
    fake.selectQueue.push(
      [dbSetRow({ selected_candidate_id: DECLINED_CANDIDATE_MARKER })], // set load
      [], // no existing open case for the signature
      [{ count: 0 }], // open-case count for budget enforcement
    );
    // enforceQueueBudgets stale-expiry update returns no rows by default.
    fake.insertReturningQueue.push([{ id: "case-1" }]);
    const first = await declineCandidates(fake.db as never, {
      tenantId: TENANT,
      threadRef: "thread-1",
      candidateSetId: "set-1",
      userId: "user-7",
      provenance: { agentSlug: "pi", turnRef: "turn-42" },
    });
    expect(first).toEqual({
      status: "declined",
      caseId: "case-1",
      coalesced: false,
    });
    // Agent/turn provenance lands on the case payload.
    const caseInsert = fake.inserts.find(
      (insert) => insert.table === entityResolutionCases,
    );
    expect(caseInsert?.values.impact_summary).toMatchObject({
      declinedConfirm: {
        canonicalEntityId: "c-sub",
        targetSystem: "twenty",
        threadRef: "thread-1",
        declinedByUserId: "user-7",
        agentSlug: "pi",
        turnRef: "turn-42",
      },
    });

    // Second decline (fresh set, same target) — coalesces onto case-1.
    fake.selectQueue.push(
      [
        dbSetRow({
          id: "set-2",
          thread_ref: "thread-2",
          selected_candidate_id: DECLINED_CANDIDATE_MARKER,
        }),
      ],
      [{ id: "case-1" }], // the open case already exists for the signature
    );
    const second = await declineCandidates(fake.db as never, {
      tenantId: TENANT,
      threadRef: "thread-2",
      candidateSetId: "set-2",
      userId: "user-7",
    });
    expect(second).toEqual({
      status: "declined",
      caseId: "case-1",
      coalesced: true,
    });
    // Still exactly one case insert across both declines.
    expect(
      fake.inserts.filter((insert) => insert.table === entityResolutionCases),
    ).toHaveLength(1);
  });

  it("refuses declines for a set bound to another thread", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([
      dbSetRow({ selected_candidate_id: DECLINED_CANDIDATE_MARKER }),
    ]);
    const result = await declineCandidates(fake.db as never, {
      tenantId: TENANT,
      threadRef: "other-thread",
      candidateSetId: "set-1",
      userId: "user-7",
    });
    expect(result).toEqual({ status: "refused", reason: "thread_mismatch" });
    expect(fake.inserts).toHaveLength(0);
  });

  it("refuses when no 'None of these' pick was recorded at answer intake (consent gate)", async () => {
    const fake = createFakeIdentityDb();
    // Recorded selection is a REAL candidate — the model cannot flip it
    // into a decline.
    fake.selectQueue.push([dbSetRow({ selected_candidate_id: "cand-1" })]);
    const declineArgs = {
      tenantId: TENANT,
      threadRef: "thread-1",
      candidateSetId: "set-1",
      userId: "user-7",
    };
    expect(await declineCandidates(fake.db as never, declineArgs)).toEqual({
      status: "refused",
      reason: "no_decline_recorded",
    });

    // No selection recorded at all (question never answered) — same refusal.
    fake.selectQueue.push([dbSetRow({ selected_candidate_id: null })]);
    expect(await declineCandidates(fake.db as never, declineArgs)).toEqual({
      status: "refused",
      reason: "no_decline_recorded",
    });
    expect(fake.inserts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// revokeEntitySourceMapping (KTD-6 / AE4)
// ---------------------------------------------------------------------------

describe("revokeEntitySourceMapping", () => {
  it("deletes the mapping, appends a revoke event, writes negative evidence", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([
      {
        id: "map-1",
        canonical_entity_id: "c-1",
        source_system: "twenty",
        namespace: "",
        external_id: "tw-1",
      },
    ]);
    const result = await revokeEntitySourceMapping(fake.db as never, {
      tenantId: TENANT,
      mappingId: "map-1",
      actor: { createdBy: "operator", userId: "user-op" },
      reason: "wrong company",
    });
    expect(result).toEqual({
      status: "revoked",
      canonicalEntityId: "c-1",
      sourceSystem: "twenty",
      namespace: "",
      externalId: "tw-1",
    });
    expect(fake.deletes).toHaveLength(1);
    expect(fake.deletes[0]?.table).toBe(entitySourceMappings);
    // Negative evidence: the pairing is rejected so drift demotes re-proposal.
    const rejection = fake.inserts.find(
      (insert) => insert.table === mappingRejections,
    );
    expect(rejection?.values).toMatchObject({
      tenant_id: TENANT,
      source_system: "twenty",
      external_id: "tw-1",
      canonical_entity_id: "c-1",
      reason: "wrong company",
      created_by: "operator",
    });
    const event = fake.inserts.find(
      (insert) => insert.table === entityResolutionEvents,
    );
    expect(event?.values).toMatchObject({
      event_type: "revoke",
      actor_user_id: "user-op",
    });
  });

  it("refuses a mapping id that does not exist for the tenant", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([]);
    const result = await revokeEntitySourceMapping(fake.db as never, {
      tenantId: TENANT,
      mappingId: "map-missing",
      actor: { createdBy: "operator", userId: null },
    });
    expect(result).toEqual({ status: "refused", reason: "mapping_not_found" });
    expect(fake.deletes).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// authorEntitySourceMapping (U8 / R12: operator hand-authoring)
// ---------------------------------------------------------------------------

describe("authorEntitySourceMapping", () => {
  const authorArgs = {
    tenantId: TENANT,
    canonicalEntityId: "c-1",
    sourceSystem: "lastmile",
    namespace: "",
    externalId: "cust-42",
    actorUserId: "user-op",
  };

  it("writes an operator-attributed mapping + link audit event", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([{ id: "c-1", status: "active" }]);
    fake.insertReturningQueue.push([{ id: "map-new" }]);

    const result = await authorEntitySourceMapping(
      fake.db as never,
      authorArgs,
    );
    expect(result).toEqual({
      status: "created",
      mapping: {
        id: "map-new",
        canonicalEntityId: "c-1",
        sourceSystem: "lastmile",
        namespace: "",
        externalId: "cust-42",
        visibility: "tenant",
        createdBy: "operator",
      },
    });
    const mappingInsert = fake.inserts.find(
      (insert) => insert.table === entitySourceMappings,
    );
    expect(mappingInsert?.values).toMatchObject({
      tenant_id: TENANT,
      canonical_entity_id: "c-1",
      source_system: "lastmile",
      external_id: "cust-42",
      created_by: "operator",
      created_by_user_id: "user-op",
    });
    const event = fake.inserts.find(
      (insert) => insert.table === entityResolutionEvents,
    );
    expect(event?.values).toMatchObject({
      event_type: "link",
      actor_user_id: "user-op",
    });
    expect(event?.values.payload).toMatchObject({
      mappingId: "map-new",
      sourceSystem: "lastmile",
      externalId: "cust-42",
      createdBy: "operator",
    });
  });

  it("maps a unique-index conflict to a typed already_linked result", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push(
      [{ id: "c-1", status: "active" }],
      // existing-mapping lookup after the conflict
      [{ id: "map-exist", canonical_entity_id: "c-other" }],
    );
    fake.insertReturningQueue.push([]); // onConflictDoNothing returned no row

    const result = await authorEntitySourceMapping(
      fake.db as never,
      authorArgs,
    );
    expect(result).toEqual({
      status: "already_linked",
      existingMappingId: "map-exist",
      existingCanonicalEntityId: "c-other",
    });
    // No audit event on the losing author.
    expect(
      fake.inserts.filter((insert) => insert.table === entityResolutionEvents),
    ).toHaveLength(0);
  });

  it("refuses a missing or non-active canonical entity", async () => {
    const missing = createFakeIdentityDb();
    missing.selectQueue.push([]);
    expect(
      await authorEntitySourceMapping(missing.db as never, authorArgs),
    ).toEqual({ status: "refused", reason: "entity_not_found" });
    expect(missing.inserts).toHaveLength(0);

    const merged = createFakeIdentityDb();
    merged.selectQueue.push([{ id: "c-1", status: "merged" }]);
    expect(
      await authorEntitySourceMapping(merged.db as never, authorArgs),
    ).toEqual({ status: "refused", reason: "entity_not_active" });
    expect(merged.inserts).toHaveLength(0);
  });

  it("refuses blank source system or external id without touching the db", async () => {
    const fake = createFakeIdentityDb();
    expect(
      await authorEntitySourceMapping(fake.db as never, {
        ...authorArgs,
        externalId: "   ",
      }),
    ).toEqual({ status: "refused", reason: "invalid_input" });
    expect(fake.inserts).toHaveLength(0);
  });
});
