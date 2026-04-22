/**
 * Contract tests for the mutation_idempotency helper.
 *
 * The helper backs admin-skill mutation retries: a second call with the
 * same (tenant, invoker, mutation_name, idempotency_key) composite must
 * return the prior call's result (for succeeded rows) or its failure
 * reason (for failed rows) without re-executing the write.
 *
 * Canonicalization + hashing are server-side only (no Python-side
 * parity surface). These tests drive through the real `hashResolvedInputs`
 * / `canonicalizeForHash` helpers in graphql/utils.ts, so a regression in
 * either will surface here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  insertReturningMock,
  updateMock,
  selectReturningMock,
  insertSpy,
  onConflictSpy,
} = vi.hoisted(() => ({
  insertReturningMock: vi.fn(),
  updateMock: vi.fn(),
  selectReturningMock: vi.fn(),
  insertSpy: vi.fn(),
  onConflictSpy: vi.fn(),
}));

vi.mock("../graphql/utils.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  // Build a db shim that records insert + update invocations and routes
  // returning() through insertReturningMock. Select goes through
  // selectReturningMock.
  return {
    ...actual,
    db: {
      insert: vi.fn((table: unknown) => {
        insertSpy(table);
        return {
          values: (v: unknown) => ({
            onConflictDoNothing: (cfg: unknown) => {
              onConflictSpy(cfg);
              return {
                returning: () =>
                  Promise.resolve(insertReturningMock(v) as unknown[]),
              };
            },
          }),
        };
      }),
      update: vi.fn(() => ({
        set: (patch: unknown) => ({
          where: () => {
            updateMock(patch);
            return Promise.resolve();
          },
        }),
      })),
      select: vi.fn(() => ({
        from: () => ({
          where: () => Promise.resolve(selectReturningMock() as unknown[]),
        }),
      })),
    },
  };
});

// eslint-disable-next-line import/first
import {
  startOrLoadIdempotentMutation,
  completeIdempotentMutation,
  failIdempotentMutation,
} from "../lib/idempotency.js";
// eslint-disable-next-line import/first
import { hashResolvedInputs } from "../graphql/utils.js";

const INPUTS = { slug: "marco", role: "assistant", permissions: ["read"] };
const BASE = {
  tenantId: "tenant-A",
  invokerUserId: "user-A",
  mutationName: "createAgent",
  inputs: INPUTS,
};

describe("startOrLoadIdempotentMutation — INSERT or load", () => {
  beforeEach(() => {
    insertReturningMock.mockReset();
    selectReturningMock.mockReset();
    updateMock.mockReset();
    insertSpy.mockReset();
    onConflictSpy.mockReset();
  });

  it("inserts a new row keyed by resolvedInputsHash when no clientKey is provided", async () => {
    insertReturningMock.mockReturnValueOnce([{ id: "row-1" }]);
    const result = await startOrLoadIdempotentMutation(BASE);
    expect(result.isNew).toBe(true);
    if (!result.isNew) throw new Error("unreachable");
    expect(result.id).toBe("row-1");
    // Hash backs both the idempotency_key and the resolved_inputs_hash.
    const expected = hashResolvedInputs(INPUTS);
    expect(result.idempotencyKey).toBe(expected);
    expect(result.resolvedInputsHash).toBe(expected);
  });

  it("uses clientKey as idempotency_key (recipe-step-level dedup) but still records the resolved-inputs hash", async () => {
    insertReturningMock.mockReturnValueOnce([{ id: "row-2" }]);
    const result = await startOrLoadIdempotentMutation({
      ...BASE,
      clientKey: "onboard-foo-corp:create-agent:marco",
    });
    expect(result.isNew).toBe(true);
    if (!result.isNew) throw new Error("unreachable");
    expect(result.idempotencyKey).toBe("onboard-foo-corp:create-agent:marco");
    expect(result.resolvedInputsHash).toBe(hashResolvedInputs(INPUTS));
  });

  it("treats empty-string clientKey as absent (server-derived hash wins)", async () => {
    insertReturningMock.mockReturnValueOnce([{ id: "row-3" }]);
    const result = await startOrLoadIdempotentMutation({
      ...BASE,
      clientKey: "",
    });
    expect(result.isNew).toBe(true);
    if (!result.isNew) throw new Error("unreachable");
    expect(result.idempotencyKey).toBe(hashResolvedInputs(INPUTS));
  });

  it("returns the prior row on conflict with status='succeeded' + resultJson", async () => {
    insertReturningMock.mockReturnValueOnce([]); // conflict
    selectReturningMock.mockReturnValueOnce([
      {
        id: "row-existing",
        status: "succeeded",
        result_json: { agent: { id: "a-1" } },
        failure_reason: null,
      },
    ]);
    const result = await startOrLoadIdempotentMutation(BASE);
    expect(result.isNew).toBe(false);
    if (result.isNew) throw new Error("unreachable");
    expect(result.id).toBe("row-existing");
    expect(result.status).toBe("succeeded");
    expect(result.resultJson).toEqual({ agent: { id: "a-1" } });
    expect(result.failureReason).toBe(null);
  });

  it("returns failureReason on conflict with status='failed'", async () => {
    insertReturningMock.mockReturnValueOnce([]);
    selectReturningMock.mockReturnValueOnce([
      {
        id: "row-failed",
        status: "failed",
        result_json: null,
        failure_reason: "downstream 500",
      },
    ]);
    const result = await startOrLoadIdempotentMutation(BASE);
    expect(result.isNew).toBe(false);
    if (result.isNew) throw new Error("unreachable");
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("downstream 500");
  });

  it("returns status='pending' on conflict with an in-flight row", async () => {
    insertReturningMock.mockReturnValueOnce([]);
    selectReturningMock.mockReturnValueOnce([
      {
        id: "row-pending",
        status: "pending",
        result_json: null,
        failure_reason: null,
      },
    ]);
    const result = await startOrLoadIdempotentMutation(BASE);
    expect(result.isNew).toBe(false);
    if (result.isNew) throw new Error("unreachable");
    expect(result.status).toBe("pending");
  });

  it("throws when conflict fires but no matching row can be loaded (cleanup race)", async () => {
    insertReturningMock.mockReturnValueOnce([]);
    selectReturningMock.mockReturnValueOnce([]);
    await expect(startOrLoadIdempotentMutation(BASE)).rejects.toThrow(
      /conflict raised but no matching row/,
    );
  });

  it("passes the full unique-index target to onConflictDoNothing (no partial-index `where`)", async () => {
    insertReturningMock.mockReturnValueOnce([{ id: "row-5" }]);
    await startOrLoadIdempotentMutation(BASE);
    const cfg = onConflictSpy.mock.calls[0]?.[0] as
      | { target?: unknown[]; where?: unknown }
      | undefined;
    // Four-column composite; not a partial-index `where` in sight.
    expect(cfg?.target).toHaveLength(4);
    expect(cfg?.where).toBeUndefined();
  });

  it("different inputs produce different idempotency keys + distinct rows", async () => {
    insertReturningMock.mockReturnValueOnce([{ id: "row-a" }]);
    insertReturningMock.mockReturnValueOnce([{ id: "row-b" }]);
    const a = await startOrLoadIdempotentMutation({
      ...BASE,
      inputs: { slug: "marco" },
    });
    const b = await startOrLoadIdempotentMutation({
      ...BASE,
      inputs: { slug: "polo" },
    });
    expect(a.isNew && b.isNew).toBe(true);
    if (!a.isNew || !b.isNew) throw new Error("unreachable");
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it("canonicalization makes key-reordering equivalent (a,b == b,a)", async () => {
    insertReturningMock.mockReturnValueOnce([{ id: "row-ab" }]);
    insertReturningMock.mockReturnValueOnce([{ id: "row-ba" }]);
    const a = await startOrLoadIdempotentMutation({
      ...BASE,
      inputs: { a: 1, b: 2 },
    });
    const b = await startOrLoadIdempotentMutation({
      ...BASE,
      inputs: { b: 2, a: 1 },
    });
    if (!a.isNew || !b.isNew) throw new Error("unreachable");
    expect(a.resolvedInputsHash).toBe(b.resolvedInputsHash);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  it("preserves array order as semantically significant ([a,b] != [b,a])", async () => {
    insertReturningMock.mockReturnValueOnce([{ id: "row-arr1" }]);
    insertReturningMock.mockReturnValueOnce([{ id: "row-arr2" }]);
    const a = await startOrLoadIdempotentMutation({
      ...BASE,
      inputs: { focuses: ["x", "y"] },
    });
    const b = await startOrLoadIdempotentMutation({
      ...BASE,
      inputs: { focuses: ["y", "x"] },
    });
    if (!a.isNew || !b.isNew) throw new Error("unreachable");
    expect(a.resolvedInputsHash).not.toBe(b.resolvedInputsHash);
  });
});

describe("completeIdempotentMutation", () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it("flips status to succeeded, stores result_json, and stamps completed_at", async () => {
    await completeIdempotentMutation("row-1", { agent: { id: "a-1" } });
    const patch = updateMock.mock.calls[0]?.[0] as {
      status?: string;
      result_json?: unknown;
      completed_at?: Date;
    };
    expect(patch.status).toBe("succeeded");
    expect(patch.result_json).toEqual({ agent: { id: "a-1" } });
    expect(patch.completed_at).toBeInstanceOf(Date);
  });
});

describe("failIdempotentMutation", () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it("flips status to failed, stores reason (truncated at 2000 chars), stamps completed_at", async () => {
    const longReason = "x".repeat(5000);
    await failIdempotentMutation("row-1", longReason);
    const patch = updateMock.mock.calls[0]?.[0] as {
      status?: string;
      failure_reason?: string;
      completed_at?: Date;
    };
    expect(patch.status).toBe("failed");
    expect(patch.failure_reason).toHaveLength(2000);
    expect(patch.completed_at).toBeInstanceOf(Date);
  });
});
