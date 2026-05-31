import { describe, expect, it } from "vitest";
import {
  MobileTurnCheckpointError,
  renderMobileHandoffPrompt,
  selectMobileTurnCheckpoint,
} from "./checkpoint";

const baseline = {
  mobile_turn: {
    checkpoint_0: {
      kind: "baseline",
      safe: true,
      seq: 0,
      user_text: "Use bash to print hello",
    },
  },
};

describe("mobile turn checkpoint selection", () => {
  it("uses checkpoint 0 when no later safe checkpoint exists", () => {
    const selection = selectMobileTurnCheckpoint({
      contextSnapshot: baseline,
      events: [],
    });

    expect(selection.checkpoint.seq).toBe(0);
    expect(selection.baseline.userText).toBe("Use bash to print hello");
    expect(selection.unsafeCheckpointSkipped).toBe(false);
  });

  it("selects the latest safe checkpoint from event evidence", () => {
    const selection = selectMobileTurnCheckpoint({
      contextSnapshot: baseline,
      events: [
        {
          seq: 1,
          event_type: "mobile_pi_checkpoint",
          payload: {
            seq: 1,
            safe: true,
            event_type: "assistant_text",
            transcript: [{ role: "assistant", content: "Working..." }],
          },
        },
        {
          seq: 2,
          event_type: "mobile_pi_checkpoint",
          payload: {
            seq: 2,
            safe: true,
            name: "web_search",
            result: { content: "fresh evidence" },
          },
        },
      ],
    });

    expect(selection.checkpoint.seq).toBe(2);
    expect(selection.latestSeq).toBe(2);
  });

  it("falls back when the newest checkpoint is unsafe", () => {
    const selection = selectMobileTurnCheckpoint({
      contextSnapshot: baseline,
      events: [
        {
          seq: 1,
          event_type: "mobile_pi_checkpoint",
          payload: { seq: 1, safe: true, text: "safe text" },
        },
        {
          seq: 2,
          event_type: "mobile_pi_checkpoint",
          payload: {
            seq: 2,
            safe: false,
            event_type: "tool_call",
            unsafe_reason: "tool_call_in_flight",
          },
        },
      ],
    });

    expect(selection.checkpoint.seq).toBe(1);
    expect(selection.latestSeq).toBe(2);
    expect(selection.unsafeCheckpointSkipped).toBe(true);
    expect(selection.unsafeCheckpoint?.unsafeReason).toBe(
      "tool_call_in_flight",
    );
  });

  it("fails closed when checkpoint 0 is missing or corrupt", () => {
    expect(() =>
      selectMobileTurnCheckpoint({
        contextSnapshot: { mobile_turn: {} },
      }),
    ).toThrow(MobileTurnCheckpointError);
  });

  it("renders a continuation prompt for AgentCore", () => {
    const selection = selectMobileTurnCheckpoint({
      contextSnapshot: baseline,
      events: [
        {
          seq: 1,
          event_type: "mobile_pi_checkpoint",
          payload: {
            seq: 1,
            safe: true,
            transcript: [
              { role: "user", content: "Use bash to print hello" },
              { role: "assistant", content: "I ran bash." },
            ],
            result: { content: "hello" },
          },
        },
      ],
    });

    const prompt = renderMobileHandoffPrompt(selection);
    expect(prompt).toContain("managed AWS AgentCore Pi runtime");
    expect(prompt).toContain("Original user message");
    expect(prompt).toContain("Use bash to print hello");
    expect(prompt).toContain("assistant: I ran bash.");
  });
});
