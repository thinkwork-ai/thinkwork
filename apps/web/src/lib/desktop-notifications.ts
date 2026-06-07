import { toast } from "sonner";
import { isDesktop } from "./desktop-detection";

export interface DesktopNotificationMessage {
  title: string;
  body?: string;
}

export interface NotificationApiLike {
  permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): unknown;
}

export interface DesktopNotificationDependencies {
  isDesktop?: () => boolean;
  notificationApi?: NotificationApiLike | null;
  toastMessage?: (message: string, options?: { description?: string }) => void;
}

export async function requestDesktopNotificationPermission(
  dependencies: DesktopNotificationDependencies = {},
): Promise<NotificationPermission | "unsupported" | "web"> {
  if (!resolveIsDesktop(dependencies)) return "web";

  const notificationApi = resolveNotificationApi(dependencies);
  if (!notificationApi) return "unsupported";
  if (notificationApi.permission !== "default")
    return notificationApi.permission;

  return notificationApi.requestPermission();
}

export async function notifyAgentCompletion(
  message: DesktopNotificationMessage,
  dependencies: DesktopNotificationDependencies = {},
): Promise<"native" | "toast" | "skipped"> {
  if (!resolveIsDesktop(dependencies)) return "skipped";

  const notificationApi = resolveNotificationApi(dependencies);
  const permission = await requestDesktopNotificationPermission({
    ...dependencies,
    notificationApi,
  });

  if (permission === "granted" && notificationApi) {
    new notificationApi(message.title, { body: message.body });
    return "native";
  }

  const toastMessage = dependencies.toastMessage ?? toast.message;
  toastMessage(message.title, { description: message.body });
  return "toast";
}

function resolveIsDesktop(
  dependencies: DesktopNotificationDependencies,
): boolean {
  return (dependencies.isDesktop ?? isDesktop)();
}

function resolveNotificationApi(
  dependencies: DesktopNotificationDependencies,
): NotificationApiLike | null {
  if (dependencies.notificationApi !== undefined) {
    return dependencies.notificationApi;
  }

  return typeof Notification === "undefined"
    ? null
    : (Notification as NotificationApiLike);
}
