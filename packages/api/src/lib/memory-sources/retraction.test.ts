import { describe, expect, it, vi } from "vitest";

// claims.ts is being written in parallel (U2); the drizzle store imports it.
// Unit tests here run against the in-memory store, so the module is mocked
// out entirely.
vi.mock("./claims.js", () => ({
  deactivateOrphanedClaims: vi.fn().mockResolvedValue(0),
}));

import { HindsightRetainError } from "../memory/adapters/hindsight-adapter.js";
import {
  enqueueDerivationRetraction,
  isAttemptClaimable,
  processRetractionAttempt,
  resolveFailureTransition,
  retryBackoffAt,
  type RetractionAttemptRow,
  type RetractionDerivation,
  type RetractionStore,
} from "./retraction.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SOURCE_CONFIG_ID = "7f4b2a90-11a2-4a5f-9d1b-3c8e5f6a7b8c";
const DERIVATION_ID = "3d3c7c58-3b2f-4a4e-9a5f-1c2d3e4f5a6b";
const EVIDENCE_ITEM_ID = "9a8b7c6d-5e4f-4a3b-8c9d-0e1f2a3b4c5d";
const ATTEMPT_ID = "11111111-2222-4333-8444-555555555555";
const DOCUMENT_ID = `external:${SOURCE_CONFIG_ID}:company:twenty-co-1`;
const BANK_ID = `tenant_${TENANT_ID}`;

function makeAttempt(
  overrides: Partial<RetractionAttemptRow> = {},
): RetractionAttemptRow {
  const now = new Date("2026-07-11T00:00:00Z");
  return {
    id: ATTEMPT_ID,
    tenant_id: TENANT_ID,
    scope: "derivation",
    derivation_id: DERIVATION_ID,
    source_config_id: SOURCE_CONFIG_ID,
    provider: "hindsight",
    provider_document_id: DOCUMENT_ID,
    target_bank_id: BANK_ID,
    status: "queued",
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: now,
    locked_at: null,
    locked_by: null,
    error_class: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    ...overrides,
  } as RetractionAttemptRow;
}

function makeDerivation(
  overrides: Partial<RetractionDerivation> = {},
): RetractionDerivation {
  return {
    id: DERIVATION_ID,
    tenant_id: TENANT_ID,
    source_config_id: SOURCE_CONFIG_ID,
    evidence_item_id: EVIDENCE_ITEM_ID,
    projection_key: "company:twenty-co-1",
    target_bank_id: BANK_ID,
    hindsight_document_id: DOCUMENT_ID,
    lifecycle: "active",
    ...overrides,
  } as RetractionDerivation;
}

/**
 * In-memory RetractionStore: one row + a derivation, recording every
 * mutation in `events` so tests can assert saga ordering. Claim/failure
 * semantics reuse the exported pure helpers so the unit tests exercise the
 * same transition rules the drizzle store uses.
 */
function makeStore(
  row: RetractionAttemptRow,
  derivation: RetractionDerivation | null = makeDerivation(),
) {
  const events: string[] = [];
  let current = { ...row };
  const store: RetractionStore = {
    async loadAttempt(attemptId) {
      return attemptId === current.id ? { ...current } : null;
    },
    async claimAttempt(attemptId, opts) {
      if (attemptId !== current.id) return null;
      if (!isAttemptClaimable(current, opts.now)) return null;
      current = {
        ...current,
        status:
          current.status === "queued" || current.status === "failed"
            ? "running"
            : current.status,
        attempt_count: current.attempt_count + 1,
        locked_at: opts.now,
        locked_by: opts.lockedBy,
        updated_at: opts.now,
      };
      events.push(`claim:${current.status}`);
      return { ...current };
    },
    async recordProgress(attemptId, status, now) {
      if (attemptId !== current.id) throw new Error("unknown attempt");
      current = { ...current, status, updated_at: now };
      events.push(`progress:${status}`);
      return { ...current };
    },
    async markRetracted(attemptId, now) {
      if (attemptId !== current.id) throw new Error("unknown attempt");
      current = {
        ...current,
        status: "retracted",
        next_retry_at: null,
        locked_at: null,
        locked_by: null,
        completed_at: now,
        updated_at: now,
      };
      events.push("markRetracted");
      return { ...current };
    },
    async markFailed(attempt, failure, now) {
      const transition = resolveFailureTransition(attempt, failure, now);
      current = {
        ...current,
        status: transition.status,
        next_retry_at: transition.nextRetryAt,
        locked_at: null,
        locked_by: null,
        completed_at: transition.completedAt,
        error_class: failure.errorClass,
        error_message: failure.errorMessage,
        updated_at: now,
      };
      events.push(`markFailed:${transition.status}:${failure.errorClass}`);
      return { ...current };
    },
    async loadDerivation(tenantId, derivationId) {
      if (!derivation) return null;
      return tenantId === derivation.tenant_id && derivationId === derivation.id
        ? { ...derivation }
        : null;
    },
    async retractSupports(args) {
      events.push(
        `retractSupports:${args.evidenceItemId}:deleteEvidence=${args.deleteEvidence}`,
      );
    },
  };
  return {
    store,
    events,
    get row() {
      return { ...current };
    },
  };
}

