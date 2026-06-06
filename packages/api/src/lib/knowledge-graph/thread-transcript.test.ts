import { describe, expect, it } from "vitest";
import {
  extractMessageText,
  renderThreadTranscript,
  toTranscriptMessage,
} from "./thread-transcript.js";

describe("thread transcript", () => {
  it("prefers typed message parts over legacy content", () => {
    expect(
      extractMessageText("legacy", [
        { type: "text", text: "hello" },
        { type: "step", parts: [{ text: "world" }] },
      ]),
    ).toBe("hello\nworld");
  });

  it("normalizes rows into chronological transcript entries", () => {
    const message = toTranscriptMessage(
      {
        id: "message-1",
        role: "assistant",
        content: "Acme depends on Delta.",
        parts: null,
        sender_type: "agent",
        sender_id: "agent-1",
        created_at: "2026-06-04T12:00:00.000Z",
      },
      0,
    );

    expect(message).toEqual(
      expect.objectContaining({
        id: "message-1",
        speakerLabel: "Agent",
        text: "Acme depends on Delta.",
        ordinal: 0,
      }),
    );
    expect(renderThreadTranscript([message])).toContain(
      "<!-- message:message-1 role:assistant speaker:Agent",
    );
  });
});
