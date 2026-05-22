import { BrowserWindow, shell } from "electron";

export interface CreateMainWindowOptions {
  preloadPath: string;
  rendererUrl: string | null;
  productionUrl?: string;
}

const THINKWORK_LINK_PATTERN = /^https:\/\/([a-z0-9-]+\.)*thinkwork\.ai(\/|$)/i;

export function createMainWindow(
  options: CreateMainWindowOptions,
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    backgroundColor: "#101114",
    title: "ThinkWork Spaces",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: options.preloadPath,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (THINKWORK_LINK_PATTERN.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  void window.loadURL(
    options.rendererUrl ?? options.productionUrl ?? "thinkwork://app/",
  );
  return window;
}
