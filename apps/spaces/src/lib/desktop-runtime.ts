import type { ThinkworkBridge } from "@thinkwork/desktop-ipc";

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

export function normalizeDesktopNext(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}
