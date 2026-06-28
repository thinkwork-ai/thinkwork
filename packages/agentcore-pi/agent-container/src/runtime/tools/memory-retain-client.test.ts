import { describe, expect, it } from "vitest";

import {
  buildMemoryRetainRequest,
  buildRetainTranscript,
} from "./memory-retain-client.js";
import type { IdentitySnapshot } from "../../handler-context.js";

const identity: IdentitySnapshot = {
  tenantId: "tenant-1",
  userId: "user-1",
  agentId: "agent-1",
  threadId: "thread-1",
  tenantSlug: "tenant",
  agentSlug: "agent",
  traceId: "trace-1",
};

describe("memory-retain-client", () => {
  it("builds the transcript tail from history, user message, and assistant content", () => {
    expect(
      buildRetainTranscript(
        {
          messages_history: [
            { role: "system", content: "ignore" },
            { role: "user", content: "Birdie is my poodle." },
            { role: "assistant", content: "Got it." },
            { role: "assistant", content: "  " },
          ],
          message: "Her favorite toy is Orbit.",
        },
        "I'll remember that.",
      ),
    ).toEqual([
      { role: "user", content: "Birdie is my poodle." },
      { role: "assistant", content: "Got it." },
      { role: "user", content: "Her favorite toy is Orbit." },
      { role: "assistant", content: "I'll remember that." },
    ]);
  });

  it("passes thread turn and space scope through to the retain Lambda", () => {
    expect(
      buildMemoryRetainRequest(
        {
          use_memory: true,
          thread_turn_id: "turn-1",
          message: "In the Launch space, release codename is Bluejay.",
        },
        { ...identity, spaceId: "space-1" },
        "Noted.",
      ),
    ).toMatchObject({
      tenantId: "tenant-1",
      userId: "user-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      spaceId: "space-1",
      metadata: {
        threadTurnId: "turn-1",
        spaceId: "space-1",
        sourceEventKey: "thread-turn:turn-1",
      },
    });
  });
});
