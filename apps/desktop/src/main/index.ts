import { app, BrowserWindow, protocol } from "electron";
import type { DeepLinkCallback } from "@thinkwork/desktop-ipc";
import { DEEP_LINK_EVENT_CHANNEL } from "@thinkwork/desktop-ipc";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapDesktopApp } from "./app.js";
import {
  createDeepLinkController,
  resolveDeepLinkScheme,
  type DeepLinkDispatcher,
} from "./deep-link.js";
import { snapshotDesktopEnv } from "./env.js";
import { registerDesktopIpcHandlers } from "./ipc-handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const deepLinkController = createDeepLinkController({
  scheme: resolveDeepLinkScheme(
    process.env.THINKWORK_STAGE ?? process.env.VITE_THINKWORK_STAGE,
  ),
  logger: console,
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: "thinkwork",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: "thinkwork-dev",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: "thinkwork-canary",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.setAsDefaultProtocolClient(deepLinkController.scheme);

app.on("open-url", (event, url) => {
  event.preventDefault();
  deepLinkController.handleUrl(url);
});

deepLinkController.handleArgv(process.argv);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    deepLinkController.handleArgv(argv);
    focusExistingWindow();
  });

  void bootstrapDesktopApp({
    snapshotEnv: snapshotDesktopEnv,
    preloadPath: join(__dirname, "../preload/index.mjs"),
    protocol,
    registerIpcHandlers: () =>
      registerDesktopIpcHandlers({
        consumePendingOAuthDeepLink,
        markDeepLinkIpcReady,
      }).then(() => undefined),
    rendererRoot: join(__dirname, "../renderer"),
  }).catch((error) => {
    console.error("[desktop] failed to bootstrap", error);
    app.quit();
  });
}

export function markDeepLinkIpcReady(
  dispatcher: DeepLinkDispatcher = sendDeepLinkToRenderers,
): void {
  deepLinkController.markReady(dispatcher);
}

export function consumePendingOAuthDeepLink(): DeepLinkCallback | null {
  return deepLinkController.consumePending();
}

function sendDeepLinkToRenderers(callback: DeepLinkCallback): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(DEEP_LINK_EVENT_CHANNEL, callback);
  }
}

function focusExistingWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;

  if (window.isMinimized()) window.restore();
  window.focus();
}
