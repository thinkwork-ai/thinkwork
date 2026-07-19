import { describe, expect, it, vi } from "vitest";
import {
  INVALIDATABLE_SUBSCRIPTION_FIELDS,
  enqueueSubscriptionInvalidation,
  processSubscriptionInvalidations,
  shouldSuppressSubscriptionDelivery,
  type SubscriptionInvalidationRepository,
} from "./subscription-invalidation.js";

function repository(
  rows: Array<{
    id: string;
    tenantId: string;
    userId: string | null;
    resourceKind: string;
    resourceId: string | null;
    reason: string;
    attempts: number;
  }> = [],
): SubscriptionInvalidationRepository {
  return {
    enqueue: vi.fn(async () => undefined),
    claim: vi.fn(async () => rows),
    complete: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    hasPending: vi.fn(async () => true),
  };
}

describe("subscription invalidation", () => {
  it("persists revocation intent before processing", async () => {
    const repo = repository();
    await enqueueSubscriptionInvalidation(
      {
        tenantId: "tenant-1",
        userId: "user-1",
        resourceKind: "membership",
        reason: "membership_removed",
      },
      repo,
    );
    expect(repo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "membership_removed" }),
    );
  });

  it("suppresses delivery while a matching invalidation is pending", async () => {
    const repo = repository();
    await expect(
      shouldSuppressSubscriptionDelivery(
        {
          tenantId: "tenant-1",
          resourceKind: "thread",
          resourceId: "thread-1",
        },
        repo,
      ),
    ).resolves.toBe(true);
  });

  it("invalidates every sensitive subscription field then completes", async () => {
    const repo = repository([
      {
        id: "outbox-1",
        tenantId: "tenant-1",
        userId: "user-1",
        resourceKind: "membership",
        resourceId: null,
        reason: "membership_removed",
        attempts: 0,
      },
    ]);
    const publish = vi.fn(async () => true);
    await expect(
      processSubscriptionInvalidations({ repository: repo, publish }),
    ).resolves.toEqual({ processed: 1, retried: 0 });
    expect(publish).toHaveBeenCalledTimes(
      INVALIDATABLE_SUBSCRIPTION_FIELDS.length,
    );
    expect(repo.complete).toHaveBeenCalledWith("outbox-1", expect.any(Date));
  });

  it("stops on failure and retries without completing", async () => {
    const repo = repository([
      {
        id: "outbox-1",
        tenantId: "tenant-1",
        userId: null,
        resourceKind: "tenant_policy",
        resourceId: null,
        reason: "tenant_policy_disabled",
        attempts: 2,
      },
    ]);
    const publish = vi.fn(async () => false);
    await expect(
      processSubscriptionInvalidations({
        repository: repo,
        publish,
        now: new Date("2026-07-18T00:00:00Z"),
      }),
    ).resolves.toEqual({ processed: 0, retried: 1 });
    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.retry).toHaveBeenCalledWith(
      "outbox-1",
      3,
      new Date("2026-07-18T00:00:08.000Z"),
    );
  });
});
