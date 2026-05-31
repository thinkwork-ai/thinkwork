import { describe, expect, it } from "vitest";
import {
  isMobilePiTurn,
  mobileTurnActivityLabel,
  shouldShowMobileTurnActivityEvent,
  shouldShowThreadWorkingIndicator,
  shouldShowTurnInTimeline,
} from "./activity-timeline-logic";

describe("activity timeline logic", () => {
  it("shows mobile Pi turns to regular users so handoff is visible", () => {
    expect(
      shouldShowTurnInTimeline({ invocationSource: "mobile_pi" }, false),
    ).toBe(true);
    expect(
      shouldShowTurnInTimeline({ invocationSource: "chat_message" }, false),
    ).toBe(false);
    expect(
      shouldShowTurnInTimeline({ invocationSource: "chat_message" }, true),
    ).toBe(true);
  });

  it("recognizes locally finalized mobile turns by result metadata", () => {
    expect(isMobilePiTurn({ resultJson: { source: "mobile_pi" } })).toBe(true);
    expect(isMobilePiTurn({ resultJson: '{"source":"mobile_pi"}' })).toBe(true);
    expect(isMobilePiTurn({ resultJson: { source: "chat" } })).toBe(false);
  });

  it("keeps the working indicator up while a durable running turn exists", () => {
    expect(
      shouldShowThreadWorkingIndicator({
        isLocalThreadActive: false,
        isOptimisticStartRunning: false,
        hasRunningTurn: true,
      }),
    ).toBe(true);
    expect(
      shouldShowThreadWorkingIndicator({
        isLocalThreadActive: false,
        isOptimisticStartRunning: false,
        hasRunningTurn: false,
      }),
    ).toBe(false);
  });

  it("filters and labels mobile handoff activity events", () => {
    expect(
      shouldShowMobileTurnActivityEvent({
        eventType: "mobile_pi_managed_claim",
        message: "managed Pi claimed",
      }),
    ).toBe(true);
    expect(
      shouldShowMobileTurnActivityEvent({
        eventType: "agent_step",
        message: "internal",
      }),
    ).toBe(false);
    expect(
      mobileTurnActivityLabel({
        eventType: "mobile_pi_unsafe_checkpoint_skipped",
        message: "unsafe checkpoint skipped",
      }),
    ).toBe("unsafe checkpoint skipped");
  });
});
