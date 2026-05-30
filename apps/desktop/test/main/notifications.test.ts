import { describe, expect, it, vi, beforeEach } from "vitest";
import { OPEN_THREAD_EVENT_CHANNEL } from "@thinkwork/desktop-ipc";

// Hoisted electron mock — records Notification instances + click/close handlers,
// and a single fake window whose webContents.send we can assert on.
const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instances: any[] = [];
  class MockNotification {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any;
    handlers: Record<string, Array<() => void>> = {};
    show = vi.fn();
    close = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(options: any) {
      this.options = options;
      instances.push(this);
    }
    on(event: string, cb: () => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    emit(event: string) {
      (this.handlers[event] ?? []).forEach((cb) => cb());
    }
    static isSupported = vi.fn(() => true);
  }
  const window = {
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
  return { instances, MockNotification, window };
});

vi.mock("electron", () => ({
  Notification: h.MockNotification,
  BrowserWindow: { getAllWindows: () => [h.window] },
}));

const { raiseThreadNotification, __resetThreadNotificationsForTest } =
  await import("../../src/main/notifications.js");

describe("raiseThreadNotification", () => {
  beforeEach(() => {
    h.instances.length = 0;
    h.MockNotification.isSupported.mockReturnValue(true);
    h.window.isMinimized.mockReturnValue(false);
    h.window.restore.mockReset();
    h.window.focus.mockReset();
    h.window.webContents.send.mockReset();
    __resetThreadNotificationsForTest();
  });

  it("creates and shows a notification with the given title/body", () => {
    raiseThreadNotification({ threadId: "th1", title: "Scott", body: "hey there" });

    expect(h.instances).toHaveLength(1);
    expect(h.instances[0].options).toMatchObject({ title: "Scott", body: "hey there" });
    expect(h.instances[0].show).toHaveBeenCalledTimes(1);
  });

  it("coalesces: a second raise for the same thread closes the prior one (R4)", () => {
    raiseThreadNotification({ threadId: "th1", title: "a", body: "1" });
    raiseThreadNotification({ threadId: "th1", title: "b", body: "2" });

    expect(h.instances).toHaveLength(2);
    expect(h.instances[0].close).toHaveBeenCalledTimes(1); // prior replaced
    expect(h.instances[1].show).toHaveBeenCalledTimes(1);
  });

  it("does not close a notification for a different thread", () => {
    raiseThreadNotification({ threadId: "th1", title: "a", body: "1" });
    raiseThreadNotification({ threadId: "th2", title: "b", body: "2" });

    expect(h.instances[0].close).not.toHaveBeenCalled();
    expect(h.instances).toHaveLength(2);
  });

  it("is a no-op when notifications are unsupported", () => {
    h.MockNotification.isSupported.mockReturnValue(false);

    expect(() =>
      raiseThreadNotification({ threadId: "th9", title: "x", body: "y" }),
    ).not.toThrow();
    expect(h.instances).toHaveLength(0);
  });

  it("on click, focuses the window and pushes an open-thread event (R7)", () => {
    raiseThreadNotification({ threadId: "th5", title: "x", body: "y" });

    h.instances[0].emit("click");

    expect(h.window.focus).toHaveBeenCalledTimes(1);
    expect(h.window.webContents.send).toHaveBeenCalledWith(
      OPEN_THREAD_EVENT_CHANNEL,
      { threadId: "th5" },
    );
  });

  it("on click, restores a minimized window before focusing", () => {
    h.window.isMinimized.mockReturnValue(true);
    raiseThreadNotification({ threadId: "th6", title: "x", body: "y" });

    h.instances[0].emit("click");

    expect(h.window.restore).toHaveBeenCalledTimes(1);
    expect(h.window.focus).toHaveBeenCalledTimes(1);
  });
});
