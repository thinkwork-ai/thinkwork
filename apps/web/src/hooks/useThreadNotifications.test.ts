import { describe, it, expect } from "vitest";
import {
  shouldRaiseNotification,
  buildNotificationBody,
  type NotificationSuppressionState,
} from "./useThreadNotifications";

const base: NotificationSuppressionState = {
  userId: "me",
  activeThreadId: null,
  appFocused: true,
  enabled: true,
};

const activity = (over: Partial<{ threadId: string; authorId: string | null }> = {}) => ({
  threadId: "th1",
  authorId: "someone-else",
  ...over,
});

describe("shouldRaiseNotification", () => {
  it("raises for a teammate's message in an unviewed thread", () => {
    expect(shouldRaiseNotification(activity(), base)).toBe(true);
  });

  it("suppresses the current user's own message (R3)", () => {
    expect(shouldRaiseNotification(activity({ authorId: "me" }), base)).toBe(false);
  });

  it("suppresses when app focused AND viewing that exact thread (R5)", () => {
    expect(
      shouldRaiseNotification(activity({ threadId: "th1" }), {
        ...base,
        activeThreadId: "th1",
        appFocused: true,
      }),
    ).toBe(false);
  });

  it("raises when viewing that thread but app is blurred (R5)", () => {
    expect(
      shouldRaiseNotification(activity({ threadId: "th1" }), {
        ...base,
        activeThreadId: "th1",
        appFocused: false,
      }),
    ).toBe(true);
  });

  it("raises when app focused but viewing a DIFFERENT thread (R5)", () => {
    expect(
      shouldRaiseNotification(activity({ threadId: "th1" }), {
        ...base,
        activeThreadId: "th2",
        appFocused: true,
      }),
    ).toBe(true);
  });

  it("suppresses everything when the toggle is off (U7)", () => {
    expect(shouldRaiseNotification(activity(), { ...base, enabled: false })).toBe(false);
  });

  it("does not suppress an agent message just because authorId is null", () => {
    expect(shouldRaiseNotification(activity({ authorId: null }), base)).toBe(true);
  });
});

describe("buildNotificationBody", () => {
  it("uses the snippet for a single message (R11)", () => {
    expect(buildNotificationBody({ count: 1, snippet: "hello there" })).toBe("hello there");
  });

  it("falls back to a default when no snippet", () => {
    expect(buildNotificationBody({ count: 1, snippet: null })).toBe("New message");
    expect(buildNotificationBody({ count: 1, snippet: "   " })).toBe("New message");
  });

  it("collapses a coalesced burst to a count (R4/R6)", () => {
    expect(buildNotificationBody({ count: 5, snippet: "ignored" })).toBe("5 new messages");
  });
});