function makeAdapter() {
  return {
    deleteDocument: vi
      .fn<
        (req: {
          tenantId: string;
          ownerType: "user" | "agent" | "space" | "tenant";
          ownerId: string;
          documentId: string;
        }) => Promise<"deleted" | "not_found">
      >()
      .mockResolvedValue("deleted"),
    consolidateBankById: vi.fn<(bankId: string) => Promise<void>>(),
  };
}

const noDb = null as never;

describe("processRetractionAttempt saga ordering", () => {
  it("advances queued → running → supports_updated → provider_deleted → reconsolidated → retracted in order", async () => {
    const { store, events } = makeStore(makeAttempt());
    const adapter = makeAdapter();

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(result.completed_at).not.toBeNull();
    expect(events).toEqual([
      "claim:running",
      `retractSupports:${EVIDENCE_ITEM_ID}:deleteEvidence=false`,
      "progress:supports_updated",
      "progress:provider_deleted",
      "progress:reconsolidated",
      "markRetracted",
    ]);
    expect(adapter.deleteDocument).toHaveBeenCalledExactlyOnceWith({
      tenantId: TENANT_ID,
      ownerType: "tenant",
      ownerId: TENANT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(adapter.consolidateBankById).toHaveBeenCalledExactlyOnceWith(
      BANK_ID,
    );
  });

  it("prefers deps.consolidate over adapter.consolidateBankById", async () => {
    const { store } = makeStore(makeAttempt());
    const adapter = makeAdapter();
    const consolidate = vi.fn().mockResolvedValue(undefined);

    const result = await processRetractionAttempt(
      { db: noDb, adapter, consolidate, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(consolidate).toHaveBeenCalledExactlyOnceWith(TENANT_ID, BANK_ID);
    expect(adapter.consolidateBankById).not.toHaveBeenCalled();
  });

  it("re-entered at supports_updated resumes at provider delete (no support re-retraction)", async () => {
    const { store, events } = makeStore(
      makeAttempt({ status: "supports_updated", attempt_count: 1 }),
    );
    const adapter = makeAdapter();

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(events).toEqual([
      "claim:supports_updated",
      "progress:provider_deleted",
      "progress:reconsolidated",
      "markRetracted",
    ]);
    expect(adapter.deleteDocument).toHaveBeenCalledTimes(1);
  });

  it("re-entered at provider_deleted resumes at reconsolidation (no second delete)", async () => {
    const { store, events } = makeStore(
      makeAttempt({ status: "provider_deleted", attempt_count: 1 }),
    );
    const adapter = makeAdapter();

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(events).toEqual([
      "claim:provider_deleted",
      "progress:reconsolidated",
      "markRetracted",
    ]);
    expect(adapter.deleteDocument).not.toHaveBeenCalled();
    expect(adapter.consolidateBankById).toHaveBeenCalledTimes(1);
  });

  it("re-entered at reconsolidated only finalizes", async () => {
    const { store, events } = makeStore(
      makeAttempt({ status: "reconsolidated", attempt_count: 1 }),
    );
    const adapter = makeAdapter();

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(events).toEqual(["claim:reconsolidated", "markRetracted"]);
    expect(adapter.deleteDocument).not.toHaveBeenCalled();
    expect(adapter.consolidateBankById).not.toHaveBeenCalled();
  });

  it("returns the current row unchanged when the claim loses (terminal row)", async () => {
    const { store, events } = makeStore(
      makeAttempt({ status: "retracted", completed_at: new Date() }),
    );
    const adapter = makeAdapter();

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(events).toEqual([]);
    expect(adapter.deleteDocument).not.toHaveBeenCalled();
  });

  it("scope 'source' retracts supports with evidence deletion", async () => {
    const { store, events } = makeStore(makeAttempt({ scope: "source" }));
    const adapter = makeAdapter();

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(events).toContain(
      `retractSupports:${EVIDENCE_ITEM_ID}:deleteEvidence=true`,
    );
  });
});

describe("processRetractionAttempt failure handling", () => {
  it("dead-letters with unsupported_engine when the adapter lacks deleteDocument", async () => {
    const { store } = makeStore(makeAttempt());
    const adapter = { consolidateBankById: vi.fn() };

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("dead_lettered");
    expect(result.error_class).toBe("unsupported_engine");
    expect(result.next_retry_at).toBeNull();
  });

  it('advances on "not_found" (idempotent provider delete)', async () => {
    const { store } = makeStore(
      makeAttempt({ status: "supports_updated", attempt_count: 1 }),
    );
    const adapter = makeAdapter();
    adapter.deleteDocument.mockResolvedValue("not_found");

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
  });

  it("marks failed with a due next_retry_at on a retryable 5xx, and the attempt is reclaimable", async () => {
    const { store, row } = makeStore(makeAttempt());
    const adapter = makeAdapter();
    adapter.deleteDocument.mockRejectedValue(
      new HindsightRetainError({
        action: "deleteDocument",
        statusCode: 503,
        retryable: true,
        message: "hindsight deleteDocument 503: upstream unavailable",
      }),
    );

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("failed");
    expect(result.error_class).toBe("hindsight_503");
    expect(result.next_retry_at).not.toBeNull();
    expect(result.next_retry_at!.getTime()).toBeGreaterThan(Date.now());
    // Requeueable: once next_retry_at passes, the claim succeeds again.
    expect(
      isAttemptClaimable(row, new Date(result.next_retry_at!.getTime() + 1)),
    ).toBe(true);

    // And the retry resumes from the top with an idempotent step 2.
    adapter.deleteDocument.mockResolvedValue("deleted");
    const retried = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
      { now: new Date(result.next_retry_at!.getTime() + 1) },
    );
    expect(retried.status).toBe("retracted");
  });

  it("dead-letters on a non-retryable 4xx", async () => {
    const { store } = makeStore(makeAttempt());
    const adapter = makeAdapter();
    adapter.deleteDocument.mockRejectedValue(
      new HindsightRetainError({
        action: "deleteDocument",
        statusCode: 403,
        retryable: false,
        message: "hindsight deleteDocument 403: forbidden",
      }),
    );

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("dead_lettered");
    expect(result.error_class).toBe("hindsight_403");
  });

  it("dead-letters when the derivation row is missing", async () => {
    const { store } = makeStore(makeAttempt(), null);
    const adapter = makeAdapter();

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("dead_lettered");
    expect(result.error_class).toBe("derivation_missing");
    expect(adapter.deleteDocument).not.toHaveBeenCalled();
  });

  it("dead-letters retryable failures once attempts are exhausted", async () => {
    const { store } = makeStore(
      makeAttempt({ attempt_count: 4, max_attempts: 5 }),
    );
    const adapter = makeAdapter();
    adapter.deleteDocument.mockRejectedValue(
      new HindsightRetainError({
        action: "deleteDocument",
        statusCode: 503,
        retryable: true,
        message: "hindsight deleteDocument 503: down",
      }),
    );

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("dead_lettered");
  });
});

describe("claim/backoff helpers", () => {
  const now = new Date("2026-07-11T12:00:00Z");

  it("claims queued/failed rows only when due", () => {
    expect(isAttemptClaimable(makeAttempt({ next_retry_at: now }), now)).toBe(
      true,
    );
    expect(
      isAttemptClaimable(
        makeAttempt({ status: "failed", next_retry_at: null }),
        now,
      ),
    ).toBe(true);
    expect(
      isAttemptClaimable(
        makeAttempt({
          status: "failed",
          next_retry_at: new Date(now.getTime() + 60_000),
        }),
        now,
      ),
    ).toBe(false);
  });

  it("claims in-flight rows only when the lock is absent or stale", () => {
    const fresh = new Date(now.getTime() - 60_000);
    const stale = new Date(now.getTime() - 7 * 60_000);
    expect(
      isAttemptClaimable(
        makeAttempt({ status: "running", locked_at: fresh, attempt_count: 1 }),
        now,
      ),
    ).toBe(false);
    expect(
      isAttemptClaimable(
        makeAttempt({ status: "running", locked_at: stale, attempt_count: 1 }),
        now,
      ),
    ).toBe(true);
    expect(
      isAttemptClaimable(
        makeAttempt({
          status: "supports_updated",
          locked_at: null,
          attempt_count: 1,
        }),
        now,
      ),
    ).toBe(true);
  });

  it("never claims terminal or exhausted rows", () => {
    expect(isAttemptClaimable(makeAttempt({ status: "retracted" }), now)).toBe(
      false,
    );
    expect(
      isAttemptClaimable(makeAttempt({ status: "dead_lettered" }), now),
    ).toBe(false);
    expect(
      isAttemptClaimable(
        makeAttempt({ attempt_count: 5, max_attempts: 5 }),
        now,
      ),
    ).toBe(false);
  });

  it("backs off attempt_count^2 minutes", () => {
    expect(retryBackoffAt(1, now).getTime() - now.getTime()).toBe(60_000);
    expect(retryBackoffAt(3, now).getTime() - now.getTime()).toBe(9 * 60_000);
  });
});

describe("enqueueDerivationRetraction", () => {
  type FakeDbState = {
    derivation: Record<string, unknown> | null;
    insertReturn: RetractionAttemptRow[];
    existing: RetractionAttemptRow[];
    insertedValues: Array<Record<string, unknown>>;
    selectCount: number;
  };

  function fakeDb(state: FakeDbState) {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              state.selectCount += 1;
              return state.selectCount === 1
                ? state.derivation
                  ? [state.derivation]
                  : []
                : state.existing;
            },
          }),
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          state.insertedValues.push(v);
          return {
            onConflictDoNothing: () => ({
              returning: async () => state.insertReturn,
            }),
          };
        },
      }),
    } as never;
  }

  const derivationRow = {
    id: DERIVATION_ID,
    tenant_id: TENANT_ID,
    source_config_id: SOURCE_CONFIG_ID,
    evidence_item_id: EVIDENCE_ITEM_ID,
    target_bank_id: BANK_ID,
    hindsight_document_id: DOCUMENT_ID,
    lifecycle: "active",
  };

  it("inserts a queued attempt keyed on the derivation's provider document", async () => {
    const inserted = makeAttempt();
    const state: FakeDbState = {
      derivation: derivationRow,
      insertReturn: [inserted],
      existing: [],
      insertedValues: [],
      selectCount: 0,
    };

    const row = await enqueueDerivationRetraction(fakeDb(state), {
      tenantId: TENANT_ID,
      derivationId: DERIVATION_ID,
    });

    expect(row).toEqual(inserted);
    expect(state.insertedValues[0]).toMatchObject({
      tenant_id: TENANT_ID,
      scope: "derivation",
      derivation_id: DERIVATION_ID,
      source_config_id: SOURCE_CONFIG_ID,
      provider: "hindsight",
      provider_document_id: DOCUMENT_ID,
      target_bank_id: BANK_ID,
      status: "queued",
    });
  });

  it("is idempotent per document: a conflicting insert returns the existing non-terminal attempt", async () => {
    const existing = makeAttempt({ status: "failed", attempt_count: 2 });
    const state: FakeDbState = {
      derivation: derivationRow,
      insertReturn: [],
      existing: [existing],
      insertedValues: [],
      selectCount: 0,
    };

    const row = await enqueueDerivationRetraction(fakeDb(state), {
      tenantId: TENANT_ID,
      derivationId: DERIVATION_ID,
    });

    expect(row).toEqual(existing);
  });

  it("returns null for a missing or already-retracted derivation", async () => {
    const missing: FakeDbState = {
      derivation: null,
      insertReturn: [],
      existing: [],
      insertedValues: [],
      selectCount: 0,
    };
    await expect(
      enqueueDerivationRetraction(fakeDb(missing), {
        tenantId: TENANT_ID,
        derivationId: DERIVATION_ID,
      }),
    ).resolves.toBeNull();
    expect(missing.insertedValues).toHaveLength(0);

    const retracted: FakeDbState = {
      derivation: { ...derivationRow, lifecycle: "retracted" },
      insertReturn: [],
      existing: [],
      insertedValues: [],
      selectCount: 0,
    };
    await expect(
      enqueueDerivationRetraction(fakeDb(retracted), {
        tenantId: TENANT_ID,
        derivationId: DERIVATION_ID,
      }),
    ).resolves.toBeNull();
    expect(retracted.insertedValues).toHaveLength(0);
  });
});
