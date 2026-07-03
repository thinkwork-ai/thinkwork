import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { useSubscription } from "urql";
import {
  shouldRaiseNotification,
  buildNotificationBody,
  useThreadNotifications,
  type NotificationSuppressionState,
  type ThreadActivityLike,
} from "./useThreadNotifications";
import { getDesktopBridge } from "../lib/desktop-runtime";

vi.mock("urql", () => ({ useSubscription: vi.fn() }));
vi.mock("../context/TenantContext", () => ({
  useTenant: () => ({
    userId: "me",
    tenantId: "t1",
    role: null,
    pendingClaim: false,
  }),
}));
vi.mock("../lib/desktop-runtime", () => ({ getDesktopBridge: vi.fn() }));

const base: NotificationSuppressionState = {
  userId: "me",
  activeThreadId: null,
  appFocused: true,
  enabled: true,
};

const activity = (
  over: Partial<{
    threadId: string;
    authorId: string | null;
    mentioned: boolean | null;
    shouldNotify: boolean | null;
  }> = {},
) => ({
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

  it("suppresses when the server marks the event shouldNotify:false (muted, R10)", () => {
    expect(
      shouldRaiseNotification(activity({ shouldNotify: false }), base),
    ).toBe(false);
  });

  it("raises on a direct mention that punches through mute (shouldNotify:true, AE6)", () => {
    expect(
      shouldRaiseNotification(
        activity({ shouldNotify: true, mentioned: true }),
        base,
      ),
    ).toBe(true);
  });

  it("treats an absent/null shouldNotify as true for legacy-event backward compat", () => {
    expect(shouldRaiseNotification(activity({ shouldNotify: null }), base)).toBe(
      true,
    );
    expect(shouldRaiseNotification(activity(), base)).toBe(true);
  });

  it("still suppresses the user's own message even when shouldNotify is true", () => {
    expect(
      shouldRaiseNotification(
        activity({ authorId: "me", shouldNotify: true }),
        base,
      ),
    ).toBe(false);
  });
});

describe("useThreadNotifications (subscription consumer)", () => {
  let capturedHandler:
    | ((prev: unknown, event: { onThreadActivity?: ThreadActivityLike }) => unknown)
    | null = null;

  const raiseThreadNotification = vi.fn();
  const bridge = {
    raiseThreadNotification,
    onWindowFocusChange: vi.fn(() => () => {}),
  };

  const drive = (over?: Parameters<typeof activity>[0]) =>
    act(() => {
      capturedHandler?.(undefined, { onThreadActivity: activity(over) });
    });

  beforeEach(() => {
    capturedHandler = null;
    raiseThreadNotification.mockReset();
    vi.mocked(useSubscription).mockImplementation((_options, handler) => {
      capturedHandler = handler as typeof capturedHandler;
      return [{ data: null, fetching: false, stale: false }, () => {}] as never;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onActivity for every event — muted, own-message, no bridge — for R9 liveness", () => {
    vi.mocked(getDesktopBridge).mockReturnValue(null);
    const onActivity = vi.fn();
    renderHook(() => useThreadNotifications({ onActivity }));

    drive(); // normal
    drive({ authorId: "me" }); // own message (notify-suppressed)
    drive({ shouldNotify: false }); // muted (notify-suppressed)

    // Liveness is independent of the notification decision and the bridge.
    expect(onActivity).toHaveBeenCalledTimes(3);
    // No desktop bridge → no native notification ever raised.
    expect(raiseThreadNotification).not.toHaveBeenCalled();
  });

  it("does not subscribe until a userId exists but still runs on the web build (no bridge)", () => {
    vi.mocked(getDesktopBridge).mockReturnValue(null);
    renderHook(() => useThreadNotifications({ onActivity: vi.fn() }));
    const opts = vi.mocked(useSubscription).mock.calls.at(-1)?.[0] as {
      pause?: boolean;
      variables?: { userId?: string };
    };
    // userId "me" is present → not paused; only userId gates the subscription.
    expect(opts.pause).toBe(false);
    expect(opts.variables?.userId).toBe("me");
  });

  it("coalesces a same-thread burst into a single native notification (desktop)", () => {
    vi.useFakeTimers();
    vi.mocked(getDesktopBridge).mockReturnValue(bridge as never);
    renderHook(() => useThreadNotifications({ onActivity: vi.fn() }));

    drive();
    drive();
    drive();
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(raiseThreadNotification).toHaveBeenCalledTimes(1);
    expect(raiseThreadNotification.mock.calls[0][0]).toMatchObject({ count: 3 });
  });

  it("raises no native notification for a muted event but still drives liveness", () => {
    vi.useFakeTimers();
    vi.mocked(getDesktopBridge).mockReturnValue(bridge as never);
    const onActivity = vi.fn();
    renderHook(() => useThreadNotifications({ onActivity }));

    drive({ shouldNotify: false });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(raiseThreadNotification).not.toHaveBeenCalled();
    expect(onActivity).toHaveBeenCalledTimes(1);
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
