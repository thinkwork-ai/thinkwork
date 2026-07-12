import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/memory-sources/claims.js", () => ({
  deactivateOrphanedClaims: vi.fn().mockResolvedValue(0),
}));

import type { RetractionAttemptRow } from "../lib/memory-sources/retraction.js";
import {
  DEFAULT_DRAIN_LIMIT,
  MAX_DRAIN_LIMIT,
  runMemoryRetractionDrainer,
} from "./memory-retraction-drainer.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";

function makeRow(
  id: string,
  status = "queued",
  overrides: Partial<RetractionAttemptRow> = {},
): RetractionAttemptRow {
  return {
    id,
    tenant_id: TENANT_ID,
    scope: "derivation",
    derivation_id: id,
    source_config_id: id,
    provider: "hindsight",
    provider_document_id: `doc-${id}`,
    target_bank_id: `tenant_${TENANT_ID}`,
    status,
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: new Date(),
    locked_at: null,
    locked_by: null,
    lock_generation: 0,
    erase_generation: 0,
    cleanup_phase: null,
    cleanup_cursor: null,
    reconsolidation_note: null,
    error_class: null,
    error_message: null,
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
    ...overrides,
  } as RetractionAttemptRow;
}

const noDb = { fake: "db" } as never;
const noAdapter = {} as never;

