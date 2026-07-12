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
  fenceMatches,
  isAttemptClaimable,
  processRetractionAttempt,
  resolveFailureTransition,
  retryBackoffAt,
  runSourceErase,
  type RetractionAttemptRow,
  type RetractionDerivation,
  type RetractionFence,
  type RetractionStore,
  type SourceEraseStore,
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
    lock_generation: 0,
    reconsolidation_note: null,
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
 * In-memory RetractionStore: one attempt row + a derivation, recording every
 * mutation in `events` so tests can assert saga ordering AND that fenced
 * transitions no-op when stale. Claim/failure semantics reuse the exported
 * pure helpers so the unit tests exercise the same transition rules the
 * drizzle store uses.
 */
function makeStore(
  row: RetractionAttemptRow,
  derivation: RetractionDerivation | null = makeDerivation(),
) {
  const events: string[] = [];
  let current = { ...row };
  let currentDerivation = derivation ? { ...derivation } : null;
  const fenced = (fence: RetractionFence) => fenceMatches(current, fence);
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
        lock_generation: current.lock_generation + 1,
        updated_at: opts.now,
      };
      events.push(`claim:${current.status}`);
      return { ...current };
    },
    async renewLease(attemptId, fence, now) {
      if (attemptId !== current.id || !fenced(fence)) return false;
      current = { ...current, locked_at: now };
      return true;
    },
    async recordProgress(attemptId, status, now, fence, opts) {
      if (attemptId !== current.id) throw new Error("unknown attempt");
      if (!fenced(fence)) {
        events.push(`staleProgress:${status}`);
        return "stale";
      }
      current = {
        ...current,
        status,
        reconsolidation_note:
          opts?.reconsolidationNote !== undefined
            ? opts.reconsolidationNote
            : current.reconsolidation_note,
        error_class: null,
        error_message: null,
        updated_at: now,
      };
      events.push(`progress:${status}`);
      return { ...current };
    },
    async finalizeInternalState(args) {
      if (!fenced(args.fence)) {
        events.push("staleFinalize");
        return "stale";
      }
      if (current.status !== "provider_deleted") {
        events.push("staleFinalize");
        return "stale";
      }
      if (currentDerivation) {
        currentDerivation = { ...currentDerivation, lifecycle: "retracted" };
      }
      current = {
        ...current,
        status: "supports_updated",
        updated_at: args.now,
      };
      events.push(
        `finalize:${args.providerDocumentId}:deleteEvidence=${args.deleteEvidence}`,
      );
      return { ...current };
    },
    async markRetracted(attemptId, now, fence) {
      if (attemptId !== current.id) throw new Error("unknown attempt");
      if (!fenced(fence)) {
        events.push("staleMarkRetracted");
        return "stale";
      }
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
    async markFailed(attempt, failure, now, fence) {
      if (!fenced(fence)) {
        events.push(`staleMarkFailed:${failure.errorClass}`);
        return "stale";
      }
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
      if (!currentDerivation) return null;
      return tenantId === currentDerivation.tenant_id &&
        derivationId === currentDerivation.id
        ? { ...currentDerivation }
        : null;
    },
  };
  return {
    store,
    events,
    get row() {
      return { ...current };
    },
    get derivation() {
      return currentDerivation ? { ...currentDerivation } : null;
    },
    /** Simulate a concurrent worker stealing the lease (fencing tests). */
    steal(lockedBy = "other-worker") {
      current = {
        ...current,
        locked_by: lockedBy,
        lock_generation: current.lock_generation + 1,
        locked_at: new Date(),
      };
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

describe("processRetractionAttempt saga ordering (provider delete FIRST)", () => {
  it("advances queued → running → provider_deleted → supports_updated → reconsolidated → retracted", async () => {
    const { store, events } = makeStore(makeAttempt());
    const adapter = makeAdapter();
    adapter.deleteDocument.mockImplementation(async () => {
      events.push("providerDelete");
      return "deleted";
    });

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(result.completed_at).not.toBeNull();
    expect(events).toEqual([
      "claim:running",
      "providerDelete",
      "progress:provider_deleted",
      `finalize:${DOCUMENT_ID}:deleteEvidence=false`,
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

  it("a provider-delete failure preserves internal state ACTIVE and stays due for retry", async () => {
    const { store, events, derivation, row } = makeStore(makeAttempt());
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
    // Nothing internal was retracted before the provider delete failed:
    // the derivation is still active and queryable, and no finalize ran.
    expect(derivation!.lifecycle).toBe("active");
    expect(events.some((e) => e.startsWith("finalize:"))).toBe(false);
    // The attempt is due again once next_retry_at passes.
    expect(result.next_retry_at).not.toBeNull();
    expect(
      isAttemptClaimable(row, new Date(result.next_retry_at!.getTime() + 1)),
    ).toBe(true);

    // A later successful retry completes and only then retracts internals.
    adapter.deleteDocument.mockResolvedValue("deleted");
    const retried = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
      { now: new Date(result.next_retry_at!.getTime() + 1) },
    );
    expect(retried.status).toBe("retracted");
    expect(events.filter((e) => e.startsWith("finalize:"))).toHaveLength(1);
  });

  it("re-entered at provider_deleted resumes at internal finalize (no second delete)", async () => {
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
      `finalize:${DOCUMENT_ID}:deleteEvidence=false`,
      "progress:reconsolidated",
      "markRetracted",
    ]);
    expect(adapter.deleteDocument).not.toHaveBeenCalled();
  });

  it("re-entered at supports_updated resumes at reconsolidation", async () => {
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

  it("scope 'source' finalizes with evidence deletion", async () => {
    const { store, events } = makeStore(makeAttempt({ scope: "source" }));
    const adapter = makeAdapter();

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(events).toContain(`finalize:${DOCUMENT_ID}:deleteEvidence=true`);
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
});

describe("saga worker fencing", () => {
  it("a stale worker's transitions no-op after a concurrent re-claim", async () => {
    const fixture = makeStore(makeAttempt());
    const adapter = makeAdapter();
    // While worker A awaits the provider delete, worker B steals the lease
    // (new locked_by + bumped lock_generation). A's subsequent fenced
    // transitions must all return "stale" and leave the row untouched.
    adapter.deleteDocument.mockImplementation(async () => {
      fixture.steal("worker-b");
      return "deleted";
    });

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store: fixture.store },
      ATTEMPT_ID,
      { lockedBy: "worker-a" },
    );

    // Worker A observed the conflict and returned the current row without
    // recording progress, failure, or finalize under B's claim.
    expect(fixture.row.locked_by).toBe("worker-b");
    expect(fixture.row.status).toBe("running");
    expect(result.locked_by).toBe("worker-b");
    expect(
      fixture.events.filter((e) => e.startsWith("progress:")),
    ).toHaveLength(0);
    expect(
      fixture.events.filter((e) => e.startsWith("markFailed:")),
    ).toHaveLength(0);
    expect(
      fixture.events.filter((e) => e.startsWith("finalize:")),
    ).toHaveLength(0);
  });

  it("a stale worker cannot clobber a failure transition either", async () => {
    const fixture = makeStore(makeAttempt());
    const adapter = makeAdapter();
    adapter.deleteDocument.mockImplementation(async () => {
      fixture.steal("worker-b");
      throw new HindsightRetainError({
        action: "deleteDocument",
        statusCode: 503,
        retryable: true,
        message: "boom",
      });
    });

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store: fixture.store },
      ATTEMPT_ID,
      { lockedBy: "worker-a" },
    );

    // markFailed was attempted with A's stale fence and no-oped.
    expect(fixture.events).toContain("staleMarkFailed:hindsight_503");
    expect(fixture.row.status).toBe("running");
    expect(fixture.row.locked_by).toBe("worker-b");
    expect(result.locked_by).toBe("worker-b");
  });

  it("fenceMatches requires both owner and generation", () => {
    const row = makeAttempt({ locked_by: "w1", lock_generation: 3 });
    expect(fenceMatches(row, { lockedBy: "w1", lockGeneration: 3 })).toBe(true);
    expect(fenceMatches(row, { lockedBy: "w1", lockGeneration: 2 })).toBe(
      false,
    );
    expect(fenceMatches(row, { lockedBy: "w2", lockGeneration: 3 })).toBe(
      false,
    );
  });

  it("renews the lease around the provider delete", async () => {
    const fixture = makeStore(makeAttempt());
    const adapter = makeAdapter();
    let lockedAtDuringDelete: Date | null = null;
    adapter.deleteDocument.mockImplementation(async () => {
      lockedAtDuringDelete = fixture.row.locked_at;
      return "deleted";
    });
    const claimTime = new Date("2026-07-11T00:00:00Z");
    await processRetractionAttempt(
      { db: noDb, adapter, store: fixture.store },
      ATTEMPT_ID,
      { now: claimTime },
    );
    // The lease was renewed (locked_at moved past the claim time) before
    // the external call.
    expect(lockedAtDuringDelete).not.toBeNull();
    expect(lockedAtDuringDelete!.getTime()).toBeGreaterThanOrEqual(
      claimTime.getTime(),
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
    const { store } = makeStore(makeAttempt());
    const adapter = makeAdapter();
    adapter.deleteDocument.mockResolvedValue("not_found");

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
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

  it("dead-letters when the derivation row is missing, WITHOUT provider delete", async () => {
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

describe("reconsolidation skip is recorded, not silently successful", () => {
  it("records skipped-with-reason when the adapter is delete-capable but has no consolidator", async () => {
    const fixture = makeStore(makeAttempt());
    const adapter = {
      deleteDocument: vi.fn().mockResolvedValue("deleted" as const),
      // no consolidateBankById
    };

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store: fixture.store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(fixture.row.reconsolidation_note).toMatch(/skipped/i);
    expect(fixture.row.reconsolidation_note).toMatch(/no consolidator/i);
  });

  it("leaves no note when reconsolidation actually ran", async () => {
    const fixture = makeStore(makeAttempt());
    const adapter = makeAdapter();

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store: fixture.store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("retracted");
    expect(fixture.row.reconsolidation_note).toBeNull();
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

// ---------------------------------------------------------------------------
// runSourceErase — durable erase AGGREGATE
// ---------------------------------------------------------------------------

describe("runSourceErase", () => {
  type EraseFixture = {
    pendingIds: string[];
    statusCounts: Record<string, number>;
    remainingDerivations: number;
    calls: string[];
  };

  function makeEraseStore(fx: EraseFixture): SourceEraseStore {
    return {
      async listPendingSourceAttemptIds(_t, _s, limit) {
        fx.calls.push(`list:${limit}`);
        return fx.pendingIds.slice(0, limit);
      },
      async countSourceAttemptsByStatus() {
        fx.calls.push("count");
        return { ...fx.statusCounts };
      },
      async countRemainingDerivations() {
        return fx.remainingDerivations;
      },
      async clearAndPurgeEvidence() {
        fx.calls.push("purgeEvidence");
        return { cleared: 3, deleted: 2 };
      },
      async deleteCheckpoints() {
        fx.calls.push("deleteCheckpoints");
      },
      async listEraseAggregatesNeedingCleanup() {
        return [];
      },
      async markEraseCompleted() {
        fx.calls.push("markEraseCompleted");
      },
      async markEraseFailed(_t, _s, reason) {
        fx.calls.push(`markEraseFailed:${reason.slice(0, 20)}`);
      },
    };
  }

  const baseDeps = () => ({
    db: noDb,
    adapter: makeAdapter(),
  });

  it("completes: processes attempts, deletes snapshots, purges evidence, then checkpoints — in order", async () => {
    const fx: EraseFixture = {
      pendingIds: ["a1", "a2"],
      statusCounts: { retracted: 2 },
      remainingDerivations: 0,
      calls: [],
    };
    const processed: string[] = [];
    const deleteSnapshots = vi.fn(async () => {
      fx.calls.push("deleteSnapshots");
      return 4;
    });

    const result = await runSourceErase(
      {
        ...baseDeps(),
        eraseStore: makeEraseStore(fx),
        enqueue: vi.fn(async () => ({ enqueued: 2 })),
        process: vi.fn(async (id: string) => {
          processed.push(id);
          return makeAttempt({ id, status: "retracted" });
        }),
        deleteSnapshots,
      },
      { tenantId: TENANT_ID, sourceConfigId: SOURCE_CONFIG_ID },
    );

    expect(processed).toEqual(["a1", "a2"]);
    expect(result.status).toBe("completed");
    expect(result.attempts).toEqual({
      total: 2,
      retracted: 2,
      pending: 0,
      deadLettered: 0,
      processedThisCall: 2,
    });
    expect(result.snapshotObjectsDeleted).toBe(4);
    expect(result.evidenceRowsCleared).toBe(3);
    expect(result.evidenceRowsDeleted).toBe(2);
    expect(result.checkpointsDeleted).toBe(true);
    // Cleanup strictly after processing, checkpoints strictly last.
    const order = fx.calls;
    expect(order.indexOf("deleteSnapshots")).toBeGreaterThan(
      order.indexOf("count"),
    );
    expect(order.indexOf("deleteCheckpoints")).toBeGreaterThan(
      order.indexOf("purgeEvidence"),
    );
    expect(order.indexOf("purgeEvidence")).toBeGreaterThan(
      order.indexOf("deleteSnapshots"),
    );
    // The durable erase marker is retired only after full cleanup.
    expect(order.indexOf("markEraseCompleted")).toBeGreaterThan(
      order.indexOf("deleteCheckpoints"),
    );
  });

  it("returns pending and performs NO cleanup while attempts remain non-terminal", async () => {
    const fx: EraseFixture = {
      pendingIds: ["a1"],
      statusCounts: { retracted: 1, failed: 1 },
      remainingDerivations: 1,
      calls: [],
    };
    const deleteSnapshots = vi.fn(async () => 0);

    const result = await runSourceErase(
      {
        ...baseDeps(),
        eraseStore: makeEraseStore(fx),
        enqueue: vi.fn(async () => ({ enqueued: 0 })),
        process: vi.fn(async (id: string) =>
          makeAttempt({ id, status: "failed" }),
        ),
        deleteSnapshots,
      },
      { tenantId: TENANT_ID, sourceConfigId: SOURCE_CONFIG_ID },
    );

    expect(result.status).toBe("pending");
    expect(result.attempts.pending).toBe(1);
    expect(deleteSnapshots).not.toHaveBeenCalled();
    expect(fx.calls).not.toContain("purgeEvidence");
    expect(fx.calls).not.toContain("deleteCheckpoints");
    expect(result.checkpointsDeleted).toBe(false);
  });

  it("surfaces dead-lettered children as failed and performs NO cleanup", async () => {
    const fx: EraseFixture = {
      pendingIds: [],
      statusCounts: { retracted: 1, dead_lettered: 2 },
      remainingDerivations: 0,
      calls: [],
    };
    const deleteSnapshots = vi.fn(async () => 0);

    const result = await runSourceErase(
      {
        ...baseDeps(),
        eraseStore: makeEraseStore(fx),
        enqueue: vi.fn(async () => ({ enqueued: 0 })),
        process: vi.fn(),
        deleteSnapshots,
      },
      { tenantId: TENANT_ID, sourceConfigId: SOURCE_CONFIG_ID },
    );

    expect(result.status).toBe("failed");
    expect(result.attempts.deadLettered).toBe(2);
    expect(deleteSnapshots).not.toHaveBeenCalled();
    expect(fx.calls).not.toContain("deleteCheckpoints");
    // The erase marker is dead-lettered too — never silently pending.
    expect(fx.calls.some((c) => c.startsWith("markEraseFailed:"))).toBe(true);
    expect(fx.calls).not.toContain("markEraseCompleted");
  });

  it("returns pending (marker kept alive) when the cleanup phase fails, without deleting checkpoints", async () => {
    const fx: EraseFixture = {
      pendingIds: [],
      statusCounts: { retracted: 2 },
      remainingDerivations: 0,
      calls: [],
    };
    const result = await runSourceErase(
      {
        ...baseDeps(),
        eraseStore: makeEraseStore(fx),
        enqueue: vi.fn(async () => ({ enqueued: 0 })),
        process: vi.fn(),
        deleteSnapshots: vi.fn(async () => {
          throw new Error("s3 unavailable");
        }),
      },
      { tenantId: TENANT_ID, sourceConfigId: SOURCE_CONFIG_ID },
    );

    expect(result.status).toBe("pending");
    expect(result.checkpointsDeleted).toBe(false);
    // Checkpoints are NEVER deleted before S3 + evidence cleanup succeed,
    // and the marker is not retired, so the drainer retries later.
    expect(fx.calls).not.toContain("deleteCheckpoints");
    expect(fx.calls).not.toContain("markEraseCompleted");
  });

  it("bounds inline processing by maxInlineAttempts", async () => {
    const fx: EraseFixture = {
      pendingIds: ["a1", "a2", "a3", "a4", "a5"],
      statusCounts: { retracted: 2, queued: 3 },
      remainingDerivations: 3,
      calls: [],
    };
    const process = vi.fn(async (id: string) =>
      makeAttempt({ id, status: "retracted" }),
    );

    const result = await runSourceErase(
      {
        ...baseDeps(),
        eraseStore: makeEraseStore(fx),
        enqueue: vi.fn(async () => ({ enqueued: 5 })),
        process,
        deleteSnapshots: vi.fn(async () => 0),
        maxInlineAttempts: 2,
      },
      { tenantId: TENANT_ID, sourceConfigId: SOURCE_CONFIG_ID },
    );

    expect(process).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("pending");
    expect(result.attempts.processedThisCall).toBe(2);
  });

  it("keeps draining when one inline attempt throws", async () => {
    const fx: EraseFixture = {
      pendingIds: ["a1", "a2"],
      statusCounts: { retracted: 1, failed: 1 },
      remainingDerivations: 1,
      calls: [],
    };
    const process = vi
      .fn<(id: string) => Promise<RetractionAttemptRow>>()
      .mockRejectedValueOnce(new Error("attempt vanished"))
      .mockResolvedValueOnce(makeAttempt({ id: "a2", status: "retracted" }));

    const result = await runSourceErase(
      {
        ...baseDeps(),
        eraseStore: makeEraseStore(fx),
        enqueue: vi.fn(async () => ({ enqueued: 0 })),
        process,
        deleteSnapshots: vi.fn(async () => 0),
      },
      { tenantId: TENANT_ID, sourceConfigId: SOURCE_CONFIG_ID },
    );

    expect(process).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Multi-edition document erase (Codex P1: shared provider_document_id)
// ---------------------------------------------------------------------------

describe("erase of a source whose derivations share one stable provider document", () => {
  it("reaches 'completed' from ONE erase invocation — the single document attempt finalizes all 3 derivations", async () => {
    // World: 3 derivations (editions) of one stable external document. The
    // partial unique memory_retraction_attempts_document_uidx allows only
    // one non-terminal attempt per (tenant, provider, document), so the
    // enqueue can insert exactly ONE attempt for all of them.
    const derivations = [
      makeDerivation({
        id: "d1",
        evidence_item_id: "e1",
        lifecycle: "superseded",
      }),
      makeDerivation({
        id: "d2",
        evidence_item_id: "e2",
        lifecycle: "superseded",
      }),
      makeDerivation({ id: "d3", evidence_item_id: "e3", lifecycle: "active" }),
    ];
    const attempts: RetractionAttemptRow[] = [];
    let checkpointsDeleted = false;

    const enqueue = async () => {
      let enqueued = 0;
      for (const d of derivations) {
        if (d.lifecycle !== "active" && d.lifecycle !== "superseded") continue;
        const nonTerminal = attempts.find(
          (a) =>
            a.provider_document_id === d.hindsight_document_id &&
            a.status !== "retracted" &&
            a.status !== "dead_lettered",
        );
        if (nonTerminal) continue; // partial unique document index
        attempts.push(
          makeAttempt({
            id: `attempt-${attempts.length + 1}`,
            scope: "source",
            derivation_id: d.id,
            provider_document_id: d.hindsight_document_id,
          }),
        );
        enqueued += 1;
      }
      return { enqueued };
    };

    const findAttempt = (id: string) => attempts.find((a) => a.id === id);
    const worldStore: RetractionStore = {
      async loadAttempt(id) {
        const a = findAttempt(id);
        return a ? { ...a } : null;
      },
      async claimAttempt(id, opts) {
        const a = findAttempt(id);
        if (!a || !isAttemptClaimable(a, opts.now)) return null;
        if (a.status === "queued" || a.status === "failed")
          a.status = "running";
        a.attempt_count += 1;
        a.locked_at = opts.now;
        a.locked_by = opts.lockedBy;
        a.lock_generation += 1;
        return { ...a };
      },
      async renewLease(id, fence, now) {
        const a = findAttempt(id);
        if (!a || !fenceMatches(a, fence)) return false;
        a.locked_at = now;
        return true;
      },
      async recordProgress(id, status, now, fence, opts) {
        const a = findAttempt(id);
        if (!a || !fenceMatches(a, fence)) return "stale";
        a.status = status;
        if (opts?.reconsolidationNote !== undefined) {
          a.reconsolidation_note = opts.reconsolidationNote;
        }
        a.updated_at = now;
        return { ...a };
      },
      async finalizeInternalState(args) {
        const a = findAttempt(args.attemptId);
        if (!a || !fenceMatches(a, args.fence)) return "stale";
        if (a.status !== "provider_deleted") return "stale";
        // Fix under test: EVERY derivation sharing the deleted document is
        // finalized by this single attempt.
        for (const d of derivations) {
          if (
            d.hindsight_document_id === args.providerDocumentId &&
            (d.lifecycle === "active" || d.lifecycle === "superseded")
          ) {
            d.lifecycle = "retracted";
          }
        }
        a.status = "supports_updated";
        a.updated_at = args.now;
        return { ...a };
      },
      async markRetracted(id, now, fence) {
        const a = findAttempt(id);
        if (!a || !fenceMatches(a, fence)) return "stale";
        a.status = "retracted";
        a.locked_at = null;
        a.locked_by = null;
        a.completed_at = now;
        return { ...a };
      },
      async markFailed(attempt, failure, now, fence) {
        const a = findAttempt(attempt.id);
        if (!a || !fenceMatches(a, fence)) return "stale";
        const transition = resolveFailureTransition(attempt, failure, now);
        a.status = transition.status;
        a.next_retry_at = transition.nextRetryAt;
        a.locked_at = null;
        a.locked_by = null;
        a.error_class = failure.errorClass;
        a.error_message = failure.errorMessage;
        a.completed_at = transition.completedAt;
        return { ...a };
      },
      async loadDerivation(_tenantId, derivationId) {
        const d = derivations.find((x) => x.id === derivationId);
        return d ? { ...d } : null;
      },
    };

    const eraseStore: SourceEraseStore = {
      async listPendingSourceAttemptIds(_t, _s, limit) {
        return attempts
          .filter(
            (a) =>
              a.scope === "source" &&
              a.status !== "retracted" &&
              a.status !== "dead_lettered",
          )
          .slice(0, limit)
          .map((a) => a.id);
      },
      async countSourceAttemptsByStatus() {
        const counts: Record<string, number> = {};
        for (const a of attempts) {
          if (a.scope !== "source") continue;
          counts[a.status] = (counts[a.status] ?? 0) + 1;
        }
        return counts;
      },
      async countRemainingDerivations() {
        return derivations.filter(
          (d) => d.lifecycle === "active" || d.lifecycle === "superseded",
        ).length;
      },
      async clearAndPurgeEvidence() {
        return { cleared: 3, deleted: 0 };
      },
      async deleteCheckpoints() {
        checkpointsDeleted = true;
      },
      async listEraseAggregatesNeedingCleanup() {
        return [];
      },
      async markEraseCompleted() {},
      async markEraseFailed() {},
    };

    const adapter = makeAdapter();
    const result = await runSourceErase(
      {
        db: noDb,
        adapter,
        eraseStore,
        enqueue,
        process: (attemptId) =>
          processRetractionAttempt(
            { db: noDb, adapter, store: worldStore },
            attemptId,
            { lockedBy: "memory-source-erase" },
          ),
        deleteSnapshots: vi.fn(async () => 3),
      },
      { tenantId: TENANT_ID, sourceConfigId: SOURCE_CONFIG_ID },
    );

    // The partial unique produced exactly one attempt…
    expect(attempts).toHaveLength(1);
    // …one provider delete…
    expect(adapter.deleteDocument).toHaveBeenCalledTimes(1);
    // …which finalized ALL derivations sharing the document,
    expect(derivations.map((d) => d.lifecycle)).toEqual([
      "retracted",
      "retracted",
      "retracted",
    ]);
    // so the erase completes in one invocation with no manual re-enqueue.
    expect(result.status).toBe("completed");
    expect(result.attempts).toMatchObject({
      total: 1,
      retracted: 1,
      pending: 0,
      deadLettered: 0,
    });
    expect(checkpointsDeleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Drizzle finalize scoping regression (Codex: colliding provider_document_id
// across source configs must never retract another source's lineages)
// ---------------------------------------------------------------------------

describe("createDrizzleRetractionStore.finalizeInternalState source scoping", () => {
  it("selects lineages pinned to the attempt's OWN source config and only retracts those ids", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const render = (cond: unknown) =>
      dialect.sqlToQuery(cond as never) as { sql: string; params: unknown[] };

    const SOURCE_A = SOURCE_CONFIG_ID;
    const SOURCE_B = "b6e21c11-9d2f-4f6a-8f7f-2a1b3c4d5e6f";
    // Two sources share the same tenant + hindsight_document_id; only
    // source A's lineage is returned by the (correctly scoped) select.
    const lineageA = {
      id: "deriv-a",
      source_config_id: SOURCE_A,
      evidence_item_id: "evi-a",
    };

    type Recorded = { kind: string; cond: unknown };
    const recorded: Recorded[] = [];
    let updateCall = 0;
    const tx = {
      update: () => ({
        set: () => ({
          where: (cond: unknown) => {
            updateCall += 1;
            const kind = `update#${updateCall}`;
            recorded.push({ kind, cond });
            const thenable = Promise.resolve([]);
            return Object.assign(thenable, {
              returning: async () =>
                updateCall === 1
                  ? [makeAttempt({ status: "supports_updated" })]
                  : [],
            });
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: async (cond: unknown) => {
            recorded.push({ kind: "select-lineages", cond });
            return [lineageA];
          },
        }),
      }),
    };
    const db = {
      transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    } as never;

    const { createDrizzleRetractionStore } = await import("./retraction.js");
    const store = createDrizzleRetractionStore(db);
    const result = await store.finalizeInternalState({
      attemptId: ATTEMPT_ID,
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_A,
      providerDocumentId: DOCUMENT_ID,
      deleteEvidence: true,
      now: new Date(),
      fence: { lockedBy: "w", lockGeneration: 1 },
    });
    expect(result).not.toBe("stale");

    // The lineage select is scoped to tenant AND the attempt's source
    // config AND the document — source B can never be swept in.
    const lineageSelect = recorded.find((r) => r.kind === "select-lineages");
    expect(lineageSelect).toBeDefined();
    const rendered = render(lineageSelect!.cond);
    expect(rendered.sql).toContain('"source_config_id" =');
    expect(rendered.params).toContain(SOURCE_A);
    expect(rendered.params).toContain(TENANT_ID);
    expect(rendered.params).toContain(DOCUMENT_ID);
    expect(rendered.params).not.toContain(SOURCE_B);

    // Derivation + evidence updates are keyed strictly to the ids the
    // scoped select returned (source A's lineage only).
    const derivUpdate = render(
      recorded.find((r) => r.kind === "update#3")!.cond,
    );
    expect(derivUpdate.params).toContain("deriv-a");
    const evidenceUpdate = render(
      recorded.find((r) => r.kind === "update#4")!.cond,
    );
    expect(evidenceUpdate.params).toContain("evi-a");
  });
});
