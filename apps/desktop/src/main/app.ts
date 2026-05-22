import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window.js";
import type { DesktopEnvSnapshot } from "./env.js";

export interface BootstrapDesktopAppOptions {
  snapshotEnv: () => DesktopEnvSnapshot;
  preloadPath: string;
}

export async function bootstrapDesktopApp(
  options: BootstrapDesktopAppOptions,
): Promise<void> {
  await app.whenReady();
  const env = options.snapshotEnv();

  createMainWindow({
    preloadPath: options.preloadPath,
    rendererUrl: env.rendererUrl,
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("activate", () => {
    if (
      process.platform === "darwin" &&
      BrowserWindow.getAllWindows().length === 0
    ) {
      createMainWindow({
        preloadPath: options.preloadPath,
        rendererUrl: env.rendererUrl,
      });
    }
  });
}
