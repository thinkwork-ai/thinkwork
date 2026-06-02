import type {
  PiSidecarState,
  PiSidecarStatus,
  ThinkworkBridge,
} from "@thinkwork/desktop-ipc";

declare global {
  interface Window {
    thinkworkBridge?: ThinkworkBridge;
  }
}

export function isDesktopBuild(): boolean {
  return typeof __DESKTOP_BUILD__ !== "undefined" && __DESKTOP_BUILD__;
}

export function getDesktopBridge(): ThinkworkBridge | null {
  if (!isDesktopBuild()) return null;
  return window.thinkworkBridge ?? null;
}

export function shouldUseDesktopLocalPiDispatch(
  bridge: ThinkworkBridge | null = getDesktopBridge(),
): boolean {
  if (!bridge) return false;
  return isDesktopLocalPiReady(bridge.pi?.status);
}

export async function shouldUseDesktopLocalPiDispatchNow(
  bridge: ThinkworkBridge | null = getDesktopBridge(),
): Promise<boolean> {
  if (!bridge?.pi) return false;
  if (isDesktopLocalPiReady(bridge.pi.status)) return true;
  try {
    const state = await bridge.pi.getStatus();
    return isDesktopLocalPiReady(state.status);
  } catch {
    return false;
  }
}

export function isDesktopLocalPiReady(
  status: PiSidecarStatus | undefined,
): boolean {
  return status === "starting" || status === "healthy";
}

export type DesktopPiEvalTargetStatus =
  | "hidden"
  | "available"
  | "starting"
  | "busy"
  | "unavailable";

export type DesktopLocalPiDisplayStatus =
  | "hidden"
  | "starting"
  | "healthy"
  | "running"
  | "fallback"
  | "unavailable";

export function desktopLocalPiDisplayStatus(input: {
  bridge: ThinkworkBridge | null;
  state?: PiSidecarState | null;
  localTurnRunning?: boolean;
  fallbackActive?: boolean;
}): DesktopLocalPiDisplayStatus {
  if (!input.bridge?.pi) return "hidden";
  if (input.localTurnRunning) return "running";
  if (input.fallbackActive) return "fallback";
  const status = input.state?.status ?? input.bridge.pi.status;
  if (status === "healthy") return "healthy";
  if (status === "starting" || status === "restarting") return "starting";
  return status === "unavailable" ? "unavailable" : "fallback";
}

export function desktopPiEvalTargetStatus(
  displayStatus: DesktopLocalPiDisplayStatus,
): DesktopPiEvalTargetStatus {
  switch (displayStatus) {
    case "healthy":
      return "available";
    case "starting":
      return "starting";
    case "running":
      return "busy";
    case "hidden":
      return "hidden";
    default:
      return "unavailable";
  }
}

export function canStartDesktopPiEval(
  status: DesktopPiEvalTargetStatus,
): boolean {
  return status === "available" || status === "starting";
}

export function normalizeDesktopNext(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}
