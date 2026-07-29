/**
 * Identity-source registration + bootstrap/drift match job tests
 * (THINK-321 U7). Covers the plan's U7 test list: registration validation
 * (unknown connector), job dedupe,
 * invoke-failure marking, the matcher-verdict split, VISIBLE queue-budget
 * displacement (F4), drift-over-revoked suppression (AE4's half), stale
 * source records, and predecessor-derived continuation dedupe keys.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  entitySourceMappings,
  identityMatchJobs,
  sourceSystemConnectors,
} from "@thinkwork/database-pg/schema";
import { createFakeIdentityDb } from "./fake-db.test-helper.js";
import {
  buildIdentityMatchDedupeKey,
  deriveContinuationDedupeKey,
  registerIdentitySource,
  runIdentityMatchJob,
  startIdentityMatchJob,
  toIdentityMatchJob,
  type IdentitySourceRecord,
  type RunIdentityMatchDeps,
} from "./bootstrap.js";
import type { IdentityDbClient } from "./matcher.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

const NAME_RULE = {
  slug: "customer-name",
  keyKind: "name",
  normalization: "name",
  unique: true,
  uniquenessScope: "tenant",
  sourcePrecedence: [],
  autoLink: true,
  version: 1,
};

function record(
  externalId: string,
  name: string,
  entityTypeSlug = "customer",
): IdentitySourceRecord {
  return {
    entityTypeSlug,
    externalId,
    displayName: name,
    naturalKeys: [{ keyKind: "name", rawValue: name }],
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    tenant_id: TENANT,
    status: "pending",
    trigger: "manual",
    dedupe_key: `identity-match:${TENANT}:manual:100`,
    source_systems: [],
    result: {},
    metrics: {},
    error: null,
    created_at: new Date("2026-07-19T00:00:00Z"),
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Registration (KTD-5)
// ---------------------------------------------------------------------------

describe("registerIdentitySource", () => {
  it("rejects an unknown connector with a typed error", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([]); // connector lookup

    await expect(
      registerIdentitySource(
        {
          tenantId: TENANT,
          sourceSystem: "lastmile",
          connectorSlug: "nope",
          entityTypeSlugs: ["customer"],
        },
        { db: fake.db as unknown as IdentityDbClient },
      ),
    ).rejects.toMatchObject({
      name: "IdentitySourceRegistrationError",
      code: "connector_not_found",
    });
    expect(fake.inserts).toHaveLength(0);
  });

  it("writes the connector link on success and echoes the declared types", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([{ slug: "lastmile-pg" }]);

    const result = await registerIdentitySource(
      {
        tenantId: TENANT,
        sourceSystem: "lastmile",
        connectorSlug: "lastmile-pg",
        entityTypeSlugs: ["customer"],
      },
      { db: fake.db as unknown as IdentityDbClient },
    );

    const linkInsert = fake.inserts.find(
      (write) => write.table === sourceSystemConnectors,
    );
    expect(linkInsert?.values).toMatchObject({
      tenant_id: TENANT,
      source_system: "lastmile",
      connector_slug: "lastmile-pg",
    });
    expect(result.entityTypeSlugs).toEqual(["customer"]);
  });
});

// ---------------------------------------------------------------------------
// Dedupe keys — derived from the predecessor, never wall-clock
// ---------------------------------------------------------------------------

describe("continuation dedupe keys", () => {
  it("advances a standard bucket key by exactly one bucket", () => {
    expect(
      deriveContinuationDedupeKey(`identity-match:${TENANT}:manual:100`),
    ).toBe(`identity-match:${TENANT}:manual:101`);
  });

  it("chains non-numeric keys with a :cN suffix", () => {
    expect(deriveContinuationDedupeKey("operator-oneshot")).toBe(
      "operator-oneshot:c1",
    );
    expect(deriveContinuationDedupeKey("operator-oneshot:c1")).toBe(
      "operator-oneshot:c2",
    );
  });

  it("is independent of the clock (pure derivation from the key)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-19T00:00:00Z"));
      const early = deriveContinuationDedupeKey(
        `identity-match:${TENANT}:manual:100`,
      );
      vi.setSystemTime(new Date("2026-07-19T23:59:00Z"));
      const late = deriveContinuationDedupeKey(
        `identity-match:${TENANT}:manual:100`,
      );
      expect(early).toBe(late);
    } finally {
      vi.useRealTimers();
    }
  });

  it("buckets the start key from the supplied now", () => {
    const key = buildIdentityMatchDedupeKey({
      tenantId: TENANT,
      trigger: "bootstrap",
      now: new Date(300 * 1000 * 42),
    });
    expect(key).toBe(`identity-match:${TENANT}:bootstrap:42`);
  });
});

// ---------------------------------------------------------------------------
// Start: insert-or-load dedupe + Event invoke (the suggestion-scan mirror)
// ---------------------------------------------------------------------------

describe("startIdentityMatchJob", () => {
  beforeEach(() => {
    process.env.IDENTITY_MATCH_FUNCTION_NAME = "tw-test-identity-match";
  });

  it("starting twice on one dedupe key yields one run", async () => {
    const send = vi.fn().mockResolvedValue({});
    const lambdaClient = { send };
    const fake = createFakeIdentityDb();
    const row = jobRow();
    fake.selectQueue.push([]); // no existing job
    fake.insertReturningQueue.push([row]);

    const first = await startIdentityMatchJob({
      tenantId: TENANT,
      dedupeKey: row.dedupe_key as string,
      db: fake.db as unknown as IdentityDbClient,
      lambdaClient,
    });
    expect(first.result).toMatchObject({ deduped: false });
    expect(send).toHaveBeenCalledTimes(1);

    // Second start: the existing row is loaded and, being already running,
    // never re-invoked.
    fake.selectQueue.push([{ ...row, status: "running" }]);
    const second = await startIdentityMatchJob({
      tenantId: TENANT,
      dedupeKey: row.dedupe_key as string,
      db: fake.db as unknown as IdentityDbClient,
      lambdaClient,
    });
    expect(second.result).toMatchObject({
      deduped: true,
      invoke: { state: "skipped" },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("marks the row failed with an invokeFailure metric when the invoke throws", async () => {
    const send = vi.fn().mockRejectedValue(new Error("lambda unreachable"));
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([]);
    fake.insertReturningQueue.push([jobRow()]);
    fake.selectQueue.push([]); // reload after failure → fall back to local shape

    const result = await startIdentityMatchJob({
      tenantId: TENANT,
      db: fake.db as unknown as IdentityDbClient,
      lambdaClient: { send },
    });

    expect(result.status).toBe("FAILED");
    const failedUpdate = fake.updates.find(
      (update) =>
        update.table === identityMatchJobs && update.values.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.values.metrics).toMatchObject({ invokeFailure: true });
    expect(failedUpdate?.values.error).toContain("lambda unreachable");
  });
});

// ---------------------------------------------------------------------------
// Run: verdict split, budget visibility, drift suppression, staleness
// ---------------------------------------------------------------------------

function runDeps(
  fake: ReturnType<typeof createFakeIdentityDb>,
  overrides: Partial<RunIdentityMatchDeps> = {},
): RunIdentityMatchDeps {
  return {
    db: fake.db as unknown as IdentityDbClient,
    enforceBudgets: vi
      .fn()
      .mockResolvedValue({ expiredStale: 0, expiredOverBudget: 0 }),
    openCase: vi.fn().mockResolvedValue({ caseId: "case-1", coalesced: false }),
    startContinuation: vi
      .fn()
      .mockResolvedValue({ result: { deduped: false } }),
    ...overrides,
  };
}

/**
 * Queue the standard run preamble: job row, registered sources, and the
 * tenant's distinct active canonical entity types (THINK-408 replaced the
 * ontology `system_map` read with this ontology-free type registry).
 */
