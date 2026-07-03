import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  resolveChatInvokeIdentity,
  type ChatInvokeIdentityDeps,
} from "./chat-agent-invoke.js";
import { buildDefaultAgentTurnWakeup } from "../lib/mentions/default-agent-routing.js";

/**
 * Sender-injection parity contract (plan 2026-07-03-003 U8, R12/KTD7).
 *
 * Every dispatch path must resolve the *triggering sender* identically so
 * the agent turn always runs against that sender's workspace + memory bank
 * — not the thread creator's. There are two independent paths:
 *
 *  - Direct invoke (chat-agent-invoke.ts `resolveChatInvokeIdentity`):
 *    re-resolves identity from the message row via `loadMessageSender`. The
 *    direct-invoke payload carries no sender field, but that is HARMLESS
 *    precisely because this resolver reads the message row itself.
 *  - Wakeup fallback (default-agent-routing.ts `buildDefaultAgentTurnWakeup`
 *    → wakeup-processor.ts): does NOT re-read the message; it trusts the
 *    `requested_by_actor_type/id` stamped on the wakeup row at enqueue time.
 *    So parity here means: the stamped actor MUST equal the message sender.
 *
 * The recurring dispatch-parity bug class (see
 * wakeup-processor-payload-parity-with-chat-agent-invoke-2026-06-12) always
 * passed first-turn E2E and only regressed on the *resume* turn — so this
 * suite exercises a resume turn explicitly, not just the opening message.
 *
 * KTD7 prediction (confirmed by these tests): no gap exists. Direct invoke
 * re-resolves from the message row; the wakeup builder stamps the sender
 * through unchanged. No fields were added to either builder.
 */

function deps(
  overrides: Partial<ChatInvokeIdentityDeps> = {},
): ChatInvokeIdentityDeps {
  return {
    loadMessageSender: vi.fn(async () => null),
    loadThreadCreator: vi.fn(async () => null),
    loadAgentHumanPair: vi.fn(async () => null),
    loadUserEmail: vi.fn(async (userId) => `${userId}@example.com`),
    ...overrides,
  };
}

/**
 * Mirror of the wakeup-processor invoker rule (wakeup-processor.ts ~635-638):
 * only a `user` actor yields a CURRENT_USER_ID; system/agent actors leave it
 * undefined. A source-inspection guard below binds this mirror to the real
 * handler so the two seams can't drift silently.
 */
function deriveWakeupInvokerUserId(wakeup: {
  requestedByActorType: string;
  requestedByActorId: string | null;
}): string | undefined {
  return wakeup.requestedByActorType === "user" && wakeup.requestedByActorId
    ? wakeup.requestedByActorId
    : undefined;
}

const baseArgs = {
  threadId: "thread-bob",
  tenantId: "tenant-1",
  agentId: "agent-1",
};

// The multiplayer case that matters: Bob posts into a thread Alice created.
const ALICE = "user-alice-creator";
const BOB = "user-bob-sender";