describe("runMemoryRetractionDrainer", () => {
  it("claims due attempts, processes each with a fenced worker id, and tallies outcomes", async () => {
    const due = [makeRow("a1"), makeRow("a2"), makeRow("a3")];
    const list = vi.fn(async () => due);
    const lockedBys: string[] = [];
    const process = vi.fn(
      async (attemptId: string, opts: { lockedBy: string }) => {
        lockedBys.push(opts.lockedBy);
        if (attemptId === "a1") return makeRow("a1", "retracted");
        if (attemptId === "a2")
          return makeRow("a2", "failed", { error_class: "hindsight_503" });
        return makeRow("a3", "dead_lettered", { error_class: "hindsight_403" });
      },
    );
    const deadLetterExhausted = vi.fn(async () => []);

    const summary = await runMemoryRetractionDrainer(
      {},
      {
        db: noDb,
        adapter: noAdapter,
        list,
        process,
        deadLetterExhausted,
        listEraseCleanup: vi.fn(async () => []),
        lockedBy: "memory-retraction-drainer:req-1",
      },
    );

    expect(list).toHaveBeenCalledExactlyOnceWith(noDb, {
      limit: DEFAULT_DRAIN_LIMIT,
    });
    expect(process).toHaveBeenCalledTimes(3);
    expect(new Set(lockedBys)).toEqual(
      new Set(["memory-retraction-drainer:req-1"]),
    );
    expect(summary).toMatchObject({
      scanned: 3,
      processed: 3,
      retracted: 1,
      retrying: 1,
      deadLettered: 1,
      errors: 0,
      exhaustedDeadLettered: 0,
    });
  });

  it("bounds the batch per invocation and clamps oversized limits", async () => {
    const list = vi.fn(async () => []);
    await runMemoryRetractionDrainer(
      { limit: 100000 },
      {
        db: noDb,
        adapter: noAdapter,
        list,
        process: vi.fn(),
        deadLetterExhausted: vi.fn(async () => []),
        listEraseCleanup: vi.fn(async () => []),
      },
    );
    expect(list).toHaveBeenCalledExactlyOnceWith(noDb, {
      limit: MAX_DRAIN_LIMIT,
    });
  });

  it("keeps draining when one attempt throws, counting it as an error", async () => {
    const due = [makeRow("a1"), makeRow("a2")];
    const process = vi
      .fn<
        (
          id: string,
          opts: { lockedBy: string },
        ) => Promise<RetractionAttemptRow>
      >()
      .mockRejectedValueOnce(new Error("attempt vanished"))
      .mockResolvedValueOnce(makeRow("a2", "retracted"));

    const summary = await runMemoryRetractionDrainer(
      {},
      {
        db: noDb,
        adapter: noAdapter,
        list: vi.fn(async () => due),
        process,
        deadLetterExhausted: vi.fn(async () => []),
        listEraseCleanup: vi.fn(async () => []),
      },
    );

    expect(process).toHaveBeenCalledTimes(2);
    expect(summary.errors).toBe(1);
    expect(summary.retracted).toBe(1);
  });

  it("sweeps exhausted non-terminal attempts to dead_lettered", async () => {
    const deadLetterExhausted = vi.fn(async () => [
      makeRow("stuck-1", "dead_lettered"),
    ]);
    const summary = await runMemoryRetractionDrainer(
      {},
      {
        db: noDb,
        adapter: noAdapter,
        list: vi.fn(async () => []),
        process: vi.fn(),
        deadLetterExhausted,
        listEraseCleanup: vi.fn(async () => []),
      },
    );
    expect(deadLetterExhausted).toHaveBeenCalledTimes(1);
    expect(summary.exhaustedDeadLettered).toBe(1);
  });

  it("emits a structured metrics log line", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runMemoryRetractionDrainer(
        {},
        {
          db: noDb,
          adapter: noAdapter,
          list: vi.fn(async () => [makeRow("a1")]),
          process: vi.fn(async () => makeRow("a1", "retracted")),
          deadLetterExhausted: vi.fn(async () => []),
          listEraseCleanup: vi.fn(async () => []),
        },
      );
      const metricLine = logSpy.mock.calls
        .map((c) => c[0])
        .find(
          (line) =>
            typeof line === "string" &&
            line.includes("memory_retraction_drainer"),
        );
      expect(metricLine).toBeDefined();
      const parsed = JSON.parse(metricLine as string);
      expect(parsed).toMatchObject({
        metric: "memory_retraction_drainer",
        retracted: 1,
        deadLettered: 0,
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Erase-aggregate self-finalization (Codex P1 addendum)
// ---------------------------------------------------------------------------

describe("erase aggregate cleanup sweep", () => {
  it("runs cleanup for aggregates whose children are all terminal and counts outcomes", async () => {
    const listEraseCleanup = vi.fn(async () => [
      { tenantId: TENANT_ID, sourceConfigId: "src-1" },
      { tenantId: TENANT_ID, sourceConfigId: "src-2" },
    ]);
    const runErase = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        attempts: {
          total: 1,
          retracted: 1,
          pending: 0,
          deadLettered: 0,
          processedThisCall: 0,
        },
        snapshotObjectsDeleted: 2,
        evidenceRowsCleared: 2,
        evidenceRowsDeleted: 1,
        checkpointsDeleted: true,
      })
      .mockResolvedValueOnce({
        status: "failed",
        attempts: {
          total: 1,
          retracted: 0,
          pending: 0,
          deadLettered: 1,
          processedThisCall: 0,
        },
        snapshotObjectsDeleted: 0,
        evidenceRowsCleared: 0,
        evidenceRowsDeleted: 0,
        checkpointsDeleted: false,
      });

    const summary = await runMemoryRetractionDrainer(
      {},
      {
        db: noDb,
        adapter: noAdapter,
        list: vi.fn(async () => []),
        process: vi.fn(),
        deadLetterExhausted: vi.fn(async () => []),
        listEraseCleanup,
        runErase,
      },
    );

    expect(listEraseCleanup).toHaveBeenCalledTimes(1);
    expect(runErase).toHaveBeenCalledTimes(2);
    expect(summary.eraseAggregatesCompleted).toBe(1);
    expect(summary.eraseAggregatesIncomplete).toBe(1);
  });

  it("a crashing aggregate cleanup never aborts the tick", async () => {
    const summary = await runMemoryRetractionDrainer(
      {},
      {
        db: noDb,
        adapter: noAdapter,
        list: vi.fn(async () => []),
        process: vi.fn(),
        deadLetterExhausted: vi.fn(async () => []),
        listEraseCleanup: vi.fn(async () => [
          { tenantId: TENANT_ID, sourceConfigId: "src-1" },
        ]),
        runErase: vi.fn(async () => {
          throw new Error("s3 unavailable");
        }),
      },
    );
    expect(summary.eraseAggregatesIncomplete).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Acceptance: ONE operator erase mutation → scheduled drainer ticks alone →
// aggregate 'completed' (Codex rounds 3-7). Covers multi-tick child
// completion, shared provider documents, marker fenced claim + backoff +
// budget, S3 cleanup failure + retry with checkpoints deleted LAST,
// dead-lettered children blocking cleanup, zero-derivation sources,
// idempotent initiation, and derivation-attempt collision promotion.
// ---------------------------------------------------------------------------

import {
  eraseMarkerDocumentId,
  ERASE_MARKER_PROVIDER,
  fenceMatches,
  isAttemptClaimable,
  processRetractionAttempt,
  resolveFailureTransition,
  retryBackoffAt,
  runSourceErase,
  type RetractionStore,
  type SourceEraseStore,
  type SnapshotDeleteResult,
} from "../lib/memory-sources/retraction.js";

const SOURCE_CONFIG_ID = "7f4b2a90-11a2-4a5f-9d1b-3c8e5f6a7b8c";
const DOC = `external:${SOURCE_CONFIG_ID}:company:twenty-co-1`;
const BANK = `tenant_${TENANT_ID}`;

/** In-memory erase world: children + durable erase marker (full fenced
 * claim/backoff/budget semantics) + S3/pg residue. */
function makeEraseWorld(opts: {
  derivations: Array<{
    id: string;
    evidence_item_id: string;
    lifecycle: string;
  }>;
  /** Consumed per adapter.deleteDocument call; default "ok". */
  deleteDocumentResults?: Array<"fail" | "ok">;
  /** Consumed per deleteSnapshots call; default "ok". */
  s3Results?: Array<"fail" | "ok" | "truncated">;
  s3Objects?: number;
  markerMaxAttempts?: number;
}) {
  const derivations = opts.derivations;
  const children: RetractionAttemptRow[] = [];
  let marker: RetractionAttemptRow | null = null;
  let sourceGeneration = 0;
  const world = {
    derivations,
    children,
    get marker() {
      return marker;
    },
    get sourceGeneration() {
      return sourceGeneration;
    },
    checkpointsPresent: true,
    evidenceResidue: true,
    s3Objects: opts.s3Objects ?? 2,
    cleanupOrder: [] as string[],
  };
  const deleteDocumentResults = [...(opts.deleteDocumentResults ?? [])];
  const s3Results = [...(opts.s3Results ?? [])];

  const adapter = {
    deleteDocument: vi.fn(async () => {
      if ((deleteDocumentResults.shift() ?? "ok") === "fail") {
        throw new Error("hindsight deleteDocument 503: upstream unavailable");
      }
      return "deleted" as const;
    }),
    consolidateBankById: vi.fn(async () => {}),
  };

  const markerTerminal = () =>
    !marker ||
    marker.status === "retracted" ||
    marker.status === "dead_lettered";

  /** Mirrors beginSourceErase: idempotent per active erase. */
  const begin = () => {
    if (!markerTerminal()) return marker!.erase_generation;
    sourceGeneration += 1;
    marker = makeRow("erase-marker-" + sourceGeneration, "queued", {
      scope: "erase",
      derivation_id: null,
      source_config_id: SOURCE_CONFIG_ID,
      provider: ERASE_MARKER_PROVIDER,
      provider_document_id: eraseMarkerDocumentId(SOURCE_CONFIG_ID),
      target_bank_id: eraseMarkerDocumentId(SOURCE_CONFIG_ID),
      erase_generation: sourceGeneration,
      next_retry_at: null,
    });
    return sourceGeneration;
  };

  /** Mirrors enqueueSourceErase: marker generation authoritative, collision
   * promotion, generation carry-forward, bounded children. */
  const enqueue = async () => {
    if (markerTerminal()) begin();
    const generation = marker!.erase_generation;
    let enqueued = 0;
    for (const child of children) {
      if (child.status === "retracted" || child.status === "dead_lettered") {
        continue;
      }
      // Collision promotion + generation carry-forward.
      child.scope = "source";
      child.erase_generation = generation;
    }
    for (const d of derivations) {
      if (d.lifecycle !== "active" && d.lifecycle !== "superseded") continue;
      const nonTerminal = children.find(
        (a) =>
          a.provider_document_id === DOC &&
          a.status !== "retracted" &&
          a.status !== "dead_lettered",
      );
      if (nonTerminal) continue; // partial unique per-document index
      children.push(
        makeRow(`attempt-${children.length + 1}`, "queued", {
          scope: "source",
          derivation_id: d.id,
          source_config_id: SOURCE_CONFIG_ID,
          provider_document_id: DOC,
          target_bank_id: BANK,
          erase_generation: generation,
        }),
      );
      enqueued += 1;
    }
    return { enqueued, eraseGeneration: generation };
  };

  const findChild = (id: string) => children.find((a) => a.id === id);
  const worldStore = (now?: Date): RetractionStore => ({
    async loadAttempt(id) {
      const a = findChild(id);
      return a ? { ...a } : null;
    },
    async claimAttempt(id, claimOpts) {
      const a = findChild(id);
      const at = now ?? claimOpts.now;
      if (!a || !isAttemptClaimable(a, at)) return null;
      if (a.status === "queued" || a.status === "failed") a.status = "running";
      a.attempt_count += 1;
      a.locked_at = at;
      a.locked_by = claimOpts.lockedBy;
      a.lock_generation += 1;
      return { ...a };
    },
    async renewLease(id, fence, at) {
      const a = findChild(id);
      if (!a || !fenceMatches(a, fence)) return false;
      a.locked_at = at;
      return true;
    },
    async recordProgress(id, status, at, fence, progressOpts) {
      const a = findChild(id);
      if (!a || !fenceMatches(a, fence)) return "stale";
      a.status = status;
      if (progressOpts?.reconsolidationNote !== undefined) {
        a.reconsolidation_note = progressOpts.reconsolidationNote;
      }
      a.updated_at = at;
      return { ...a };
    },
    async finalizeInternalState(args) {
      const a = findChild(args.attemptId);
      if (!a || !fenceMatches(a, args.fence)) return "stale";
      if (a.status !== "provider_deleted") return "stale";
      for (const d of derivations) {
        if (d.lifecycle === "active" || d.lifecycle === "superseded") {
          d.lifecycle = "retracted";
        }
      }
      a.status = "supports_updated";
      return { ...a };
    },
    async markRetracted(id, at, fence) {
      const a = findChild(id);
      if (!a || !fenceMatches(a, fence)) return "stale";
      a.status = "retracted";
      a.locked_at = null;
      a.locked_by = null;
      a.completed_at = at;
      return { ...a };
    },
    async markFailed(attempt, failure, at, fence) {
      const a = findChild(attempt.id);
      if (!a || !fenceMatches(a, fence)) return "stale";
      const transition = resolveFailureTransition(attempt, failure, at);
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
      return d
        ? ({
            ...d,
            tenant_id: TENANT_ID,
            source_config_id: SOURCE_CONFIG_ID,
            hindsight_document_id: DOC,
            target_bank_id: BANK,
          } as never)
        : null;
    },
  });

  const eraseStore: SourceEraseStore = {
    async listPendingSourceAttemptIds(_t, _s, limit) {
      return children
        .filter(
          (a) =>
            a.scope === "source" &&
            a.status !== "retracted" &&
            a.status !== "dead_lettered",
        )
        .slice(0, limit)
        .map((a) => a.id);
    },
    async countSourceAttemptsByStatus(_t, _s, generation) {
      const counts: Record<string, number> = {};
      for (const a of children) {
        if (a.scope !== "source") continue;
        if (a.erase_generation !== generation) continue;
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
      world.cleanupOrder.push("purgeEvidence");
      world.evidenceResidue = false;
      return 2;
    },
    async purgeNonDerivedEvidence() {
      return { deleted: 1, nextCursor: null };
    },
    async deleteCheckpoints() {
      world.cleanupOrder.push("deleteCheckpoints");
      world.checkpointsPresent = false;
    },
    async loadEraseMarker() {
      return marker ? { ...marker } : null;
    },
    async claimEraseMarker(_t, _s, claimOpts) {
      if (!marker || markerTerminal()) return null;
      const now = claimOpts.now;
      const due =
        (marker.status === "queued" || marker.status === "failed") &&
        (marker.next_retry_at === null || marker.next_retry_at <= now);
      const staleRunning =
        marker.status === "running" &&
        (marker.locked_at === null ||
          marker.locked_at.getTime() <= now.getTime() - 6 * 60_000);
      if (!due && !staleRunning) return null;
      const hasProgress =
        marker.cleanup_phase !== null || marker.cleanup_cursor !== null;
      if (marker.attempt_count >= marker.max_attempts && !hasProgress) {
        return null;
      }
      marker.status = "running";
      marker.attempt_count += 1;
      marker.lock_generation += 1;
      marker.locked_by = claimOpts.lockedBy;
      marker.locked_at = now;
      return { ...marker };
    },
    async recordEraseCleanupProgress(_id, fence, patch, progressOpts) {
      if (!marker || !fenceMatches(marker, fence)) return false;
      if (patch.cleanupPhase !== undefined) {
        marker.cleanup_phase = patch.cleanupPhase as never;
      }
      if (patch.cleanupCursor !== undefined) {
        marker.cleanup_cursor = patch.cleanupCursor as never;
      }
      marker.attempt_count = 0;
      if (progressOpts.release) {
        marker.status = "queued";
        marker.next_retry_at = progressOpts.now;
        marker.locked_at = null;
        marker.locked_by = null;
      }
      return true;
    },
    async markEraseCleanupFailed(m, message, now, fence) {
      if (!marker || !fenceMatches(marker, fence)) return "stale";
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
      marker.completed_at = transition.completedAt;
      return { ...marker };
    },
    async markEraseCompleted(_id, now, fence) {
      if (!marker || !fenceMatches(marker, fence)) return false;
      marker.status = "retracted";
      marker.completed_at = now;
      marker.locked_at = null;
      marker.locked_by = null;
      return true;
    },
    async markEraseFailed(_t, _s, reason) {
      if (marker && !markerTerminal()) {
        marker.status = "dead_lettered";
        marker.error_class = "children_dead_lettered";
        marker.error_message = reason;
      }
    },
    async listEraseAggregatesNeedingCleanup(limit) {
      if (!marker || markerTerminal()) return [];
      const childrenTerminal = children
        .filter(
          (a) =>
            a.scope === "source" &&
            a.erase_generation === marker!.erase_generation,
        )
        .every((a) => a.status === "retracted" || a.status === "dead_lettered");
      return childrenTerminal
        ? [{ tenantId: TENANT_ID, sourceConfigId: SOURCE_CONFIG_ID }].slice(
            0,
            limit,
          )
        : [];
    },
  };

  const deleteSnapshots = vi.fn(async (): Promise<SnapshotDeleteResult> => {
    const mode = s3Results.shift() ?? "ok";
    if (mode === "fail") throw new Error("s3 unavailable");
    if (mode === "truncated") {
      return { objects: 1, versions: 1000, truncated: true };
    }
    world.cleanupOrder.push("deleteSnapshots");
    const n = world.s3Objects;
    world.s3Objects = 0;
    return { objects: n, versions: n, truncated: false };
  });

  const eraseDeps = (now?: Date, destructive = false) => ({
    db: noDb,
    adapter,
    eraseStore,
    enqueue,
    process: (attemptId: string) =>
      processRetractionAttempt(
        { db: noDb, adapter, store: worldStore(now) },
        attemptId,
        { lockedBy: "worker", now },
      ),
    deleteSnapshots,
    destructiveCleanup: destructive,
    nowFn: () => now ?? new Date(),
  });

  /** THE operator mutation: atomic initiation + non-destructive aggregate. */
  const runMutation = (now?: Date) => {
    begin();
    return runSourceErase(eraseDeps(now, false), {
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
    });
  };

  const runTick = (tick: Date) =>
    runMemoryRetractionDrainer(
      {},
      {
        db: noDb,
        adapter: noAdapter,
        list: async (_db, { limit }) =>
          children.filter((a) => isAttemptClaimable(a, tick)).slice(0, limit),
        process: (attemptId, tickOpts) =>
          processRetractionAttempt(
            { db: noDb, adapter, store: worldStore(tick) },
            attemptId,
            { lockedBy: tickOpts.lockedBy, now: tick },
          ),
        deadLetterExhausted: vi.fn(async () => []),
        listEraseCleanup: async (_db, limit) => {
          // Emulate the due/lock predicate the drizzle listing applies.
          const m = marker;
          if (!m || markerTerminal()) return [];
          if (m.next_retry_at && m.next_retry_at > tick) return [];
          if (
            m.locked_at &&
            m.locked_at.getTime() > tick.getTime() - 6 * 60_000
          ) {
            return [];
          }
          return eraseStore.listEraseAggregatesNeedingCleanup(limit);
        },
        runErase: (ref) => runSourceErase(eraseDeps(tick, true), ref),
      },
    );

  return { world, adapter, deleteSnapshots, runMutation, runTick, begin };
}

const threeEditions = () => [
  { id: "d1", evidence_item_id: "e1", lifecycle: "superseded" },
  { id: "d2", evidence_item_id: "e2", lifecycle: "superseded" },
  { id: "d3", evidence_item_id: "e3", lifecycle: "active" },
];

function futureTick(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

describe("acceptance: erase self-finalizes via the drainer alone", () => {
  it("children complete across MULTIPLE drainer ticks, then cleanup — one mutation total (3 derivations, one shared document)", async () => {
    const fx = makeEraseWorld({
      derivations: threeEditions(),
      // Provider 5xx at the mutation AND at the first drainer tick; the
      // second tick's retry succeeds.
      deleteDocumentResults: ["fail", "fail", "ok"],
    });

    // 1. THE one operator mutation → pending (child failed retryably); the
    //    GraphQL path performs NO destructive S3 work (S2).
    const mutationResult = await fx.runMutation();
    expect(mutationResult.status).toBe("pending");
    expect(fx.world.children).toHaveLength(1); // one attempt for 3 editions
    expect(fx.world.marker?.status).toBe("queued"); // durable marker
    expect(fx.deleteSnapshots).not.toHaveBeenCalled();

    // 2. Drainer tick 1: child fails again → still pending, NO cleanup.
    const tick1 = await fx.runTick(futureTick(10));
    expect(tick1.retrying).toBe(1);
    expect(tick1.eraseAggregatesCompleted).toBe(0);
    expect(fx.world.checkpointsPresent).toBe(true);

    // 3. Drainer tick 2: child retracts AND the cleanup sweep completes the
    //    aggregate in the same pass — with no second mutation.
    const tick2 = await fx.runTick(futureTick(30));
    expect(tick2.retracted).toBe(1);
    expect(tick2.eraseAggregatesCompleted).toBe(1);
    expect(fx.world.derivations.map((d) => d.lifecycle)).toEqual([
      "retracted",
      "retracted",
      "retracted",
    ]);
    expect(fx.world.s3Objects).toBe(0);
    expect(fx.world.evidenceResidue).toBe(false);
    expect(fx.world.checkpointsPresent).toBe(false);
    expect(fx.world.marker?.status).toBe("retracted");

    // 4. Later ticks are quiet no-ops: the terminal marker is never
    //    re-claimed and nothing re-runs.
    const tick3 = await fx.runTick(futureTick(60));
    expect(tick3.eraseAggregatesCompleted).toBe(0);
    expect(tick3.eraseAggregatesIncomplete).toBe(0);
    expect(tick3.errors).toBe(0);
    expect(fx.world.marker?.status).toBe("retracted");
  });

  it("idempotent initiation: repeated erase mutations while a child is in flight keep ONE generation and still complete", async () => {
    const fx = makeEraseWorld({
      derivations: threeEditions(),
      deleteDocumentResults: ["fail", "ok"],
    });

    const first = await fx.runMutation();
    expect(first.status).toBe("pending");
    const generationAfterFirst = fx.world.marker!.erase_generation;

    // Operator double-click / retry while the child is failed-retryable.
    const second = await fx.runMutation();
    expect(second.status).toBe("pending");
    expect(fx.world.marker!.erase_generation).toBe(generationAfterFirst);
    // No orphaned children on another generation.
    expect(
      fx.world.children.every(
        (c) => c.erase_generation === generationAfterFirst,
      ),
    ).toBe(true);

    const tick = await fx.runTick(futureTick(10));
    expect(tick.eraseAggregatesCompleted).toBe(1);
    expect(fx.world.marker?.status).toBe("retracted");
  });

  it("P1-B: an in-flight derivation-scoped attempt is PROMOTED into the erase and the evidence still ends scrubbed", async () => {
    const fx = makeEraseWorld({ derivations: threeEditions() });
    // A user retracted one derivation right before the erase: its attempt
    // holds the per-document uniqueness slot.
    fx.world.children.push(
      makeRow("pre-existing", "queued", {
        scope: "derivation",
        derivation_id: "d3",
        source_config_id: SOURCE_CONFIG_ID,
        provider_document_id: DOC,
        target_bank_id: BANK,
        erase_generation: 0,
      }),
    );

    const mutationResult = await fx.runMutation();
    // Promotion: the colliding attempt is now scope='source' on the active
    // generation — counted by the aggregate.
    const promoted = fx.world.children.find((c) => c.id === "pre-existing")!;
    expect(promoted.scope).toBe("source");
    expect(promoted.erase_generation).toBe(fx.world.marker!.erase_generation);
    expect(["pending", "completed"]).toContain(mutationResult.status);

    const tick = await fx.runTick(futureTick(10));
    expect(tick.eraseAggregatesCompleted).toBe(1);
    // Defensive evidence scrub ran regardless of which scope semantics the
    // child finalized under.
    expect(fx.world.evidenceResidue).toBe(false);
    expect(fx.world.checkpointsPresent).toBe(false);
  });

  it("an S3 cleanup failure backs off and is retried on a later tick; checkpoints are deleted LAST, never before S3 + evidence succeed", async () => {
    const fx = makeEraseWorld({
      derivations: threeEditions(),
      s3Results: ["fail", "ok"],
    });

    // Mutation drains children inline (no S3 — S2), then tick 1's cleanup
    // S3 delete fails → marker failed with backoff, checkpoints untouched.
    await fx.runMutation();
    const tick1 = await fx.runTick(futureTick(1));
    expect(tick1.eraseAggregatesIncomplete).toBe(1);
    expect(fx.world.checkpointsPresent).toBe(true);
    expect(fx.world.evidenceResidue).toBe(true);
    expect(fx.world.marker?.status).toBe("failed");
    expect(fx.world.marker?.next_retry_at).not.toBeNull();

    // Next tick past the backoff: cleanup retries and completes.
    const tick2 = await fx.runTick(futureTick(30));
    expect(tick2.eraseAggregatesCompleted).toBe(1);
    expect(fx.world.checkpointsPresent).toBe(false);
    expect(fx.world.marker?.status).toBe("retracted");
    // Strict cleanup order: S3 → evidence purge → checkpoints LAST.
    expect(fx.world.cleanupOrder).toEqual([
      "deleteSnapshots",
      "purgeEvidence",
      "deleteCheckpoints",
    ]);
  });

  it("a TRUNCATED S3 sweep progresses across ticks without consuming the failure budget", async () => {
    const fx = makeEraseWorld({
      derivations: [],
      markerMaxAttempts: 5,
      s3Results: ["truncated", "truncated", "truncated", "truncated", "ok"],
    });
    await fx.runMutation();
    let completedTick = -1;
    for (let i = 1; i <= 7; i += 1) {
      const tick = await fx.runTick(futureTick(i));
      if (tick.eraseAggregatesCompleted > 0) {
        completedTick = i;
        break;
      }
    }
    // 5 bounded S3 passes with max_attempts=5: completes because durable
    // progress returns the budget (only caught failures consume it).
    expect(completedTick).toBeGreaterThan(0);
    expect(fx.world.marker?.status).toBe("retracted");
  });

  it("a dead-lettered child PREVENTS cleanup and surfaces the aggregate as failed (marker dead-lettered, never silently pending)", async () => {
    const fx = makeEraseWorld({
      derivations: threeEditions(),
      deleteDocumentResults: ["fail", "fail", "fail", "fail", "fail"],
    });

    await fx.runMutation();
    for (let i = 1; i <= 6; i += 1) {
      await fx.runTick(futureTick(i * 60));
    }
    expect(fx.world.children[0]!.status).toBe("dead_lettered");
    expect(fx.world.checkpointsPresent).toBe(true);
    expect(fx.world.evidenceResidue).toBe(true);
    expect(fx.world.cleanupOrder).toEqual([]);
    expect(fx.world.marker?.status).toBe("dead_lettered");
    expect(fx.world.marker?.error_class).toBe("children_dead_lettered");
  });

  it("a source with ZERO derivations survives an early S3 failure via the durable marker", async () => {
    const fx = makeEraseWorld({
      derivations: [],
      s3Results: ["fail", "ok"],
    });

    const mutationResult = await fx.runMutation();
    expect(mutationResult.status).toBe("pending");
    expect(fx.world.children).toHaveLength(0);
    expect(fx.world.marker?.status).toBe("queued");

    const tick1 = await fx.runTick(futureTick(1));
    expect(tick1.eraseAggregatesIncomplete).toBe(1);
    const tick2 = await fx.runTick(futureTick(30));
    expect(tick2.eraseAggregatesCompleted).toBe(1);
    expect(fx.world.checkpointsPresent).toBe(false);
    expect(fx.world.evidenceResidue).toBe(false);
    expect(fx.world.marker?.status).toBe("retracted");
  });
});
