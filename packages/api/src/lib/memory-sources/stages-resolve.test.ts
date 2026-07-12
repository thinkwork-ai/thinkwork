/**
 * Resolve stage (THINK-193): the claim ledger's link to canonical identity.
 *
 * The U4 matcher/resolution writers are exercised through an in-memory
 * identity store that reuses the REAL pure decision core (decideMatch) and
 * the REAL normalizers, so the verdict ladder under test is the shipped one;
 * only the Aurora lookups are faked (the shared fake-claims-db models the
 * memory_* tables, not the identity.* schema).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  ...(await import("./test-support/drizzle-condition-mocks.js"))
    .drizzleConditionMocks,
}));
vi.mock("../memory/index.js", () => ({ getMemoryServices: vi.fn() }));
vi.mock("../brain/dream/runner.js", () => ({ runBrainDreamState: vi.fn() }));

interface IdentityEntity {
  id: string;
  entityTypeSlug: string;
  displayName: string;
  normalizedName: string;
}
interface IdentityMapping {
  sourceSystem: string;
  namespace: string;
  externalId: string;
  canonicalEntityId: string;
  visibility: string;
}
interface IdentityClaim {
  keyKind: string;
  normalizedValue: string;
  canonicalEntityId: string;
}
interface IdentityCase {
  id: string;
  signatureHash: string;
  itemCount: number;
}

const identity = vi.hoisted(() => ({
  entities: [] as IdentityEntity[],
  mappings: [] as IdentityMapping[],
  claims: [] as IdentityClaim[],
  cases: [] as IdentityCase[],
  seq: 0,
}));

vi.mock("../entity-identity/matcher.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../entity-identity/matcher.js")>();
  return {
    ...actual,
    matchCanonicalEntity: async (
      _db: unknown,
      request: import("../entity-identity/matcher.js").MatchRequest,
      rules: import("../entity-identity/normalizers.js").IdentityRule[],
    ) => {
      const exact = identity.mappings.find((mapping) =>
        (request.sourceKeys ?? []).some(
          (key) =>
            key.sourceSystem === mapping.sourceSystem &&
            (key.namespace ?? "") === mapping.namespace &&
            key.externalId === mapping.externalId,
        ),
      );
      if (exact) {
        return {
          kind: "exact" as const,
          canonicalEntityId: exact.canonicalEntityId,
        };
      }
      if (request.visibility === "private") {
        return { kind: "private_unmapped" as const };
      }
      const nameOf = (canonicalEntityId: string): string | null =>
        identity.entities.find((entity) => entity.id === canonicalEntityId)
          ?.displayName ?? null;
      const normalized = actual.normalizeNaturalKeys(request, rules);
      const claimMatches = identity.claims
        .filter((claim) =>
          normalized.some(
            (key) =>
              key.keyKind === claim.keyKind &&
              key.normalizedValue === claim.normalizedValue,
          ),
        )
        .map((claim) => ({
          keyKind: claim.keyKind,
          canonicalEntityId: claim.canonicalEntityId,
          canonicalDisplayName: nameOf(claim.canonicalEntityId),
        }));
      const registryName = request.displayName
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
      const seen = new Set(
        claimMatches
          .filter((match) => match.keyKind === "name")
          .map((match) => match.canonicalEntityId),
      );
      for (const entity of identity.entities) {
        if (entity.entityTypeSlug !== request.entityTypeSlug) continue;
        if (entity.normalizedName !== registryName) continue;
        if (seen.has(entity.id)) continue;
        claimMatches.push({
          keyKind: "name",
          canonicalEntityId: entity.id,
          canonicalDisplayName: entity.displayName,
        });
      }
      return actual.decideMatch({
        visibility: "tenant",
        rules,
        exactCanonicalEntityId: null,
        claimMatches,
        nameCandidates: [],
      });
    },
  };
});

vi.mock("../entity-identity/resolution.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../entity-identity/resolution.js")>();
  const normalizers = await import("../entity-identity/normalizers.js");
  const attach = async (
    _db: unknown,
    args: {
      canonicalEntityId: string;
      sourceKeys?: Array<{
        sourceSystem: string;
        namespace?: string;
        externalId: string;
      }>;
      identityKeys?: Array<{ keyKind: string; normalizedValue: string }>;
      visibility?: string;
    },
  ) => {
    for (const key of args.sourceKeys ?? []) {
      const exists = identity.mappings.some(
        (mapping) =>
          mapping.sourceSystem === key.sourceSystem &&
          mapping.namespace === (key.namespace ?? "") &&
          mapping.externalId === key.externalId,
      );
      if (exists) continue;
      identity.mappings.push({
        sourceSystem: key.sourceSystem,
        namespace: key.namespace ?? "",
        externalId: key.externalId,
        canonicalEntityId: args.canonicalEntityId,
        visibility: args.visibility ?? "tenant",
      });
    }
    for (const key of args.identityKeys ?? []) {
      const exists = identity.claims.some(
        (claim) =>
          claim.canonicalEntityId === args.canonicalEntityId &&
          claim.keyKind === key.keyKind &&
          claim.normalizedValue === key.normalizedValue,
      );
      if (exists) continue;
      identity.claims.push({
        keyKind: key.keyKind,
        normalizedValue: key.normalizedValue,
        canonicalEntityId: args.canonicalEntityId,
      });
    }
  };
  return {
    ...actual,
    attachIdentityEvidence: vi.fn(attach),
    createCanonicalEntity: vi.fn(
      async (
        db: unknown,
        input: {
          entityTypeSlug: string;
          displayName: string;
          sourceKeys?: Array<{
            sourceSystem: string;
            namespace?: string;
            externalId: string;
          }>;
          identityKeys?: Array<{ keyKind: string; normalizedValue: string }>;
        },
      ) => {
        const canonicalEntityId = `canon-${++identity.seq}`;
        identity.entities.push({
          id: canonicalEntityId,
          entityTypeSlug: input.entityTypeSlug,
          displayName: input.displayName,
          normalizedName: normalizers.applyNormalization(
            "name",
            input.displayName,
          ),
        });
        await attach(db, { ...input, canonicalEntityId });
        return { canonicalEntityId };
      },
    ),
    openOrCoalesceResolutionCase: vi.fn(
      async (_db: unknown, input: { signatureHash: string }) => {
        const existing = identity.cases.find(
          (row) => row.signatureHash === input.signatureHash,
        );
        if (existing) {
          existing.itemCount += 1;
          return { caseId: existing.id, coalesced: true };
        }
        const caseId = `case-${++identity.seq}`;
        identity.cases.push({
          id: caseId,
          signatureHash: input.signatureHash,
          itemCount: 1,
        });
        return { caseId, coalesced: false };
      },
    ),
  };
});

vi.mock("../entity-identity/snapshot-resolution.js", () => ({
  // No approved ontology identity rules in these tenants — the resolve stage
  // falls back to the matcher defaults (+ its built-in domain key).
  loadIdentityRulesByTypeSlug: vi.fn(async () => new Map()),
}));

import {
  makeFakeMemoryDb,
  type FakeMemoryStore,
} from "./test-support/fake-claims-db.js";
import { runResolve, type StageContext } from "./stages.js";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const USER = "b7de6c4a-8f2e-45cf-a231-5a5f9a3f6c1a";

let fake: ReturnType<typeof makeFakeMemoryDb>;

function ctxFor(options?: {
  targetScope?: "tenant" | "user";
  eventOptions?: Record<string, unknown> | null;
  sourceIds?: string[];
}): StageContext {
  const targetScope = options?.targetScope ?? "tenant";
  const sourceIds = options?.sourceIds ?? ["src-1"];
  return {
    db: fake.db,
    event: {
      workflowRunId: "run-1",
      tenantId: TENANT,
      stepId: "resolve",
      iteration: 0,
      stage: "resolve",
      processorConfigId: "proc-1",
      sourceConfigId: null,
      options: options?.eventOptions ?? null,
    },
    processor: {
      id: "proc-1",
      tenant_id: TENANT,
      mode: targetScope === "user" ? "personal" : "shared",
      target_scope: targetScope,
      target_id: targetScope === "user" ? USER : TENANT,
      created_by_user_id: USER,
      enabled: true,
      status: "active",
      budget: {},
    } as never,
    sources: sourceIds.map(
      (id) =>
        ({
          id,
          tenant_id: TENANT,
          processor_config_id: "proc-1",
          source_family: id === "src-web" ? "firecrawl" : "twenty",
          source_binding_key: "conn-1",
          enabled: true,
          boundary: {},
          erase_generation: 0,
        }) as never,
    ),
  };
}

let claimSeq = 0;

function seedClaim(
  store: FakeMemoryStore,
  args: {
    subjectKey: string;
    subjectEntityType: string;
    predicate: string;
    value: Record<string, unknown>;
    sourceConfigId?: string;
    targetScope?: "tenant" | "user";
    targetId?: string;
  },
): string {
  const id = `claim-${++claimSeq}`;
  store.claims.push({
    id,
    tenant_id: TENANT,
    target_scope: args.targetScope ?? "tenant",
    target_id: args.targetId ?? TENANT,
    subject_key: args.subjectKey,
    subject_entity_type: args.subjectEntityType,
    ontology_predicate: args.predicate,
    value: args.value,
    value_hash: `hash-${id}`,
    effective_from: null,
    effective_to: null,
    status: "active",
    canonical_subject_id: null,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, claimSeq)),
    updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, claimSeq)),
  });
  store.claimEdges.push({
    id: `edge-${id}`,
    tenant_id: TENANT,
    claim_id: id,
    evidence_item_id: `ev-${id}`,
    source_config_id: args.sourceConfigId ?? "src-1",
    status: "active",
    retracted_at: null,
  });
  return id;
}

function seedSource(store: FakeMemoryStore, id: string, eraseGeneration = 0) {
  store.sourceConfigs.push({
    id,
    tenant_id: TENANT,
    enabled: true,
    erase_generation: eraseGeneration,
  });
}

function claimsFor(store: FakeMemoryStore, subjectKey: string) {
  return store.claims.filter((claim) => claim.subject_key === subjectKey);
}

beforeEach(() => {
  fake = makeFakeMemoryDb();
  identity.entities.length = 0;
  identity.mappings.length = 0;
  identity.claims.length = 0;
  identity.cases.length = 0;
  identity.seq = 0;
  claimSeq = 0;
});

describe("runResolve", () => {
  it("creates a canonical entity for a new shared subject and stamps every active claim", async () => {
    const { store } = fake;
    seedSource(store, "src-1");
    seedClaim(store, {
      subjectKey: "twenty:company:co-1",
      subjectEntityType: "customer",
      predicate: "customer.name",
      value: { text: "Acme, Inc." },
    });
    seedClaim(store, {
      subjectKey: "twenty:company:co-1",
      subjectEntityType: "customer",
      predicate: "customer.domain",
      value: { url: "acme.com" },
    });

    const result = await runResolve(ctxFor());

    expect(result.status).toBe("succeeded");
    expect(result.counts).toMatchObject({ changed: 1, created: 1 });
    expect(identity.entities).toHaveLength(1);
    const canonicalId = identity.entities[0]!.id;
    const stamped = claimsFor(store, "twenty:company:co-1");
    expect(stamped).toHaveLength(2);
    expect(
      stamped.every((claim) => claim.canonical_subject_id === canonicalId),
    ).toBe(true);
    // Source mapping + identity claims persisted so the next run is exact.
    expect(identity.mappings).toContainEqual({
      sourceSystem: "twenty",
      namespace: "company",
      externalId: "co-1",
      canonicalEntityId: canonicalId,
      visibility: "tenant",
    });
    const runItem = store.runItems.find((row) => row.stage === "resolve");
    expect(runItem).toMatchObject({ result: "changed" });
  });

  it("reuses an existing exact source mapping (no new entity)", async () => {
    const { store } = fake;
    seedSource(store, "src-1");
    identity.entities.push({
      id: "canon-existing",
      entityTypeSlug: "customer",
      displayName: "Acme",
      normalizedName: "acme",
    });
    identity.mappings.push({
      sourceSystem: "twenty",
      namespace: "company",
      externalId: "co-1",
      canonicalEntityId: "canon-existing",
      visibility: "tenant",
    });
    seedClaim(store, {
      subjectKey: "twenty:company:co-1",
      subjectEntityType: "customer",
      predicate: "customer.name",
      value: { text: "Acme" },
    });
    seedClaim(store, {
      subjectKey: "twenty:company:co-1",
      subjectEntityType: "customer",
      predicate: "customer.employees",
      value: { count: 91 },
    });

    const result = await runResolve(ctxFor());

    expect(result.counts).toMatchObject({ changed: 1, created: 0 });
    expect(identity.entities).toHaveLength(1);
    expect(
      claimsFor(store, "twenty:company:co-1").every(
        (claim) => claim.canonical_subject_id === "canon-existing",
      ),
    ).toBe(true);
  });

  it("AE1: a web page subject joins the Twenty customer through customer.domain", async () => {
    const { store } = fake;
    seedSource(store, "src-1");
    seedSource(store, "src-web");
    seedClaim(store, {
      subjectKey: "twenty:company:co-1",
      subjectEntityType: "customer",
      predicate: "customer.name",
      value: { text: "Acme" },
    });
    seedClaim(store, {
      subjectKey: "twenty:company:co-1",
      subjectEntityType: "customer",
      predicate: "customer.domain",
      value: { url: "acme.com" },
    });
    seedClaim(store, {
      subjectKey: "web:page:https://www.acme.com/pricing",
      subjectEntityType: "customer",
      predicate: "customer.domain",
      value: { url: "www.acme.com" },
      sourceConfigId: "src-web",
    });
    seedClaim(store, {
      subjectKey: "web:page:https://www.acme.com/pricing",
      subjectEntityType: "customer",
      predicate: "customer.web_page_title",
      value: { text: "Acme — Pricing" },
      sourceConfigId: "src-web",
    });

    const result = await runResolve(
      ctxFor({ sourceIds: ["src-1", "src-web"] }),
    );

    expect(result.status).toBe("succeeded");
    expect(result.counts).toMatchObject({
      changed: 2,
      created: 1,
      deferred: 0,
    });
    // ONE canonical customer for both source families.
    expect(identity.entities).toHaveLength(1);
    const canonicalId = identity.entities[0]!.id;
    const all = [
      ...claimsFor(store, "twenty:company:co-1"),
      ...claimsFor(store, "web:page:https://www.acme.com/pricing"),
    ];
    expect(all).toHaveLength(4);
    expect(
      all.every((claim) => claim.canonical_subject_id === canonicalId),
    ).toBe(true);
  });

  it("defers an ambiguous subject: resolution case, NULL canonical", async () => {
    const { store } = fake;
    seedSource(store, "src-1");
    // Two existing customers, one holding the name key and one the domain key.
    identity.entities.push(
      {
        id: "canon-a",
        entityTypeSlug: "customer",
        displayName: "Acme",
        normalizedName: "acme",
      },
      {
        id: "canon-b",
        entityTypeSlug: "customer",
        displayName: "Acme Labs",
        normalizedName: "acme labs",
      },
    );
    identity.claims.push(
      {
        keyKind: "name",
        normalizedValue: "acme",
        canonicalEntityId: "canon-a",
      },
      {
        keyKind: "domain",
        normalizedValue: "acme.com",
        canonicalEntityId: "canon-b",
      },
    );
    seedClaim(store, {
      subjectKey: "twenty:company:co-9",
      subjectEntityType: "customer",
      predicate: "customer.name",
      value: { text: "Acme" },
    });
    seedClaim(store, {
      subjectKey: "twenty:company:co-9",
      subjectEntityType: "customer",
      predicate: "customer.domain",
      value: { url: "acme.com" },
    });

    const result = await runResolve(ctxFor());

    expect(result.counts).toMatchObject({ deferred: 1, changed: 0 });
    expect(identity.cases).toHaveLength(1);
    const caseId = identity.cases[0]!.id;
    expect(
      (result.output as { deferredCaseIds: string[] }).deferredCaseIds,
    ).toEqual([caseId]);
    expect(
      claimsFor(store, "twenty:company:co-9").every(
        (claim) => claim.canonical_subject_id === null,
      ),
    ).toBe(true);
    const runItem = store.runItems.find((row) => row.stage === "resolve");
    expect(runItem).toMatchObject({ result: "deferred" });
    expect((runItem!.detail as { caseId: string }).caseId).toBe(caseId);
  });

  it("AE4: a personal (user-scoped) subject is private_unmapped — no mapping, no case, NULL canonical", async () => {
    const { store } = fake;
    seedSource(store, "src-1");
    seedClaim(store, {
      subjectKey: "email:thread:t-1",
      subjectEntityType: "email_thread",
      predicate: "email.subject",
      value: { text: "Acme renewal" },
      targetScope: "user",
      targetId: USER,
    });

    const result = await runResolve(ctxFor({ targetScope: "user" }));

    expect(result.status).toBe("succeeded");
    expect(result.counts).toMatchObject({ noop: 1, changed: 0, deferred: 0 });
    expect(identity.mappings).toHaveLength(0);
    expect(identity.entities).toHaveLength(0);
    expect(identity.cases).toHaveLength(0);
    expect(claimsFor(store, "email:thread:t-1")[0]!.canonical_subject_id).toBe(
      null,
    );
    const runItem = store.runItems.find((row) => row.stage === "resolve");
    expect(runItem).toMatchObject({ result: "noop" });
    expect((runItem!.detail as { verdict: string }).verdict).toBe(
      "private_unmapped",
    );
  });

  it("AE4: a personal subject REUSES an existing exact mapping without creating tenant identity", async () => {
    const { store } = fake;
    seedSource(store, "src-1");
    identity.entities.push({
      id: "canon-existing",
      entityTypeSlug: "email_thread",
      displayName: "thread",
      normalizedName: "thread",
    });
    identity.mappings.push({
      sourceSystem: "gmail",
      namespace: "thread",
      externalId: "t-1",
      canonicalEntityId: "canon-existing",
      visibility: "tenant",
    });
    seedClaim(store, {
      subjectKey: "email:thread:t-1",
      subjectEntityType: "email_thread",
      predicate: "email.subject",
      value: { text: "Acme renewal" },
      targetScope: "user",
      targetId: USER,
    });

    const result = await runResolve(ctxFor({ targetScope: "user" }));

    expect(result.counts).toMatchObject({ changed: 1 });
    expect(identity.mappings).toHaveLength(1);
    expect(identity.cases).toHaveLength(0);
    expect(claimsFor(store, "email:thread:t-1")[0]!.canonical_subject_id).toBe(
      "canon-existing",
    );
  });

  it("bounds the batch and reports a continuation", async () => {
    const { store } = fake;
    seedSource(store, "src-1");
    for (const id of ["co-1", "co-2", "co-3"]) {
      seedClaim(store, {
        subjectKey: `twenty:company:${id}`,
        subjectEntityType: "customer",
        predicate: "customer.name",
        value: { text: `Company ${id}` },
      });
    }

    const result = await runResolve(
      ctxFor({ eventOptions: { resolveBatch: 2 } }),
    );

    expect(result.counts).toMatchObject({ changed: 2 });
    expect(result.output).toMatchObject({ continuation: true, remaining: 1 });
    expect(
      claimsFor(store, "twenty:company:co-3")[0]!.canonical_subject_id,
    ).toBe(null);
  });

  it("aborts when the erase fence has moved", async () => {
    const { store } = fake;
    seedSource(store, "src-1", 3); // stage context captured generation 0
    seedClaim(store, {
      subjectKey: "twenty:company:co-1",
      subjectEntityType: "customer",
      predicate: "customer.name",
      value: { text: "Acme" },
    });

    const result = await runResolve(ctxFor());

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/erase|generation/i);
    expect(
      claimsFor(store, "twenty:company:co-1")[0]!.canonical_subject_id,
    ).toBe(null);
  });

  it("no-ops when there is nothing left to resolve", async () => {
    seedSource(fake.store, "src-1");
    const result = await runResolve(ctxFor());
    expect(result.status).toBe("succeeded");
    expect(result.counts).toMatchObject({ noop: 1 });
  });
});
