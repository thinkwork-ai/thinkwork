import { app, protocol } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapDesktopApp } from "./app.js";
import { snapshotDesktopEnv } from "./env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bufferedOpenUrls: string[] = [];

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

app.on("open-url", (event, url) => {
  event.preventDefault();
  bufferedOpenUrls.push(url);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = argv.find((arg) => /^thinkwork(-dev|-canary)?:\/\//.test(arg));
    if (url) bufferedOpenUrls.push(url);
  });

  void bootstrapDesktopApp({
    snapshotEnv: snapshotDesktopEnv,
    preloadPath: join(__dirname, "../preload/index.mjs"),
  }).catch((error) => {
    console.error("[desktop] failed to bootstrap", error);
    app.quit();
  });
}

export function consumeBufferedOpenUrls(): string[] {
  return bufferedOpenUrls.splice(0);
}
