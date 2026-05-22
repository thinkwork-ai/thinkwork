import { describe, expect, it, vi } from "vitest";
import {
  notifyAgentCompletion,
  requestDesktopNotificationPermission,
  type NotificationApiLike,
} from "./desktop-notifications";

describe("desktop notifications", () => {
  it("requests notification permission in desktop mode", async () => {
    const notificationApi = createNotificationApi("default", "granted");

    await expect(
      requestDesktopNotificationPermission({
        isDesktop: () => true,
        notificationApi,
      }),
    ).resolves.toBe("granted");

    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not request notification permission in web mode", async () => {
    const notificationApi = createNotificationApi("default", "granted");

    await expect(
      requestDesktopNotificationPermission({
        isDesktop: () => false,
        notificationApi,
      }),
    ).resolves.toBe("web");

    expect(notificationApi.requestPermission).not.toHaveBeenCalled();
  });

  it("fires a native notification when permission is granted", async () => {
    const notificationApi = createNotificationApi("granted", "granted");
    const toastMessage = vi.fn();

    await expect(
      notifyAgentCompletion(
        { title: "Agent finished", body: "Thread is ready" },
        {
          isDesktop: () => true,
          notificationApi,
          toastMessage,
        },
      ),
    ).resolves.toBe("native");

    expect(notificationApi.created).toEqual([
      { title: "Agent finished", options: { body: "Thread is ready" } },
    ]);
    expect(toastMessage).not.toHaveBeenCalled();
  });

  it("falls back to sonner-style toast when permission is denied", async () => {
    const notificationApi = createNotificationApi("denied", "denied");
    const toastMessage = vi.fn();

    await expect(
      notifyAgentCompletion(
        { title: "Agent finished", body: "Thread is ready" },
        {
          isDesktop: () => true,
          notificationApi,
          toastMessage,
        },
      ),
    ).resolves.toBe("toast");

    expect(notificationApi.created).toEqual([]);
    expect(toastMessage).toHaveBeenCalledWith("Agent finished", {
      description: "Thread is ready",
    });
  });
});

function createNotificationApi(
  permission: NotificationPermission,
  requestResult: NotificationPermission,
): NotificationApiLike & {
  requestPermission: ReturnType<typeof vi.fn>;
  created: Array<{ title: string; options?: NotificationOptions }>;
} {
  const created: Array<{ title: string; options?: NotificationOptions }> = [];

  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => requestResult);

    constructor(title: string, options?: NotificationOptions) {
      created.push({ title, options });
    }
  }

  return Object.assign(FakeNotification, {
    created,
  }) as unknown as NotificationApiLike & {
    requestPermission: ReturnType<typeof vi.fn>;
    created: Array<{ title: string; options?: NotificationOptions }>;
  };
}