function queuePreamble(
  fake: ReturnType<typeof createFakeIdentityDb>,
  job: Record<string, unknown>,
) {
  fake.selectQueue.push([job]); // job load
  fake.selectQueue.push([
    { source_system: "lastmile", connector_slug: "lastmile-pg" },
  ]); // registered identity sources
  fake.selectQueue.push([{ slug: "customer" }]); // active canonical types
}

describe("runIdentityMatchJob", () => {
  it("splits a fixture batch into auto-links, creates, and cases per verdict", async () => {
    const fake = createFakeIdentityDb();
    queuePreamble(fake, jobRow());
    // r1 auto_link → attachIdentityEvidence claim-existence probe
    fake.selectQueue.push([]);
    // r3 new → createCanonicalEntity claim probe
    fake.selectQueue.push([]);
    // stale sweep mapping load (drained scan, fresh cursor)
    fake.selectQueue.push([]);

    const verdicts: Record<string, unknown> = {
      "r-1": {
        kind: "auto_link",
        canonicalEntityId: "ce-1",
        ruleSlug: "customer-name",
      },
      "r-2": {
        kind: "ambiguous",
        candidates: [
          {
            canonicalEntityId: "ce-2",
            displayName: "A",
            matchedKeyKinds: ["name"],
          },
          {
            canonicalEntityId: "ce-3",
            displayName: "B",
            matchedKeyKinds: ["name"],
          },
        ],
      },
      "r-3": { kind: "new" },
      "r-4": {
        kind: "suggestion",
        canonicalEntityId: "ce-4",
        matchedKeyKinds: ["name"],
      },
    };
    const deps = runDeps(fake, {
      fetchSourceRecords: vi.fn().mockResolvedValue({
        records: [
          record("r-1", "Acme Fuel"),
          record("r-2", "Beta Fuels"),
          record("r-3", "Gamma Transport"),
          record("r-4", "Delta Haulage"),
        ],
        cursor: null,
        drained: true,
      }),
      matchEntity: vi.fn(async (_db, request) => {
        return verdicts[request.sourceKeys![0]!.externalId] as never;
      }),
    });

    const result = await runIdentityMatchJob(
      { tenantId: TENANT, jobId: "job-1" },
      deps,
    );

    expect(result.status).toBe("succeeded");
    expect(result.metrics).toMatchObject({
      scanned: 4,
      autoLinked: 1,
      created: 1,
      casesFiled: 2,
      errors: 0,
    });
    // The auto-link wrote a rule-attributed mapping.
    const mappingInsert = fake.inserts.find(
      (write) => write.table === entitySourceMappings,
    );
    expect(mappingInsert?.values).toMatchObject({
      canonical_entity_id: "ce-1",
      source_system: "lastmile",
      external_id: "r-1",
      created_by: "rule",
    });
    // The job row carries the metrics (succeeded update).
    const succeeded = fake.updates.find(
      (update) =>
        update.table === identityMatchJobs &&
        update.values.status === "succeeded",
    );
    expect(succeeded?.values.metrics).toMatchObject({ autoLinked: 1 });
  });

  it("surfaces queue-budget displacement in metrics instead of silently expiring", async () => {
    const fake = createFakeIdentityDb();
    queuePreamble(fake, jobRow());
    fake.selectQueue.push([]); // stale sweep

    const deps = runDeps(fake, {
      fetchSourceRecords: vi.fn().mockResolvedValue({
        records: [record("r-9", "Omega Fuels")],
        cursor: null,
        drained: true,
      }),
      matchEntity: vi.fn().mockResolvedValue({
        kind: "suggestion",
        canonicalEntityId: "ce-9",
        matchedKeyKinds: ["name"],
      }),
      enforceBudgets: vi
        .fn()
        .mockResolvedValue({ expiredStale: 1, expiredOverBudget: 3 }),
    });

    const result = await runIdentityMatchJob(
      { tenantId: TENANT, jobId: "job-1" },
      deps,
    );

    expect(result.metrics.casesExpired).toBe(4);
    expect(result.metrics.casesExpiredOverBudget).toBe(3);
    const succeeded = fake.updates.find(
      (update) => update.values.status === "succeeded",
    );
    expect(succeeded?.values.metrics).toMatchObject({
      casesExpired: 4,
      casesExpiredOverBudget: 3,
    });
  });

  it("drift over a revoked pairing files at most one case (signature dedupe)", async () => {
    const fake = createFakeIdentityDb();
    queuePreamble(fake, jobRow({ trigger: "scheduled" }));
    fake.selectQueue.push([]); // stale sweep

    // The matcher demotes a rejected pairing to a suggestion (KTD-6,
    // matcher.test.ts); the second sighting coalesces onto the open case.
    const openCase = vi
      .fn()
      .mockResolvedValueOnce({ caseId: "case-1", coalesced: false })
      .mockResolvedValueOnce({ caseId: "case-1", coalesced: true });
    const deps = runDeps(fake, {
      fetchSourceRecords: vi.fn().mockResolvedValue({
        records: [record("r-7", "Revoked Co"), record("r-7", "Revoked Co")],
        cursor: null,
        drained: true,
      }),
      matchEntity: vi.fn().mockResolvedValue({
        kind: "suggestion",
        canonicalEntityId: "ce-7",
        matchedKeyKinds: ["name"],
      }),
      openCase,
    });

    const result = await runIdentityMatchJob(
      { tenantId: TENANT, jobId: "job-1" },
      deps,
    );

    expect(result.metrics.casesFiled).toBe(1);
    expect(result.metrics.casesCoalesced).toBe(1);
    expect(result.metrics.autoLinked).toBe(0);
    // No mapping write happened for the revoked pairing.
    expect(
      fake.inserts.filter((write) => write.table === entitySourceMappings),
    ).toHaveLength(0);
  });

  it("files a flagged case for a stale mapping and never auto-revokes", async () => {
    const fake = createFakeIdentityDb();
    queuePreamble(fake, jobRow({ trigger: "scheduled" }));
    // Stale sweep sees one mapping whose record was not in the drained scan.
    fake.selectQueue.push([
      {
        id: "map-1",
        namespace: "",
        external_id: "gone-1",
        canonical_entity_id: "ce-5",
      },
    ]);

    const openCase = vi
      .fn()
      .mockResolvedValue({ caseId: "case-stale", coalesced: false });
    const deps = runDeps(fake, {
      fetchSourceRecords: vi.fn().mockResolvedValue({
        records: [],
        cursor: null,
        drained: true,
      }),
      matchEntity: vi.fn(),
      openCase,
    });

    const result = await runIdentityMatchJob(
      { tenantId: TENANT, jobId: "job-1" },
      deps,
    );

    expect(result.metrics.staleMappings).toBe(1);
    expect(result.metrics.casesFiled).toBe(1);
    expect(openCase).toHaveBeenCalledWith(
      fake.db,
      expect.objectContaining({
        impactSummary: expect.objectContaining({
          staleMapping: true,
          mappingId: "map-1",
          externalId: "gone-1",
        }),
      }),
    );
    // Flag, never revoke: no mapping delete and no update touched mappings.
    expect(fake.deletes).toHaveLength(0);
    expect(
      fake.updates.filter((update) => update.table === entitySourceMappings),
    ).toHaveLength(0);
  });

  it("chains a continuation with a predecessor-derived dedupe key and cursors", async () => {
    const fake = createFakeIdentityDb();
    queuePreamble(fake, jobRow());
    // No stale sweep on an undrained scan.

    const startContinuation = vi
      .fn()
      .mockResolvedValue({ result: { deduped: false } });
    const deps = runDeps(fake, {
      fetchSourceRecords: vi.fn().mockResolvedValue({
        records: [record("r-1", "Acme Fuel")],
        cursor: { customer: "r-1" },
        drained: false,
      }),
      matchEntity: vi.fn().mockResolvedValue({
        kind: "exact",
        canonicalEntityId: "ce-1",
      }),
      startContinuation,
    });

    const result = await runIdentityMatchJob(
      { tenantId: TENANT, jobId: "job-1" },
      deps,
    );

    expect(result.metrics.continuationEnqueued).toBe(1);
    expect(startContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        dedupeKey: `identity-match:${TENANT}:manual:101`,
        sourceSystems: ["lastmile"],
        seedResult: expect.objectContaining({
          continuationOf: "job-1",
          cursors: { lastmile: { customer: "r-1" } },
        }),
      }),
    );
  });

  it("marks the job failed when the run throws before completion", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([jobRow()]);
    const deps = runDeps(fake, {
      fetchSourceRecords: vi.fn(),
      matchEntity: vi.fn(),
    });
    fake.selectQueue.push([{ source_system: "lastmile", connector_slug: "x" }]);
    // Force a failure inside the try block: reading the type slug throws.
    const badRow = {} as Record<string, unknown>;
    Object.defineProperty(badRow, "slug", {
      get() {
        throw new Error("boom mid-run");
      },
    });
    fake.selectQueue.push([badRow]);

    const result = await runIdentityMatchJob(
      { tenantId: TENANT, jobId: "job-1" },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("boom mid-run");
    const failed = fake.updates.find(
      (update) => update.values.status === "failed",
    );
    expect(failed).toBeDefined();
  });
});

describe("toIdentityMatchJob", () => {
  it("maps the row to the GraphQL shape with an uppercase status", () => {
    const mapped = toIdentityMatchJob(
      jobRow({ status: "succeeded", source_systems: ["lastmile"] }),
    );
    expect(mapped).toMatchObject({
      id: "job-1",
      tenantId: TENANT,
      status: "SUCCEEDED",
      sourceSystems: ["lastmile"],
    });
    expect(mapped.createdAt).toBe("2026-07-19T00:00:00.000Z");
  });
});
