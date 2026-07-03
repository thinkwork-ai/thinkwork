import { describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";
import {
  runRetryAgentDispatch,
  type RetryAgentDispatchDeps,
  type RetryMessageRow,
  type RetryRedispatchInput,
} from "./retryAgentDispatch.mutation.js";
import { buildDefaultAgentTurnWakeup } from "../../../lib/mentions/default-agent-routing.js";
import { buildAgentMentionWakeups } from "../../../lib/mentions/dispatch-agent-mentions.js";

const TENANT = "tenant-1";
const SENDER = "user-sender";
const OTHER = "user-other";

function messageRow(overrides: Partial<RetryMessageRow> = {}): RetryMessageRow {
  return {
    id: "message-1",
    tenantId: TENANT,
    threadId: "thread-1",
    spaceId: "space-1",
    content: "please answer",
    senderType: "user",
    senderId: SENDER,
    metadata: { dispatch: { status: "failed", attempt: 1, route: "default" } },
    ...overrides,
  };
}

function deps(overrides: Partial<RetryAgentDispatchDeps> = {}): {
  deps: RetryAgentDispatchDeps;
  redispatched: RetryRedispatchInput[];
  saved: Array<{ metadata: Record<string, unknown> }>;
} {
  const redispatched: RetryRedispatchInput[] = [];
  const saved: Array<{ metadata: Record<string, unknown> }> = [];
  const base: RetryAgentDispatchDeps = {
    loadMessage: vi.fn(async () => messageRow()),
    saveDispatchMetadata: vi.fn(async ({ metadata }) => {
      saved.push({ metadata });
      return messageRow({ metadata });
    }),
    redispatch: vi.fn(async (input) => {
      redispatched.push(input);
    }),
    ...overrides,
  };
  return { deps: base, redispatched, saved };
}

describe("runRetryAgentDispatch (R7/AE5)", () => {
  it("lets the original sender retry, incrementing the attempt to pending", async () => {
    const { deps: d, redispatched, saved } = deps();
    const result = await runRetryAgentDispatch(
      { messageId: "message-1", tenantId: TENANT, callerUserId: SENDER },
      d,
    );

    // Prior attempt was 1 → the retry drives attempt 2.
    expect(saved).toHaveLength(1);
    expect(saved[0].metadata.dispatch).toEqual({
      status: "pending",
      attempt: 2,
      route: "default",
    });
    expect(redispatched).toEqual([
      { route: "default", attempt: 2, message: expect.any(Object) },
    ]);
    expect(
      (result.metadata?.dispatch as Record<string, unknown>).status,
    ).toBe("pending");
  });

  it("re-drives the recorded route (mention) with the incremented attempt", async () => {
    const { deps: d, redispatched } = deps({
      loadMessage: vi.fn(async () =>
        messageRow({
          metadata: {
            dispatch: { status: "failed", attempt: 2, route: "mention" },
          },
        }),
      ),
    });
    await runRetryAgentDispatch(
      { messageId: "message-1", tenantId: TENANT, callerUserId: SENDER },
      d,
    );
    expect(redispatched[0]).toMatchObject({ route: "mention", attempt: 3 });
  });

  it("rejects a non-sender with FORBIDDEN", async () => {
    const { deps: d, redispatched, saved } = deps();
    await expect(
      runRetryAgentDispatch(
        { messageId: "message-1", tenantId: TENANT, callerUserId: OTHER },
        d,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
    // No dispatch or metadata write on an unauthorized retry.
    expect(saved).toEqual([]);
    expect(redispatched).toEqual([]);
  });

  it("returns NOT_FOUND for a cross-tenant / missing message", async () => {
    const { deps: d } = deps({
      // Tenant-scoped lookup returns null when the message is not in the
      // caller's tenant — indistinguishable from missing, by design.
      loadMessage: vi.fn(async () => null),
    });
    await expect(
      runRetryAgentDispatch(
        { messageId: "message-1", tenantId: "tenant-other", callerUserId: SENDER },
        d,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("returns NOT_FOUND when the caller has no resolvable tenant", async () => {
    const load = vi.fn(async () => messageRow());
    await expect(
      runRetryAgentDispatch(
        { messageId: "message-1", tenantId: null, callerUserId: SENDER },
        deps({ loadMessage: load }).deps,
      ),
    ).rejects.toBeInstanceOf(GraphQLError);
    // Never even looked the message up without a tenant scope.
    expect(load).not.toHaveBeenCalled();
  });

  it("resolves sender identity from the original message row (R12)", async () => {
    const { deps: d, redispatched } = deps();
    await runRetryAgentDispatch(
      { messageId: "message-1", tenantId: TENANT, callerUserId: SENDER },
      d,
    );
    expect(redispatched[0].message.senderId).toBe(SENDER);
    expect(redispatched[0].message.senderType).toBe("user");
  });
});

describe("KTD4: retry mints a fresh idempotency key that differs from the base", () => {
  it("default-agent wakeup: attempt-suffixed key ≠ base key", () => {
    const base = buildDefaultAgentTurnWakeup({
      tenantId: TENANT,
      threadId: "thread-1",
      messageId: "message-1",
      agentId: "agent-1",
      content: "hi",
      sender: { type: "user", id: SENDER },
    });
    const retry = buildDefaultAgentTurnWakeup({
      tenantId: TENANT,
      threadId: "thread-1",
      messageId: "message-1",
      agentId: "agent-1",
      content: "hi",
      sender: { type: "user", id: SENDER },
      attempt: 2,
    });
    expect(base.idempotencyKey).toBe("agent-default:tenant-1:message-1:agent-1");
    expect(retry.idempotencyKey).toBe(
      "agent-default:tenant-1:message-1:agent-1:attempt-2",
    );
    expect(retry.idempotencyKey).not.toBe(base.idempotencyKey);
  });

  it("mention wakeup: attempt-suffixed key ≠ base key", () => {
    const mentions = [
      {
        targetType: "agent" as const,
        targetId: "agent-9",
        displayName: "Coordinator",
        rawText: "@Coordinator",
        startOffset: 0,
        endOffset: 12,
      },
    ];
    const [base] = buildAgentMentionWakeups({
      tenantId: TENANT,
      threadId: "thread-1",
      messageId: "message-1",
      content: "@Coordinator help",
      mentions,
      sender: { type: "user", id: SENDER },
    });
    const [retry] = buildAgentMentionWakeups({
      tenantId: TENANT,
      threadId: "thread-1",
      messageId: "message-1",
      content: "@Coordinator help",
      mentions,
      sender: { type: "user", id: SENDER },
      attempt: 3,
    });
    expect(base.idempotencyKey).toBe("agent-mention:tenant-1:message-1:agent-9");
    expect(retry.idempotencyKey).toBe(
      "agent-mention:tenant-1:message-1:agent-9:attempt-3",
    );
    expect(retry.idempotencyKey).not.toBe(base.idempotencyKey);
  });
});
