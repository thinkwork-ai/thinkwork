import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window.js";
import type { DesktopEnvSnapshot } from "./env.js";
import type { DesktopMenuCommandHandlers } from "./menus.js";
import {
  buildDesktopCsp,
  DESKTOP_APP_URL,
  registerThinkworkProtocol,
  type ElectronProtocolLike,
} from "./protocol.js";

export interface BootstrapDesktopAppOptions {
  snapshotEnv: () => DesktopEnvSnapshot;
  preloadPath: string;
  protocol: ElectronProtocolLike;
  rendererRoot: string;
  registerIpcHandlers?: (
    env: DesktopEnvSnapshot,
  ) => Promise<DesktopMenuCommandHandlers | void>;
  installMenus?: (handlers: DesktopMenuCommandHandlers) => void;
}

export async function bootstrapDesktopApp(
  options: BootstrapDesktopAppOptions,
): Promise<void> {
  await app.whenReady();
  const env = options.snapshotEnv();
  const csp = buildDesktopCsp({
    apiUrl: env.apiUrl,
    graphqlHttpUrl: env.graphqlHttpUrl,
    graphqlUrl: env.graphqlUrl,
    graphqlWsUrl: env.graphqlWsUrl,
    cognitoDomain: env.cognito.domain,
    sandboxFrameSrc: env.sandboxFrameSrc,
  });

  registerThinkworkProtocol({
    protocol: options.protocol,
    rendererRoot: options.rendererRoot,
    csp,
  });

  const menuHandlers = await options.registerIpcHandlers?.(env);
  if (menuHandlers) {
    options.installMenus?.(menuHandlers);
  }

  createMainWindow({
    preloadPath: options.preloadPath,
    rendererUrl: env.rendererUrl,
    productionUrl: DESKTOP_APP_URL,
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
        productionUrl: DESKTOP_APP_URL,
      });
    }
  });
}
