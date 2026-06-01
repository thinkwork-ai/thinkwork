import { BrowserWindow, shell } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
import { WINDOW_FOCUS_EVENT_CHANNEL } from "@thinkwork/desktop-ipc";
import { isAllowedExternalUrl, isDesktopAppUrl } from "./url-allowlist.js";

export interface CreateMainWindowOptions {
  preloadPath: string;
  rendererUrl: string | null;
  productionUrl?: string;
}

export interface DesktopShellLike {
  openExternal(url: string): Promise<unknown>;
}

export interface NavigationEventLike {
  preventDefault(): void;
}

export interface NavigationWebContentsLike {
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" },
  ): void;
  on(
    event: "will-navigate",
    listener: (event: NavigationEventLike, url: string) => void,
  ): void;
}

export function createMainWindow(
  options: CreateMainWindowOptions,
): BrowserWindow {
  const window = new BrowserWindow(buildMainWindowOptions(options.preloadPath));

  window.once("ready-to-show", () => {
    window.show();
  });

  // Push focus state to the renderer so it can suppress notifications for the
  // thread the user is actively viewing (R5).
  const sendFocus = (focused: boolean) => {
    if (!window.isDestroyed()) {
      window.webContents.send(WINDOW_FOCUS_EVENT_CHANNEL, { focused });
    }
  };
  window.on("focus", () => sendFocus(true));
  window.on("blur", () => sendFocus(false));

  window.on("page-title-updated", preventPageTitleUpdate);

  configureNavigationHandlers(window.webContents, shell);

  void window.loadURL(
    options.rendererUrl ?? options.productionUrl ?? "thinkwork://app/",
  );
  return window;
}

export function buildMainWindowOptions(
  preloadPath: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  const darwin = platform === "darwin";
  return {
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    // On macOS the window background is the NSVisualEffectView "sidebar"
    // material; the renderer paints the sidebar transparent so the material
    // shows through (see the .desktop-vibrancy CSS). A fully-transparent
    // backing color avoids a white flash before the renderer paints. Other
    // platforms keep the opaque app background.
    backgroundColor: darwin ? "#00000000" : "#101114",
    // "under-window" is far more transparent than "sidebar" (which floors out
    // fairly opaque); the per-theme scrim in index.css tints it.
    vibrancy: darwin ? "under-window" : undefined,
    // followWindow: the sidebar is translucent while ThinkWork is focused and
    // settles to solid grey when it loses focus (matches the macOS norm).
    visualEffectState: darwin ? "followWindow" : undefined,
    title: "ThinkWork Spaces",
    titleBarStyle: darwin ? "hiddenInset" : "default",
    trafficLightPosition: darwin ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: preloadPath,
    },
  };
}

export function configureNavigationHandlers(
  webContents: NavigationWebContentsLike,
  desktopShell: DesktopShellLike,
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url, desktopShell);
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    if (isDesktopAppUrl(url)) return;

    event.preventDefault();
    openAllowedExternalUrl(url, desktopShell);
  });
}

export function preventPageTitleUpdate(event: NavigationEventLike): void {
  event.preventDefault();
}

function openAllowedExternalUrl(
  url: string,
  desktopShell: DesktopShellLike,
): void {
  if (!isAllowedExternalUrl(url)) return;

  void desktopShell.openExternal(url);
}
