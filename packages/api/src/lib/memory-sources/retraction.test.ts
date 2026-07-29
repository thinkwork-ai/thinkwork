import { describe, expect, it, vi } from "vitest";

// claims.ts is being written in parallel (U2); the drizzle store imports it.
// Unit tests here run against the in-memory store, so the module is mocked
// out entirely.
vi.mock("./claims.js", () => ({
  deactivateOrphanedClaims: vi.fn().mockResolvedValue(0),
  // U6 email exports pulled in via the adapter registry module graph.
  extractWebPageClaims: vi.fn(() => []),
  extractEmailThreadClaims: vi.fn(() => []),
  subjectKeyForEmailThread: (threadId: string) => `email:thread:${threadId}`,
  boundedInlineText: (value: string) => value,
}));

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
    erase_generation: 0,
    cleanup_phase: null,
    cleanup_cursor: null,
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
      new Error("deleteDocument failed: upstream unavailable"),
    );

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store },
      ATTEMPT_ID,
    );

    expect(result.status).toBe("failed");
    // Unrecognized provider errors classify as retryable "unknown".
    expect(result.error_class).toBe("unknown");
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
      throw new Error("boom");
    });

    const result = await processRetractionAttempt(
      { db: noDb, adapter, store: fixture.store },
      ATTEMPT_ID,
      { lockedBy: "worker-a" },
    );

    // markFailed was attempted with A's stale fence and no-oped.
    expect(fixture.events).toContain("staleMarkFailed:unknown");
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

  it("dead-letters non-retryable failures immediately, with no backoff", () => {
    const transition = resolveFailureTransition(
      makeAttempt({ attempt_count: 1, max_attempts: 5 }),
      {
        errorClass: "unsupported_engine",
        errorMessage: "engine cannot delete documents",
        retryable: false,
      },
      new Date("2026-07-11T12:00:00Z"),
    );

    expect(transition.status).toBe("dead_lettered");
    expect(transition.nextRetryAt).toBeNull();
    expect(transition.completedAt).not.toBeNull();
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
      new Error("deleteDocument failed: down"),
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
// runSourceErase — durable erase AGGREGATE (rounds 3-7 semantics)
// ---------------------------------------------------------------------------

type EraseHarnessOpts = {
  markerStatus?: string;
  markerGeneration?: number;
  markerPhase?: string | null;
  markerCursor?: string | null;
  markerAttemptCount?: number;
  markerMaxAttempts?: number;
  /** status counts keyed by erase generation. */
  countsByGeneration?: Record<number, Record<string, number>>;
  remainingDerivations?: number;
  pendingIds?: string[];
  /** Scripted purge responses, consumed per call. */
  purgeResponses?: Array<{ deleted: number; nextCursor: string | null }>;
  /** When true, claimEraseMarker returns null (another claimant). */
  claimLost?: boolean;
};

function makeEraseHarness(opts: EraseHarnessOpts = {}) {
  const calls: string[] = [];
  const marker = makeAttempt({
    id: "marker-1",
    scope: "erase",
    status: opts.markerStatus ?? "queued",
    erase_generation: opts.markerGeneration ?? 1,
    cleanup_phase: (opts.markerPhase ?? null) as never,
    cleanup_cursor: (opts.markerCursor ?? null) as never,
    attempt_count: opts.markerAttemptCount ?? 0,
    max_attempts: opts.markerMaxAttempts ?? 5,
    provider: "erase_aggregate",
    provider_document_id: `erase:${SOURCE_CONFIG_ID}`,
  });
  const purgeResponses = [
    ...(opts.purgeResponses ?? [{ deleted: 0, nextCursor: null }]),
  ];
  const countsByGeneration = opts.countsByGeneration ?? {};

  const eraseStore: SourceEraseStore = {
    async listPendingSourceAttemptIds(_t, _s, limit) {
      calls.push(`list:${limit}`);
      return (opts.pendingIds ?? []).slice(0, limit);
    },
    async countSourceAttemptsByStatus(_t, _s, generation) {
      calls.push(`count:gen=${generation}`);
      return { ...(countsByGeneration[generation] ?? {}) };
    },
    async countRemainingDerivations() {
      return opts.remainingDerivations ?? 0;
    },
    async clearEvidencePayloads() {
      calls.push("clearPayloads");
      return 3;
    },
    async purgeSourceEvidence(_t, _s, purgeOpts) {
      calls.push(
        `purge:cursor=${purgeOpts.cursor ?? "null"}:limit=${purgeOpts.limit}`,
      );
      return purgeResponses.shift() ?? { deleted: 0, nextCursor: null };
    },
    async deleteCheckpoints() {
      calls.push("deleteCheckpoints");
    },
    async loadEraseMarker() {
      return { ...marker };
    },
    async claimEraseMarker(_t, _s, claimOpts) {
      if (opts.claimLost) {
        calls.push("claim:lost");
        return null;
      }
      if (marker.status === "retracted" || marker.status === "dead_lettered") {
        calls.push("claim:terminal");
        return null;
      }
      const hasProgress =
        marker.cleanup_phase !== null || marker.cleanup_cursor !== null;
      if (marker.attempt_count >= marker.max_attempts && !hasProgress) {
        calls.push("claim:exhausted");
        return null;
      }
      marker.status = "running";
      marker.attempt_count += 1;
      marker.lock_generation += 1;
      marker.locked_by = claimOpts.lockedBy;
      marker.locked_at = claimOpts.now;
      calls.push("claim:ok");
      return { ...marker };
    },
    async recordEraseCleanupProgress(_id, fence, patch, progressOpts) {
      if (!fenceMatches(marker, fence)) return false;
      if (patch.cleanupPhase !== undefined) {
        marker.cleanup_phase = patch.cleanupPhase as never;
      }
      if (patch.cleanupCursor !== undefined) {
        marker.cleanup_cursor = patch.cleanupCursor as never;
      }
      marker.attempt_count = 0; // durable progress returns the budget
      if (progressOpts.release) {
        marker.status = "queued";
        marker.next_retry_at = progressOpts.now;
        marker.locked_at = null;
        marker.locked_by = null;
      }
      calls.push(
        `progress:phase=${marker.cleanup_phase ?? "null"}:cursor=${marker.cleanup_cursor ?? "null"}:release=${progressOpts.release}`,
      );
      return true;
    },
    async markEraseCleanupFailed(m, message, now, fence) {
      if (!fenceMatches(marker, fence)) return "stale";
      const transition = resolveFailureTransition(
        m,
        {
          errorClass: "cleanup_failed",
          errorMessage: message,
          retryable: true,
        },
        now,
      );
      marker.status = transition.status;
      marker.next_retry_at = transition.nextRetryAt;
      marker.locked_at = null;
      marker.locked_by = null;
      marker.error_class = "cleanup_failed";
      marker.error_message = message;
      calls.push(`cleanupFailed:${transition.status}`);
      return { ...marker };
    },
    async markEraseCompleted(_id, now, fence) {
      if (!fenceMatches(marker, fence)) return false;
      marker.status = "retracted";
      marker.completed_at = now;
      marker.locked_at = null;
      marker.locked_by = null;
      calls.push("markEraseCompleted");
      return true;
    },
    async markEraseFailed(_t, _s, reason) {
      marker.status = "dead_lettered";
      marker.error_class = "children_dead_lettered";
      marker.error_message = reason;
      calls.push("markEraseFailed");
    },
    async listEraseAggregatesNeedingCleanup() {
      return [];
    },
  };

  return { calls, marker, eraseStore };
}

function eraseDeps(
  harness: ReturnType<typeof makeEraseHarness>,
  overrides: Partial<import("./retraction.js").SourceEraseDeps> = {},
): import("./retraction.js").SourceEraseDeps {
  return {
    db: noDb,
    adapter: makeAdapter(),
    eraseStore: harness.eraseStore,
    enqueue: vi.fn(async () => ({
      enqueued: 0,
      eraseGeneration: harness.marker.erase_generation,
    })),
    process: vi.fn(async (id: string) => makeAttempt({ id })),
    deleteSnapshots: vi.fn(async () => ({
      objects: 2,
      versions: 4,
      truncated: false,
    })),
    destructiveCleanup: true,
    ...overrides,
  };
}

const ERASE_ARGS = { tenantId: TENANT_ID, sourceConfigId: SOURCE_CONFIG_ID };

describe("runSourceErase", () => {
  it("S2: WITHOUT destructiveCleanup (GraphQL path) it never claims the marker or touches S3, and reports pending", async () => {
    const harness = makeEraseHarness({
      countsByGeneration: { 1: { retracted: 2 } },
    });
    const deleteSnapshots = vi.fn(async () => ({
      objects: 0,
      versions: 0,
      truncated: false,
    }));
    const result = await runSourceErase(
      eraseDeps(harness, { destructiveCleanup: false, deleteSnapshots }),
      ERASE_ARGS,
    );
    expect(result.status).toBe("pending");
    expect(deleteSnapshots).not.toHaveBeenCalled();
    expect(harness.calls).not.toContain("claim:ok");
    expect(harness.calls).not.toContain("deleteCheckpoints");
  });

  it("completes: fenced claim → S3 versions → payload scrub + purge → checkpoints LAST → marker retired, in order", async () => {
    const harness = makeEraseHarness({
      countsByGeneration: { 1: { retracted: 2 } },
    });
    const deps = eraseDeps(harness);
    const result = await runSourceErase(deps, ERASE_ARGS);

    expect(result.status).toBe("completed");
    expect(result.snapshotObjectsDeleted).toBe(2);
    expect(result.snapshotVersionsDeleted).toBe(4);
    expect(result.evidenceRowsCleared).toBe(3);
    expect(result.checkpointsDeleted).toBe(true);
    const order = harness.calls;
    expect(order.indexOf("claim:ok")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("clearPayloads")).toBeGreaterThan(
      order.indexOf("claim:ok"),
    );
    expect(order.indexOf("deleteCheckpoints")).toBeGreaterThan(
      order.indexOf("clearPayloads"),
    );
    expect(order.indexOf("markEraseCompleted")).toBeGreaterThan(
      order.indexOf("deleteCheckpoints"),
    );
    expect(harness.marker.status).toBe("retracted");
  });

  it("overlap prevention: a lost marker claim performs no destructive work and reports pending", async () => {
    const harness = makeEraseHarness({
      claimLost: true,
      countsByGeneration: { 1: { retracted: 1 } },
    });
    const deps = eraseDeps(harness);
    const result = await runSourceErase(deps, ERASE_ARGS);
    expect(result.status).toBe("pending");
    expect(deps.deleteSnapshots).not.toHaveBeenCalled();
    expect(harness.calls).not.toContain("deleteCheckpoints");
  });

  it("a TRUNCATED S3 pass yields (released, due now) and later resumes without redoing phases", async () => {
    const harness = makeEraseHarness({
      countsByGeneration: { 1: { retracted: 1 } },
    });
    const deleteSnapshots = vi
      .fn<
        () => Promise<{ objects: number; versions: number; truncated: boolean }>
      >()
      .mockResolvedValueOnce({ objects: 1, versions: 1000, truncated: true })
      .mockResolvedValueOnce({ objects: 1, versions: 3, truncated: false });
    const deps = eraseDeps(harness, { deleteSnapshots });

    const first = await runSourceErase(deps, ERASE_ARGS);
    expect(first.status).toBe("pending");
    expect(harness.marker.status).toBe("queued"); // released for the next tick
    expect(harness.calls).not.toContain("deleteCheckpoints");

    const second = await runSourceErase(deps, ERASE_ARGS);
    expect(second.status).toBe("completed");
    expect(deleteSnapshots).toHaveBeenCalledTimes(2);
  });

  it("bounded evidence purge yields with a durable cursor and resumes from it", async () => {
    const harness = makeEraseHarness({
      countsByGeneration: { 1: { retracted: 1 } },
      purgeResponses: [
        { deleted: 200, nextCursor: "ev-200" },
        { deleted: 40, nextCursor: null },
      ],
    });
    const deps = eraseDeps(harness, { cleanupBatch: 200 });

    const first = await runSourceErase(deps, ERASE_ARGS);
    expect(first.status).toBe("pending");
    expect(harness.marker.cleanup_cursor).toBe("ev-200");
    expect(harness.calls).not.toContain("deleteCheckpoints");

    const second = await runSourceErase(deps, ERASE_ARGS);
    expect(second.status).toBe("completed");
    // Second pass resumed at the durable cursor and skipped the S3 phase.
    expect(harness.calls).toContain("purge:cursor=ev-200:limit=200");
    expect(deps.deleteSnapshots).toHaveBeenCalledTimes(1);
  });

  it("a cleanup needing MORE successful bounded passes than max_attempts still completes (budget counts caught failures only)", async () => {
    const harness = makeEraseHarness({
      markerMaxAttempts: 2,
      countsByGeneration: { 1: { retracted: 1 } },
      purgeResponses: [
        { deleted: 10, nextCursor: "c1" },
        { deleted: 10, nextCursor: "c2" },
        { deleted: 10, nextCursor: "c3" },
        { deleted: 10, nextCursor: null },
      ],
    });
    const deps = eraseDeps(harness, { cleanupBatch: 10 });
    let result: Awaited<ReturnType<typeof runSourceErase>> | null = null;
    for (let i = 0; i < 5; i += 1) {
      result = await runSourceErase(deps, ERASE_ARGS);
      if (result.status === "completed") break;
    }
    expect(result?.status).toBe("completed");
    expect(harness.marker.status).toBe("retracted");
  });

  it("a marker that crashed after durable phase progress on its nominally-final claim RESUMES (not DLQ)", async () => {
    const harness = makeEraseHarness({
      markerStatus: "running", // crashed while claimed
      markerPhase: "snapshots_deleted",
      markerAttemptCount: 5,
      markerMaxAttempts: 5,
      countsByGeneration: { 1: { retracted: 1 } },
    });
    // Stale lock so the reclaim path is exercised.
    harness.marker.locked_at = new Date(Date.now() - 10 * 60_000);
    harness.marker.locked_by = "dead-worker";
    const deps = eraseDeps(harness);
    const result = await runSourceErase(deps, ERASE_ARGS);
    expect(result.status).toBe("completed");
    // The S3 phase was NOT redone — resume honored the durable phase.
    expect(deps.deleteSnapshots).not.toHaveBeenCalled();
  });

  it("repeated caught cleanup failures back off and dead-letter at the budget; the aggregate surfaces failed", async () => {
    const harness = makeEraseHarness({
      markerMaxAttempts: 2,
      countsByGeneration: { 1: { retracted: 1 } },
    });
    const deps = eraseDeps(harness, {
      deleteSnapshots: vi.fn(async () => {
        throw new Error("s3 down");
      }),
    });

    const first = await runSourceErase(deps, ERASE_ARGS);
    expect(first.status).toBe("pending");
    expect(harness.marker.status).toBe("failed");
    expect(harness.marker.next_retry_at).not.toBeNull();

    // Make the retry due, then exhaust the budget.
    harness.marker.next_retry_at = new Date(Date.now() - 1);
    const second = await runSourceErase(deps, ERASE_ARGS);
    expect(second.status).toBe("failed");
    expect(harness.marker.status).toBe("dead_lettered");
    expect(harness.marker.error_class).toBe("cleanup_failed");

    // Terminal: further passes surface failed without retrying.
    const third = await runSourceErase(deps, ERASE_ARGS);
    expect(third.status).toBe("failed");
  });

  it("dead-lettered children of THIS generation fail the aggregate (marker dead-lettered, no cleanup)", async () => {
    const harness = makeEraseHarness({
      markerGeneration: 2,
      countsByGeneration: { 2: { retracted: 1, dead_lettered: 1 } },
    });
    const deps = eraseDeps(harness, {
      enqueue: vi.fn(async () => ({ enqueued: 0, eraseGeneration: 2 })),
    });
    const result = await runSourceErase(deps, ERASE_ARGS);
    expect(result.status).toBe("failed");
    expect(harness.calls).toContain("markEraseFailed");
    expect(harness.marker.status).toBe("dead_lettered");
    expect(deps.deleteSnapshots).not.toHaveBeenCalled();
  });

  it("P1-C: dead-lettered children from a PREVIOUS generation do not fail the current erase", async () => {
    const harness = makeEraseHarness({
      markerGeneration: 2,
      countsByGeneration: {
        1: { dead_lettered: 3 }, // remediated history
        2: { retracted: 2 }, // current generation is clean
      },
    });
    const deps = eraseDeps(harness, {
      enqueue: vi.fn(async () => ({ enqueued: 0, eraseGeneration: 2 })),
    });
    const result = await runSourceErase(deps, ERASE_ARGS);
    expect(result.status).toBe("completed");
    expect(harness.calls).toContain("count:gen=2");
    expect(harness.calls).not.toContain("count:gen=1");
  });

  it("bounds inline child processing and keeps draining when one attempt throws", async () => {
    const harness = makeEraseHarness({
      pendingIds: ["a1", "a2", "a3"],
      countsByGeneration: { 1: { queued: 3 } },
      remainingDerivations: 3,
    });
    const process = vi
      .fn<(id: string) => Promise<RetractionAttemptRow>>()
      .mockRejectedValueOnce(new Error("attempt vanished"))
      .mockResolvedValue(makeAttempt({ id: "a2", status: "retracted" }));
    const result = await runSourceErase(
      eraseDeps(harness, { process, maxInlineAttempts: 2 }),
      ERASE_ARGS,
    );
    expect(process).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("pending");
    expect(result.attempts.processedThisCall).toBe(2);
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
      return { enqueued, eraseGeneration: 0 };
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

    const marker = makeAttempt({
      id: "marker-multi",
      scope: "erase",
      status: "queued",
      erase_generation: 0,
      provider: "erase_aggregate",
      provider_document_id: `erase:${SOURCE_CONFIG_ID}`,
    });
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
      async clearEvidencePayloads() {
        return 3;
      },
      async purgeSourceEvidence() {
        return { deleted: 0, nextCursor: null };
      },
      async deleteCheckpoints() {
        checkpointsDeleted = true;
      },
      async loadEraseMarker() {
        return { ...marker };
      },
      async claimEraseMarker(_t, _s, claimOpts) {
        if (marker.status === "retracted") return null;
        marker.status = "running";
        marker.attempt_count += 1;
        marker.lock_generation += 1;
        marker.locked_by = claimOpts.lockedBy;
        marker.locked_at = claimOpts.now;
        return { ...marker };
      },
      async recordEraseCleanupProgress(_id, _fence, patch, progressOpts) {
        if (patch.cleanupPhase !== undefined) {
          marker.cleanup_phase = patch.cleanupPhase as never;
        }
        if (patch.cleanupCursor !== undefined) {
          marker.cleanup_cursor = patch.cleanupCursor as never;
        }
        if (progressOpts.release) marker.status = "queued";
        return true;
      },
      async markEraseCleanupFailed() {
        return "stale" as const;
      },
      async markEraseCompleted() {
        marker.status = "retracted";
        return true;
      },
      async markEraseFailed() {},
      async listEraseAggregatesNeedingCleanup() {
        return [];
      },
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
        deleteSnapshots: vi.fn(async () => ({
          objects: 3,
          versions: 3,
          truncated: false,
        })),
        destructiveCleanup: true,
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

// ---------------------------------------------------------------------------
// Round-3 P1-1: crash resumability — recorded in-flight progress resumes
// after a stale lease REGARDLESS of the attempt budget; only caught step
// failures consume it.
// ---------------------------------------------------------------------------

describe("crash resumability at the attempt budget (round-3 P1-1)", () => {
  const staleLock = () => new Date(Date.now() - 10 * 60_000);

  for (const status of [
    "provider_deleted",
    "supports_updated",
    "reconsolidated",
  ] as const) {
    it(`a worker that crashed at '${status}' on its FINAL claim resumes to retracted (never dead-lettered)`, async () => {
      const row = makeAttempt({
        status,
        attempt_count: 5,
        max_attempts: 5,
        locked_at: staleLock(),
        locked_by: "dead-worker",
        lock_generation: 5,
      });
      // Claimable despite the exhausted budget…
      expect(isAttemptClaimable(row, new Date())).toBe(true);

      // …and the saga resumes at the recorded progress and completes.
      const { store } = makeStore(row);
      const adapter = makeAdapter();
      const result = await processRetractionAttempt(
        { db: noDb, adapter, store },
        ATTEMPT_ID,
      );
      expect(result.status).toBe("retracted");
      if (status !== "reconsolidated" && status !== "supports_updated") {
        // Resumed AFTER the provider delete: no re-delete.
        expect(adapter.deleteDocument).not.toHaveBeenCalled();
      }
    });
  }

  it("'running' (no recorded progress) at the budget is NOT claimable — the sweep owns it", () => {
    expect(
      isAttemptClaimable(
        makeAttempt({
          status: "running",
          attempt_count: 5,
          max_attempts: 5,
          locked_at: staleLock(),
        }),
        new Date(),
      ),
    ).toBe(false);
  });

  it("queued/failed at the budget are NOT claimable", () => {
    expect(
      isAttemptClaimable(
        makeAttempt({ status: "failed", attempt_count: 5, max_attempts: 5 }),
        new Date(),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drizzle where-clause guards: exhausted sweep + due listing must never touch
// progressed rows / progressed erase markers (rendered SQL assertions).
// ---------------------------------------------------------------------------

describe("deadLetterExhaustedAttempts / listDueRetractionAttempts guards", () => {
  async function renderWhere(
    run: (db: never) => Promise<unknown>,
  ): Promise<{ sql: string; params: unknown[] }> {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    let captured: unknown;
    const chain: Record<string, unknown> = {};
    for (const m of ["set", "orderBy", "limit", "from", "select"]) {
      chain[m] = () => chain;
    }
    chain.where = (cond: unknown) => {
      captured = cond;
      return chain;
    };
    chain.returning = async () => [];
    chain.then = (resolve: (v: unknown[]) => unknown) =>
      Promise.resolve().then(() => resolve([]));
    const db = {
      update: () => chain,
      select: () => chain,
    } as never;
    await run(db);
    return dialect.sqlToQuery(captured as never) as {
      sql: string;
      params: unknown[];
    };
  }

  it("the exhausted sweep targets ONLY queued/failed/running and skips progressed erase markers", async () => {
    const { deadLetterExhaustedAttempts } = await import("./retraction.js");
    const rendered = await renderWhere((db) => deadLetterExhaustedAttempts(db));
    // Budget-bound statuses only — progressed saga statuses are absent.
    expect(rendered.params).toContain("queued");
    expect(rendered.params).toContain("failed");
    expect(rendered.params).toContain("running");
    expect(rendered.params).not.toContain("provider_deleted");
    expect(rendered.params).not.toContain("supports_updated");
    expect(rendered.params).not.toContain("reconsolidated");
    // Progressed erase markers (durable cleanup phase/cursor) are excluded.
    expect(rendered.sql).toContain('"cleanup_phase" IS NOT NULL');
    expect(rendered.sql).toContain('"cleanup_cursor" IS NOT NULL');
  });

  it("the due listing exempts progressed statuses from the attempt budget", async () => {
    const { listDueRetractionAttempts } = await import("./retraction.js");
    const rendered = await renderWhere((db) =>
      listDueRetractionAttempts(db, { limit: 10 }),
    );
    expect(rendered.params).toContain("provider_deleted");
    expect(rendered.params).toContain("supports_updated");
    expect(rendered.params).toContain("reconsolidated");
    // The budget comparison appears for the budget-bound branches only:
    // two occurrences (queued/failed branch + running branch), not three.
    const budgetOccurrences =
      rendered.sql.split('"attempt_count" < ').length - 1;
    expect(budgetOccurrences).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Round-5 P2: operator DLQ retry
// ---------------------------------------------------------------------------

describe("requeueRetractionAttempt", () => {
  async function runRequeue(returned: RetractionAttemptRow[]) {
    const { requeueRetractionAttempt } = await import("./retraction.js");
    const captured: { set?: Record<string, unknown>; where?: unknown } = {};
    const db = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.set = values;
          return {
            where: (cond: unknown) => {
              captured.where = cond;
              return { returning: async () => returned };
            },
          };
        },
      }),
    } as never;
    const row = await requeueRetractionAttempt(db, {
      tenantId: TENANT_ID,
      attemptId: ATTEMPT_ID,
    });
    return { row, captured };
  }

  it("resets a dead_lettered attempt to due-queued with a fresh budget and a bumped fence", async () => {
    const requeued = makeAttempt({ status: "queued", lock_generation: 7 });
    const { row, captured } = await runRequeue([requeued]);
    expect(row).toEqual(requeued);
    expect(captured.set).toMatchObject({
      status: "queued",
      attempt_count: 0,
      locked_at: null,
      locked_by: null,
      error_class: null,
      completed_at: null,
    });
    expect(captured.set!.next_retry_at).toBeInstanceOf(Date);
    // lock_generation bump is a SQL increment — fences out stale workers.
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const rendered = new PgDialect().sqlToQuery(
      captured.set!.lock_generation as never,
    );
    expect(rendered.sql).toContain('"lock_generation" + 1');
    // Only failed/dead_lettered rows qualify.
    const where = new PgDialect().sqlToQuery(captured.where as never);
    expect(where.params).toContain("dead_lettered");
    expect(where.params).toContain("failed");
    expect(where.params).toContain(TENANT_ID);
  });

  it("returns null when the attempt is not retryable (no row matched)", async () => {
    const { row } = await runRequeue([]);
    expect(row).toBeNull();
  });
});
