import { describe, expect, it } from "vitest";
import {
  InMemorySessionStore,
  compactSessionRecord,
  shouldCompactSession,
} from "./session-store";
import type { AgentEvent, Message } from "./types";

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

describe("InMemorySessionStore", () => {
  it("persists transcript events and stop reason with appended messages", async () => {
    const store = new InMemorySessionStore();
    const events: AgentEvent[] = [
      { type: "agent_start", step: 0, toolNames: ["bash"] },
      {
        type: "agent_end",
        stopReason: "completed",
        steps: 1,
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    ];

    const saved = await store.append(
      "thread-1",
      [msg("user", "hi"), msg("assistant", "hello")],
      100,
      { events, stopReason: "completed" },
    );

    expect(saved.events?.map((event) => event.type)).toEqual([
      "agent_start",
      "agent_end",
    ]);
    expect(saved.stopReason).toBe("completed");

    const loaded = await store.load("thread-1");
    expect(loaded?.messages.map((message) => message.content)).toEqual([
      "hi",
      "hello",
    ]);
    expect(loaded?.events).not.toBe(events);
  });
});

describe("session compaction", () => {
  it("summarizes older messages and keeps recent context when over threshold", () => {
    const record = {
      id: "thread-1",
      updatedAt: 100,
      messages: Array.from({ length: 6 }, (_, i) =>
        msg(i % 2 === 0 ? "user" : "assistant", `message ${i + 1}`),
      ),
    };

    expect(shouldCompactSession(record, 5)).toBe(true);

    const compacted = compactSessionRecord(record, {
      threshold: 5,
      keepMessages: 2,
      createdAt: 200,
    });

    expect(compacted.messages.map((message) => message.content)).toEqual([
      "message 5",
      "message 6",
    ]);
    expect(compacted.compaction).toMatchObject({
      messageCount: 4,
      createdAt: 200,
    });
    expect(compacted.compaction?.summary).toContain("user: message 1");
  });
});
