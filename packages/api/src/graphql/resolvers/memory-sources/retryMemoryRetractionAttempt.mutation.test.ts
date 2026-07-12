/**
 * retryMemoryRetractionAttempt resolver + MemoryRetractionAttempt
 * diagnostics mapping (THINK-193 U2, Codex round-5 P2).
 */

import { describe, expect, it, vi } from "vitest";

const requireTenantAdminMock = vi.hoisted(() => vi.fn());
const resolveCallerTenantIdMock = vi.hoisted(() => vi.fn());
const requeueMock = vi.hoisted(() => vi.fn());

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: requireTenantAdminMock,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: resolveCallerTenantIdMock,
}));
vi.mock("../../../lib/memory-sources/retraction.js", async (orig) => ({
  ...(await orig<
    typeof import("../../../lib/memory-sources/retraction.js")
  >()),
  requeueRetractionAttempt: requeueMock,
}));

import { retryMemoryRetractionAttempt } from "./retryMemoryRetractionAttempt.mutation.js";
import { toGraphqlRetractionAttempt } from "./memoryRetractionAttempts.query.js";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const ATTEMPT = "11111111-2222-4333-8444-555555555555";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT,
    tenant_id: TENANT,
    scope: "source",
    derivation_id: null,
    source_config_id: "7f4b2a90-11a2-4a5f-9d1b-3c8e5f6a7b8c",
    provider: "hindsight",
    provider_document_id: "doc-1",
    target_bank_id: `tenant_${TENANT}`,
    status: "queued",
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: new Date("2026-07-12T00:00:00.000Z"),
    locked_at: new Date("2026-07-12T00:01:00.000Z"),
    locked_by: "memory-retraction-drainer:req-9",
    lock_generation: 7,
    erase_generation: 2,
    cleanup_phase: null,
    cleanup_cursor: null,
    reconsolidation_note: "skipped: no consolidator available",
    error_class: null,
    error_message: null,
    created_at: new Date("2026-07-11T00:00:00.000Z"),
    updated_at: new Date("2026-07-12T00:00:00.000Z"),
    completed_at: null,
    ...overrides,
  } as never;
}

const ctx = { db: {}, auth: { tenantId: TENANT } } as never;

describe("retryMemoryRetractionAttempt", () => {
  it("tenant-admin gates, requeues, and returns the mapped attempt", async () => {
    requeueMock.mockResolvedValue(row());
    const result = await retryMemoryRetractionAttempt(
      null,
      { attemptId: ATTEMPT },
      ctx,
    );
    expect(requireTenantAdminMock).toHaveBeenCalledWith(ctx, TENANT);
    expect(requeueMock).toHaveBeenCalledWith(
      {},
      { tenantId: TENANT, attemptId: ATTEMPT },
    );
    expect(result).toMatchObject({ id: ATTEMPT, status: "queued" });
  });

  it("throws a clear error when the attempt is not retryable", async () => {
    requeueMock.mockResolvedValue(null);
    await expect(
      retryMemoryRetractionAttempt(null, { attemptId: ATTEMPT }, ctx),
    ).rejects.toThrow(/not found or not retryable/);
  });
});

describe("toGraphqlRetractionAttempt diagnostics (round-5 P2)", () => {
  it("exposes sourceConfigId, budget, retry, lease, fence, and reconsolidation diagnostics", () => {
    const mapped = toGraphqlRetractionAttempt(row());
    expect(mapped).toMatchObject({
      id: ATTEMPT,
      sourceConfigId: "7f4b2a90-11a2-4a5f-9d1b-3c8e5f6a7b8c",
      maxAttempts: 5,
      nextRetryAt: "2026-07-12T00:00:00.000Z",
      lockedBy: "memory-retraction-drainer:req-9",
      lockGeneration: 7,
      eraseGeneration: 2,
      reconsolidationNote: "skipped: no consolidator available",
    });
    // Lease horizon = locked_at + the 6-minute stale window.
    expect(mapped.leaseExpiresAt).toBe("2026-07-12T00:07:00.000Z");
  });

  it("leaseExpiresAt is null when unclaimed", () => {
    const mapped = toGraphqlRetractionAttempt(
      row({ locked_at: null, locked_by: null }),
    );
    expect(mapped.leaseExpiresAt).toBeNull();
    expect(mapped.lockedBy).toBeNull();
  });
});