describe("dispatch identity parity (direct invoke vs wakeup fallback) — R12", () => {
  it("(a) direct invoke resolves the message sender, not the thread creator", async () => {
    // Alice created the thread; Bob sent the triggering message.
    const subject = deps({
      loadMessageSender: vi.fn(async () => ({
        sender_id: BOB,
        sender_type: "user",
      })),
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: ALICE,
        created_by_type: "user",
      })),
    });

    const identity = await resolveChatInvokeIdentity(
      { ...baseArgs, messageId: "message-bob-1" },
      subject,
    );

    expect(identity.currentUserId).toBe(BOB);
    expect(identity.source).toBe("message_sender");
    // Parity would be broken if this fell through to the thread creator.
    expect(identity.currentUserId).not.toBe(ALICE);
    expect(subject.loadThreadCreator).not.toHaveBeenCalled();
  });

  it("(b) wakeup fallback resolves the same sender for the same message", () => {
    const wakeup = buildDefaultAgentTurnWakeup({
      tenantId: "tenant-1",
      threadId: "thread-bob",
      messageId: "message-bob-1",
      agentId: "agent-1",
      content: "Bob's question",
      // sendMessage stamps the triggering sender here; the wakeup row carries
      // it through to the processor as requested_by_actor_type/id.
      sender: { type: "user", id: BOB },
    });

    expect(wakeup.requestedByActorType).toBe("user");
    expect(wakeup.requestedByActorId).toBe(BOB);

    // The processor derives CURRENT_USER_ID from exactly those two fields.
    expect(deriveWakeupInvokerUserId(wakeup)).toBe(BOB);
    expect(deriveWakeupInvokerUserId(wakeup)).not.toBe(ALICE);
  });

  it("(a)+(b) both paths agree on the sender for the same triggering message", async () => {
    const directIdentity = await resolveChatInvokeIdentity(
      { ...baseArgs, messageId: "message-bob-1" },
      deps({
        loadMessageSender: vi.fn(async () => ({
          sender_id: BOB,
          sender_type: "user",
        })),
        loadThreadCreator: vi.fn(async () => ({
          created_by_id: ALICE,
          created_by_type: "user",
        })),
      }),
    );

    const wakeup = buildDefaultAgentTurnWakeup({
      tenantId: "tenant-1",
      threadId: "thread-bob",
      messageId: "message-bob-1",
      agentId: "agent-1",
      content: "Bob's question",
      sender: { type: "user", id: BOB },
    });

    expect(directIdentity.currentUserId).toBe(deriveWakeupInvokerUserId(wakeup));
  });

  it("(c) a resume/wakeup turn resolves identically to the first turn (not just first-turn)", async () => {
    // The recurring bug always passed the opening message and regressed on the
    // resume. Model a second message (an answer Bob posts to resume the turn)
    // and prove both paths still land on Bob.
    const resumeMessageId = "message-bob-answer-2";

    const directResume = await resolveChatInvokeIdentity(
      { ...baseArgs, messageId: resumeMessageId },
      deps({
        loadMessageSender: vi.fn(async () => ({
          sender_id: BOB,
          sender_type: "user",
        })),
        loadThreadCreator: vi.fn(async () => ({
          created_by_id: ALICE,
          created_by_type: "user",
        })),
      }),
    );

    // A question_answer resume re-enqueues through the same builder, carrying
    // the answering user's identity — same seam, same stamping.
    const resumeWakeup = buildDefaultAgentTurnWakeup({
      tenantId: "tenant-1",
      threadId: "thread-bob",
      messageId: resumeMessageId,
      agentId: "agent-1",
      content: "Bob's answer",
      sender: { type: "user", id: BOB },
    });

    expect(directResume.currentUserId).toBe(BOB);
    expect(directResume.source).toBe("message_sender");
    expect(deriveWakeupInvokerUserId(resumeWakeup)).toBe(BOB);
    expect(directResume.currentUserId).toBe(
      deriveWakeupInvokerUserId(resumeWakeup),
    );
  });

  it("(d) direct-invoke fallback order: no messageId → thread creator", async () => {
    const identity = await resolveChatInvokeIdentity(
      baseArgs, // no messageId
      deps({
        loadThreadCreator: vi.fn(async () => ({
          created_by_id: ALICE,
          created_by_type: "user",
        })),
      }),
    );
    expect(identity).toEqual({
      currentUserId: ALICE,
      currentUserEmail: `${ALICE}@example.com`,
      source: "thread_creator",
    });
  });

  it("(d) direct-invoke fallback order: computer-created thread → agent human pair", async () => {
    const identity = await resolveChatInvokeIdentity(
      baseArgs,
      deps({
        loadThreadCreator: vi.fn(async () => ({
          created_by_id: "computer-1",
          created_by_type: "computer",
        })),
        loadAgentHumanPair: vi.fn(async () => "paired-human"),
      }),
    );
    expect(identity).toEqual({
      currentUserId: "paired-human",
      currentUserEmail: "paired-human@example.com",
      source: "computer_agent_human_pair",
    });
  });

  it("(d) direct-invoke fallback order: nothing resolvable → none", async () => {
    const identity = await resolveChatInvokeIdentity(
      baseArgs,
      deps({
        loadThreadCreator: vi.fn(async () => ({
          created_by_id: null,
          created_by_type: "system",
        })),
      }),
    );
    expect(identity).toEqual({
      currentUserId: "",
      currentUserEmail: "",
      source: "none",
    });
  });

  it("(d) wakeup fallback: a non-user actor yields no CURRENT_USER_ID", () => {
    // System/agent-triggered wakeups (automations, schedules) intentionally
    // carry no invoking user, so the wakeup path resolves to undefined — this
    // is the honest-invoker contract, not a parity break with a *human* send.
    const systemWakeup = buildDefaultAgentTurnWakeup({
      tenantId: "tenant-1",
      threadId: "thread-bob",
      messageId: "message-sys-1",
      agentId: "agent-1",
      content: "system trigger",
      sender: { type: "system", id: null },
    });
    expect(deriveWakeupInvokerUserId(systemWakeup)).toBeUndefined();
  });

  it("binds the local wakeup-invoker mirror to the real processor rule", () => {
    // Guard against silent drift: if wakeup-processor stops deriving the
    // invoker from `requested_by_actor_type === "user"`, this parity suite's
    // mirror is stale and the test must be revisited.
    const source = readFileSync(
      new URL("./wakeup-processor.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'wakeup.requested_by_actor_type === "user" && wakeup.requested_by_actor_id',
    );
    // And the builder stamps that same actor type from the send-time sender.
    const routingSource = readFileSync(
      new URL("../lib/mentions/default-agent-routing.ts", import.meta.url),
      "utf8",
    );
    expect(routingSource).toContain(
      'requestedByActorType: input.sender?.type ?? "user"',
    );
    expect(routingSource).toContain(
      "requestedByActorId: input.sender?.id ?? null",
    );
  });
});
