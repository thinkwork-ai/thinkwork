import { beforeEach, describe, expect, it, vi } from "vitest";

// The module imports the real DB utils + database-pg wiring for its default
// deps; every test injects `deps`, so we stub those imports to avoid a live
// connection at module load.
vi.mock("../../graphql/utils.js", () => ({
  db: {},
  webhooks: {},
  agentLoops: {},
  agentLoopVersions: {},
  agentLoopRuns: {},
}));
vi.mock("@thinkwork/database-pg", () => ({
  createDbAgentLoopLedger: vi.fn(),
  ensureThreadForWork: vi.fn(),
  loadActiveSpaceId: vi.fn(),
  loadAgentDefaultSpaceId: vi.fn(),
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

import {
  WEBHOOK_PAYLOAD_FENCE_OPEN,
  type AgentLoopDispatchInput,
  type AgentLoopDispatchResult,
} from "@thinkwork/agent-loops-core";
import {
  deriveAutomationWebhookIdempotencyKey,
  dispatchAutomationWebhook,
  type AutomationWebhookDeps,
} from "./automation-webhook-dispatch.js";

function webhookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "hook-1",
    tenant_id: "tenant-1",
    name: "Twenty CRM",
    token: "tok-1",
    target_type: "automation",
    agent_loop_id: "loop-1",
    enabled: true,
    ...overrides,
  } as any;
}

function fakeDeps(
  overrides: Partial<AutomationWebhookDeps> & {
    targetKind?: string;
    hasRoutineActions?: boolean;
    threadId?: string | null;
    dispatchResult?: AgentLoopDispatchResult;
    errorCode?: string | null;
  } = {},
) {
  const dispatchCalls: AgentLoopDispatchInput[] = [];
  const deferOptions: unknown[] = [];
  const continueCalls: unknown[] = [];
  const dispatch = vi.fn(
    async (
      input: AgentLoopDispatchInput,
      _ledger: unknown,
      options: unknown,
    ) => {
      dispatchCalls.push(input);
      deferOptions.push(options);
      return (
        overrides.dispatchResult ?? {
          status: "queued" as const,
          runId: "run-1",
          iterationId: "iter-1",
          wakeupId: "wake-1",
        }
      );
    },
  );
  const deps: AutomationWebhookDeps = {
    now: new Date("2026-07-04T00:00:00Z"),
    dispatch: dispatch as unknown as AutomationWebhookDeps["dispatch"],
    makeLedger: () => ({}) as any,
    loadRunErrorCode: vi.fn(async () => overrides.errorCode ?? null),
    invokeContinue: vi.fn(async (p: unknown) => {
      continueCalls.push(p);
    }),
    loadContext: vi.fn(async () => ({
      ok: true as const,
      context: {
        loop: {
          id: "loop-1",
          tenantId: "tenant-1",
          name: "Twenty CRM",
          enabled: true,
          lifecycleStatus: "active",
        },
        runAsUserId: "user-9",
        version: {
          id: "v-1",
          targetKind: overrides.targetKind ?? "agent_thread",
        } as any,
        hasRoutineActions: overrides.hasRoutineActions ?? false,
        targetKind: overrides.targetKind ?? "agent_thread",
        spaceId: overrides.targetKind === "agent_thread" ? "space-1" : null,
        threadId:
          overrides.threadId ??
          (overrides.targetKind === "agent_thread" ? "thread-1" : null),
      },
    })),
    ...overrides,
  };
  return { deps, dispatchCalls, deferOptions, continueCalls };
}

describe("deriveAutomationWebhookIdempotencyKey", () => {
  it("prefers the x-idempotency-key header when present", () => {
    expect(
      deriveAutomationWebhookIdempotencyKey("hook-1", "{}", "hdr-key"),
    ).toBe("hdr-key");
  });

  it("derives a deterministic sha256 key from webhook id + raw body when absent", () => {
    const a = deriveAutomationWebhookIdempotencyKey(
      "hook-1",
      '{"x":1}',
      undefined,
    );
    const b = deriveAutomationWebhookIdempotencyKey(
      "hook-1",
      '{"x":1}',
      undefined,
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^webhook:hook-1:sha256:[0-9a-f]{64}$/);
  });

  it("changes when the body changes", () => {
    const a = deriveAutomationWebhookIdempotencyKey(
      "hook-1",
      '{"x":1}',
      undefined,
    );
    const b = deriveAutomationWebhookIdempotencyKey(
      "hook-1",
      '{"x":2}',
      undefined,
    );
    expect(a).not.toBe(b);
  });
});

describe("dispatchAutomationWebhook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("agent_thread: fence-wraps the body into the turn instructions and queues (201)", async () => {
    const { deps, dispatchCalls } = fakeDeps({ targetKind: "agent_thread" });
    const body = { event: "opportunity.created", id: "opp-1" };

    const { response, delivery } = await dispatchAutomationWebhook({
      webhook: webhookRow(),
      parsedBody: body,
      rawBody: JSON.stringify(body),
      headerIdempotencyKey: undefined,
      deps,
    });

    expect(response.statusCode).toBe(201);
    expect(delivery).toMatchObject({
      resolution_status: "ok",
      status_code: 201,
      thread_id: "thread-1",
      thread_created: true,
    });
    const trigger = dispatchCalls[0].trigger;
    expect(trigger.family).toBe("webhook");
    expect(trigger.source).toBe("webhook:hook-1");
    expect(trigger.runAsUserId).toBe("user-9");
    expect(trigger.routineInputOverride).toBeNull();
    expect(trigger.appendedInstructions).toContain(WEBHOOK_PAYLOAD_FENCE_OPEN);
    expect(trigger.appendedInstructions).toContain(JSON.stringify(body));
    expect(trigger.webhookDelivery).toMatchObject({
      source: "webhook:hook-1",
      eventId: expect.stringMatching(/^webhook:hook-1:sha256:/),
    });
    // Derived key is used as the dispatch idempotency key (no header sent).
    expect(trigger.idempotencyKey).toMatch(/^webhook:hook-1:sha256:/);
  });

  it("routine: passes the raw body as the input override and defers to job-trigger (202)", async () => {
    const { deps, dispatchCalls, deferOptions, continueCalls } = fakeDeps({
      targetKind: "routine",
      hasRoutineActions: true,
      dispatchResult: {
        status: "deferred",
        runId: "run-2",
        iterationId: "iter-2",
      },
    });
    const body = { event: "ping", n: 3 };

    const { response, delivery } = await dispatchAutomationWebhook({
      webhook: webhookRow({ target_type: "automation" }),
      parsedBody: body,
      rawBody: JSON.stringify(body),
      headerIdempotencyKey: undefined,
      deps,
    });

    expect(response.statusCode).toBe(202);
    expect(delivery.resolution_status).toBe("ok");
    expect(dispatchCalls[0].trigger.routineInputOverride).toEqual(body);
    expect(dispatchCalls[0].trigger.appendedInstructions).toBeNull();
    expect(deferOptions[0]).toEqual({ deferContinuation: true });
    expect(continueCalls[0]).toMatchObject({
      triggerFamily: "webhook",
      triggerSource: "webhook:hook-1",
      routineInputOverride: body,
      runId: "run-2",
      iterationId: "iter-2",
    });
  });

  it("uses the x-idempotency-key header as the dispatch key when the sender sends one", async () => {
    const { deps, dispatchCalls } = fakeDeps({ targetKind: "agent_thread" });
    await dispatchAutomationWebhook({
      webhook: webhookRow(),
      parsedBody: {},
      rawBody: "{}",
      headerIdempotencyKey: "delivery-42",
      deps,
    });
    expect(dispatchCalls[0].trigger.idempotencyKey).toBe("delivery-42");
  });

  it("reused dispatch → 200 replay", async () => {
    const { deps } = fakeDeps({
      targetKind: "agent_thread",
      dispatchResult: { status: "reused", runId: "run-1", runStatus: "queued" },
    });
    const { response, delivery } = await dispatchAutomationWebhook({
      webhook: webhookRow(),
      parsedBody: {},
      rawBody: "{}",
      headerIdempotencyKey: undefined,
      deps,
    });
    expect(response.statusCode).toBe(200);
    expect(delivery).toMatchObject({
      resolution_status: "ok",
      is_replay: true,
    });
    expect(JSON.parse(response.body!)).toMatchObject({ deduplicated: true });
  });

  it("guard skip (max_concurrent_runs) → 429 with Retry-After", async () => {
    const { deps } = fakeDeps({
      targetKind: "agent_thread",
      dispatchResult: {
        status: "skipped",
        runId: "run-3",
        iterationId: "iter-3",
        reason: "concurrency cap",
      },
      errorCode: "max_concurrent_runs",
    });
    const { response, delivery } = await dispatchAutomationWebhook({
      webhook: webhookRow(),
      parsedBody: {},
      rawBody: "{}",
      headerIdempotencyKey: undefined,
      deps,
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers?.["Retry-After"]).toBe("60");
    expect(delivery).toMatchObject({
      resolution_status: "rate_limited",
      status_code: 429,
    });
  });

  it("disabled/paused automation skip → 2xx, drop recorded, no retry", async () => {
    const { deps } = fakeDeps({
      targetKind: "agent_thread",
      dispatchResult: {
        status: "skipped",
        runId: "run-4",
        iterationId: "iter-4",
        reason: "AgentLoop is disabled.",
      },
      errorCode: "agent_loop_disabled",
    });
    const { response, delivery } = await dispatchAutomationWebhook({
      webhook: webhookRow(),
      parsedBody: {},
      rawBody: "{}",
      headerIdempotencyKey: undefined,
      deps,
    });
    expect(response.statusCode).toBe(200);
    expect(delivery).toMatchObject({
      resolution_status: "ignored",
      status_code: 200,
      error_message: "AgentLoop is disabled.",
    });
  });

  it("run_as_tenant_mismatch skip → 2xx (a retry won't fix it)", async () => {
    const { deps } = fakeDeps({
      targetKind: "agent_thread",
      dispatchResult: {
        status: "skipped",
        runId: "run-5",
        iterationId: "iter-5",
        reason: "run-as belongs to a different tenant",
      },
      errorCode: "run_as_tenant_mismatch",
    });
    const { response } = await dispatchAutomationWebhook({
      webhook: webhookRow(),
      parsedBody: {},
      rawBody: "{}",
      headerIdempotencyKey: undefined,
      deps,
    });
    expect(response.statusCode).toBe(200);
  });

  it("context load failure → 500", async () => {
    const { deps } = fakeDeps();
    deps.loadContext = vi.fn(async () => ({
      ok: false as const,
      message: "Automation loop-1 not found",
    }));
    const { response, delivery } = await dispatchAutomationWebhook({
      webhook: webhookRow(),
      parsedBody: {},
      rawBody: "{}",
      headerIdempotencyKey: undefined,
      deps,
    });
    expect(response.statusCode).toBe(500);
    expect(delivery.resolution_status).toBe("error");
  });
});
