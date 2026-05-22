import { BrowserWindow, shell } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
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
  return {
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    backgroundColor: "#101114",
    title: "ThinkWork Spaces",
    titleBarStyle: platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: platform === "darwin" ? { x: 14, y: 14 } : undefined,
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
