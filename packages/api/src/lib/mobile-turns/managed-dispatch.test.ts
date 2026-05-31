import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  processStaleMobileHandoffs,
  type ProcessStaleMobileHandoffsDeps,
  type StaleMobileTurnCandidate,
} from "./managed-dispatch";

const NOW = new Date("2026-05-31T14:00:00.000Z");

function candidate(
  overrides: Partial<StaleMobileTurnCandidate> = {},
): StaleMobileTurnCandidate {
  return {
    id: "turn-1",
    tenantId: "tenant-1",
    agentId: "agent-1",
    threadId: "thread-1",
    lastActivityAt: new Date("2026-05-31T13:59:00.000Z"),
    contextSnapshot: {
      mobile_turn: {
        user_message_id: "msg-user-1",
        checkpoint_0: {
          kind: "baseline",
          safe: true,
          seq: 0,
          user_text: "What is my name?",
        },
      },
    },
    ...overrides,
  };
}

function deps(
  candidates: StaleMobileTurnCandidate[],
): ProcessStaleMobileHandoffsDeps {
  return {
    now: () => NOW,
    listCandidates: vi.fn(async () => candidates),
    loadEvents: vi.fn(async () => [
      {
        seq: 1,
        event_type: "mobile_pi_checkpoint",
        payload: {
          seq: 1,
          safe: true,
          transcript: [
            { role: "user", content: "What is my name?" },
            { role: "assistant", content: "Checking workspace." },
          ],
        },
      },
    ]),
    claimTurn: vi.fn(async () => true),
    appendEvent: vi.fn(async () => undefined),
    failTurn: vi.fn(async () => undefined),
    dispatch: vi.fn(async () => undefined),
  };
}

describe("managed mobile handoff dispatch", () => {
  let subject: ProcessStaleMobileHandoffsDeps;

  beforeEach(() => {
    subject = deps([candidate()]);
  });

  it("claims a stale mobile turn once and dispatches AgentCore with the same turn id", async () => {
    const result = await processStaleMobileHandoffs(subject);

    expect(result).toMatchObject({
      scanned: 1,
      claimed: 1,
      dispatched: 1,
      failed: 0,
    });
    expect(subject.claimTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointSeq: 1,
        latestObservedCheckpointSeq: 1,
      }),
    );
    expect(subject.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "msg-user-1",
        existingThreadTurnId: "turn-1",
        mobileHandoff: expect.objectContaining({ checkpointSeq: 1 }),
      }),
    );
    expect(vi.mocked(subject.appendEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mobile_pi_managed_claim",
        message: "managed Pi claimed",
      }),
    );
  });

  it("skips dispatch when a racing watchdog already claimed the turn", async () => {
    vi.mocked(subject.claimTurn).mockResolvedValue(false);

    const result = await processStaleMobileHandoffs(subject);

    expect(result).toMatchObject({ claimed: 0, dispatched: 0, skipped: 1 });
    expect(subject.dispatch).not.toHaveBeenCalled();
  });

  it("falls back from an unsafe latest checkpoint and records activity", async () => {
    vi.mocked(subject.loadEvents).mockResolvedValue([
      {
        seq: 1,
        event_type: "mobile_pi_checkpoint",
        payload: { seq: 1, safe: true, text: "safe partial answer" },
      },
      {
        seq: 2,
        event_type: "mobile_pi_checkpoint",
        payload: {
          seq: 2,
          safe: false,
          unsafe_reason: "tool_call_in_flight",
        },
      },
    ]);

    await processStaleMobileHandoffs(subject);

    expect(subject.claimTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointSeq: 1,
        latestObservedCheckpointSeq: 2,
        unsafeCheckpointSkipped: true,
      }),
    );
    expect(vi.mocked(subject.appendEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mobile_pi_unsafe_checkpoint_skipped",
        message: "unsafe checkpoint skipped",
      }),
    );
  });

  it("fails closed when the baseline checkpoint is missing", async () => {
    subject = deps([
      candidate({
        contextSnapshot: { mobile_turn: { user_message_id: "msg-user-1" } },
      }),
    ]);

    const result = await processStaleMobileHandoffs(subject);

    expect(result).toMatchObject({ failed: 1, claimed: 0, dispatched: 0 });
    expect(subject.failTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "BASELINE_CHECKPOINT_INVALID",
      }),
    );
  });

  it("marks the turn failed when the managed Lambda dispatch is rejected synchronously", async () => {
    vi.mocked(subject.dispatch).mockRejectedValue(new Error("throttled"));

    const result = await processStaleMobileHandoffs(subject);

    expect(result).toMatchObject({ claimed: 1, dispatched: 0, failed: 1 });
    expect(subject.failTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "MANAGED_DISPATCH_FAILED",
        message: "Managed AgentCore dispatch failed: throttled",
      }),
    );
  });
});
