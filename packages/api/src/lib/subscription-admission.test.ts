import { describe, expect, it, vi } from "vitest";
import {
  admitSubscriptionOperation,
  type SubscriptionAdmissionRepository,
} from "./subscription-admission.js";

const repository: SubscriptionAdmissionRepository = {
  canReadThread: vi.fn(async ({ threadId }) => threadId === "thread-1"),
};

function admit(overrides: Record<string, unknown> = {}) {
  return admitSubscriptionOperation(
    {
      operationName: "OnNewMessage",
      query: `subscription OnNewMessage($threadId: ID!) {
        onNewMessage(threadId: $threadId) { messageId }
      }`,
      variables: { threadId: "thread-1" },
      userId: "user-1",
      tenantId: "tenant-1",
      ...overrides,
    } as never,
    repository,
  );
}

describe("subscription operation admission", () => {
  it("binds an allowlisted thread subscription after resource access", async () => {
    await expect(admit()).resolves.toEqual(
      expect.objectContaining({
        fieldName: "onNewMessage",
        resourceKind: "thread",
        resourceId: "thread-1",
        operationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("denies another tenant's tenant-scoped feed", async () => {
    await expect(
      admit({
        operationName: "OnOrgUpdated",
        query:
          "subscription OnOrgUpdated($tenantId: ID!) { onOrgUpdated(tenantId: $tenantId) { tenantId } }",
        variables: { tenantId: "tenant-2" },
      }),
    ).rejects.toMatchObject({ code: "tenant_mismatch" });
  });

  it("denies another user's feed", async () => {
    await expect(
      admit({
        operationName: "OnThreadActivity",
        query:
          "subscription OnThreadActivity($userId: ID!) { onThreadActivity(userId: $userId) { userId } }",
        variables: { userId: "user-2" },
      }),
    ).rejects.toMatchObject({ code: "user_mismatch" });
  });

  it("denies an inaccessible thread", async () => {
    await expect(
      admit({ variables: { threadId: "thread-2" } }),
    ).rejects.toMatchObject({ code: "thread_not_accessible" });
  });

  it("denies unknown subscription fields", async () => {
    await expect(
      admit({
        operationName: "Exfiltrate",
        query:
          "subscription Exfiltrate($tenantId: ID!) { exfiltrate(tenantId: $tenantId) { id } }",
        variables: { tenantId: "tenant-1" },
      }),
    ).rejects.toMatchObject({ code: "operation_not_allowed" });
  });

  it.each([
    [
      "a mutation",
      "mutation OnNewMessage($threadId: ID!) { onNewMessage(threadId: $threadId) { messageId } }",
    ],
    [
      "multiple root fields",
      "subscription OnNewMessage($threadId: ID!) { onNewMessage(threadId: $threadId) { messageId } onThreadTurnStep(threadId: $threadId) { runId } }",
    ],
    [
      "an aliased field",
      "subscription OnNewMessage($threadId: ID!) { copied: onNewMessage(threadId: $threadId) { messageId } }",
    ],
  ])("denies %s", async (_name, query) => {
    await expect(admit({ query })).rejects.toMatchObject({
      code: "operation_shape_invalid",
    });
  });

  it("denies a modified scope argument", async () => {
    await expect(
      admit({
        query:
          "subscription OnNewMessage($other: ID!) { onNewMessage(threadId: $other) { messageId } }",
        variables: { other: "thread-1" },
      }),
    ).rejects.toMatchObject({ code: "scope_argument_invalid" });
  });

  it("binds the operation hash to canonical variables", async () => {
    const first = await admit();
    const second = await admit({
      variables: { threadId: "thread-1", ignored: true },
    });
    expect(first.operationHash).not.toBe(second.operationHash);
  });
});
