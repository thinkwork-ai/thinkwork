import { app, BrowserWindow, protocol } from "electron";
import type { DeepLinkCallback } from "@thinkwork/desktop-ipc";
import { DEEP_LINK_EVENT_CHANNEL } from "@thinkwork/desktop-ipc";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapDesktopApp } from "./app.js";
import { verifyAppleTeamIdentifier } from "./code-signature.js";
import {
  createDeepLinkController,
  resolveDeepLinkScheme,
  type DeepLinkDispatcher,
} from "./deep-link.js";
import { snapshotDesktopEnv } from "./env.js";
import { registerDesktopIpcHandlers } from "./ipc-handlers.js";
import { installDesktopMenu } from "./menus.js";

declare const __THINKWORK_APPLE_TEAM_ID__: string;

const __dirname = dirname(fileURLToPath(import.meta.url));
const expectedAppleTeamId = __THINKWORK_APPLE_TEAM_ID__;
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

  let codeSignatureVerified = true;
  try {
    verifyAppleTeamIdentifier({
      platform: process.platform,
      isPackaged: app.isPackaged,
      expectedTeamId: expectedAppleTeamId,
      executablePath: process.execPath,
    });
  } catch (error) {
    codeSignatureVerified = false;
    process.exitCode = 1;
    console.error("[desktop] failed code-signature verification", error);
    app.quit();
  }

  if (codeSignatureVerified) {
    void bootstrapDesktopApp({
      snapshotEnv: snapshotDesktopEnv,
      preloadPath: join(__dirname, "../preload/index.mjs"),
      protocol,
      installMenus: (handlers) =>
        installDesktopMenu({
          ...handlers,
          appName: "ThinkWork Spaces",
          isDev: !app.isPackaged,
        }),
      registerIpcHandlers: (env) =>
        registerDesktopIpcHandlers({
          env,
          consumePendingOAuthDeepLink,
          markDeepLinkIpcReady,
        }),
      rendererRoot: join(__dirname, "../renderer"),
    }).catch((error) => {
      console.error("[desktop] failed to bootstrap", error);
      app.quit();
    });
  }
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
