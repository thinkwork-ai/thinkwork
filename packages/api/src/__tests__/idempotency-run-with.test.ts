/**
 * Contract tests for `runWithIdempotency` — the high-level wrapper
 * resolvers call (Unit 8b).
 *
 * Invariants:
 *
 * 1. Skip when `tenantId` or `invokerUserId` is null. Preserves
 *    pre-Unit-1 callers and cognito users without a resolved users row.
 * 2. First call (isNew=true) runs `fn()`, commits via
 *    `completeIdempotentMutation` on success.
 * 3. Retry with the same key + prior status='succeeded' returns the
 *    stored `resultJson` without re-executing `fn()`.
 * 4. Retry with prior status='failed' throws the stored reason.
 * 5. Retry with prior status='pending' throws `MutationInFlightError`
 *    so the skill wrapper can emit a retry-later refusal.
 * 6. On `fn()` throw, calls `failIdempotentMutation` before rethrowing
 *    so the stored row reflects the failure for the next retry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { insertReturningMock, updateMock, selectReturningMock } = vi.hoisted(
  () => ({
    insertReturningMock: vi.fn(),
    updateMock: vi.fn(),
    selectReturningMock: vi.fn(),
  }),
);

vi.mock("../graphql/utils.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    db: {
      insert: vi.fn(() => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () =>
              Promise.resolve(insertReturningMock() as unknown[]),
          }),
        }),
      })),
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
  runWithIdempotency,
  MutationInFlightError,
} from "../lib/idempotency.js";

const BASE = {
  tenantId: "tenant-A",
  invokerUserId: "user-A",
  mutationName: "createAgent",
  inputs: { slug: "marco" },
};

describe("runWithIdempotency — skip path", () => {
  beforeEach(() => {
    insertReturningMock.mockReset();
    updateMock.mockReset();
    selectReturningMock.mockReset();
  });

  it("short-circuits when tenantId is null — fn runs, no DB writes", async () => {
    const fn = vi.fn(async () => ({ agent: { id: "a-1" } }));
    const result = await runWithIdempotency({
      ...BASE,
      tenantId: null,
      fn,
    });
    expect(result).toEqual({ agent: { id: "a-1" } });
    expect(fn).toHaveBeenCalledOnce();
    expect(insertReturningMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("short-circuits when invokerUserId is null", async () => {
    const fn = vi.fn(async () => "ok");
    await runWithIdempotency({ ...BASE, invokerUserId: null, fn });
    expect(fn).toHaveBeenCalledOnce();
    expect(insertReturningMock).not.toHaveBeenCalled();
  });
});

describe("runWithIdempotency — first call (isNew=true)", () => {
  beforeEach(() => {
    insertReturningMock.mockReset();
    updateMock.mockReset();
    selectReturningMock.mockReset();
  });

  it("runs fn, completes on success with result stored", async () => {
    insertReturningMock.mockReturnValueOnce([{ id: "row-1" }]);
    const fn = vi.fn(async () => ({ agent: { id: "a-1" } }));

    const result = await runWithIdempotency({ ...BASE, fn });

    expect(result).toEqual({ agent: { id: "a-1" } });
    expect(fn).toHaveBeenCalledOnce();
    // Exactly one update — the complete() call.
    expect(updateMock).toHaveBeenCalledOnce();
    const patch = updateMock.mock.calls[0]?.[0] as {
      status?: string;
      result_json?: unknown;
    };
    expect(patch.status).toBe("succeeded");
    expect(patch.result_json).toEqual({ agent: { id: "a-1" } });
  });

  it("calls failIdempotentMutation on fn() throw, rethrows the original error", async () => {
    insertReturningMock.mockReturnValueOnce([{ id: "row-2" }]);
    const originalError = new Error("downstream 500");
    const fn = vi.fn(async () => {
      throw originalError;
    });

    await expect(runWithIdempotency({ ...BASE, fn })).rejects.toBe(
      originalError,
    );

    expect(updateMock).toHaveBeenCalledOnce();
    const patch = updateMock.mock.calls[0]?.[0] as {
      status?: string;
      failure_reason?: string;
    };
    expect(patch.status).toBe("failed");
    expect(patch.failure_reason).toBe("downstream 500");
  });
});

describe("runWithIdempotency — retry (isNew=false)", () => {
  beforeEach(() => {
    insertReturningMock.mockReset();
    updateMock.mockReset();
    selectReturningMock.mockReset();
  });

  it("status=succeeded returns stored resultJson without re-running fn", async () => {
    insertReturningMock.mockReturnValueOnce([]); // conflict
    selectReturningMock.mockReturnValueOnce([
      {
        id: "row-prior",
        status: "succeeded",
        result_json: { agent: { id: "a-original" } },
        failure_reason: null,
      },
    ]);
    const fn = vi.fn(async () => {
      throw new Error("fn should not be called on retry-succeeded");
    });

    const result = await runWithIdempotency({ ...BASE, fn });

    expect(result).toEqual({ agent: { id: "a-original" } });
    expect(fn).not.toHaveBeenCalled();
    // Critical: no complete() or fail() update on retry — the stored
    // row already has a terminal status.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("resultCoerce narrows the unknown result back to the resolver's type", async () => {
    insertReturningMock.mockReturnValueOnce([]);
    selectReturningMock.mockReturnValueOnce([
      {
        id: "row-prior",
        status: "succeeded",
        result_json: { agent: { id: "a-2", name: "Marco" } },
        failure_reason: null,
      },
    ]);

    interface AgentResult {
      agent: { id: string; name: string };
    }
    const coerce = vi.fn((raw: unknown) => raw as AgentResult);

    const result = await runWithIdempotency<AgentResult>({
      ...BASE,
      fn: async () => ({ agent: { id: "unreached", name: "unreached" } }),
      resultCoerce: coerce,
    });

    expect(coerce).toHaveBeenCalledOnce();
    expect(result.agent.id).toBe("a-2");
  });

  it("status=failed throws the stored failureReason as a fresh Error", async () => {
    insertReturningMock.mockReturnValueOnce([]);
    selectReturningMock.mockReturnValueOnce([
      {
        id: "row-failed",
        status: "failed",
        result_json: null,
        failure_reason: "slug already taken",
      },
    ]);

    await expect(
      runWithIdempotency({ ...BASE, fn: async () => "ok" }),
    ).rejects.toThrow("slug already taken");
  });

  it("status=pending throws MutationInFlightError carrying the idempotency key", async () => {
    insertReturningMock.mockReturnValueOnce([]);
    selectReturningMock.mockReturnValueOnce([
      {
        id: "row-pending",
        status: "pending",
        result_json: null,
        failure_reason: null,
      },
    ]);

    await expect(
      runWithIdempotency({
        ...BASE,
        clientKey: "onboard-foo:step-1",
        fn: async () => "ok",
      }),
    ).rejects.toThrow(MutationInFlightError);
  });
});
