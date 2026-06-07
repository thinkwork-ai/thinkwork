import { getDesktopBridge } from "./desktop-runtime";

let cachedDesktop: boolean | null = null;

export function isDesktop(): boolean {
  if (cachedDesktop == null) {
    cachedDesktop = getDesktopBridge() != null;
  }

  return cachedDesktop;
}

export function resetDesktopDetectionForTests(): void {
  cachedDesktop = null;
}
