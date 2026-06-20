import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import { JSDOM } from "jsdom";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, "..");
const maxRawDeltaBytes = 150_000;
const maxGzipDeltaBytes = 45_000;
const forbiddenPatterns = [
  /fetch\(/,
  /eval\(/,
  /new Function/,
  /XMLHttpRequest/,
  /import\(/,
  /useUIStream/,
  /useChatUI/,
];

function build(entry) {
  execFileSync("pnpm", ["build:json-render-smoke"], {
    cwd: webRoot,
    env: {
      ...process.env,
      JSON_RENDER_SMOKE_ENTRY: entry,
    },
    stdio: "inherit",
  });
}

function readBundle(entry) {
  const assetsDir = join(webRoot, "dist", `json-render-smoke-${entry}`, "assets");
  const fileName = readdirSync(assetsDir).find((name) => name.endsWith(".js"));

  if (!fileName) {
    throw new Error(`Missing json-render smoke bundle for ${entry}`);
  }

  const filePath = join(assetsDir, fileName);
  const source = readFileSync(filePath, "utf8");

  return {
    entry,
    filePath,
    gzipBytes: gzipSync(source).byteLength,
    rawBytes: Buffer.byteLength(source),
    source,
  };
}

async function executeRendererBundle(rendererBundle) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.Node = dom.window.Node;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });

  await import(`${pathToFileURL(rendererBundle.filePath).href}?t=${Date.now()}`);
  const root = dom.window.document.getElementById("root");
  let text = root?.textContent ?? "";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (text.includes("Pipeline health") && text.includes("On track")) {
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    text = root?.textContent ?? "";
  }

  throw new Error(`Renderer bundle did not render expected content: ${text}`);
}

build("baseline");
build("renderer");

const baseline = readBundle("baseline");
const renderer = readBundle("renderer");
const rawDelta = renderer.rawBytes - baseline.rawBytes;
const gzipDelta = renderer.gzipBytes - baseline.gzipBytes;

for (const pattern of forbiddenPatterns) {
  if (pattern.test(renderer.source)) {
    throw new Error(`Renderer bundle contains forbidden pattern ${pattern}`);
  }
}

if (rawDelta > maxRawDeltaBytes) {
  throw new Error(
    `Renderer raw bundle delta ${rawDelta} exceeds ${maxRawDeltaBytes} bytes`,
  );
}

if (gzipDelta > maxGzipDeltaBytes) {
  throw new Error(
    `Renderer gzip bundle delta ${gzipDelta} exceeds ${maxGzipDeltaBytes} bytes`,
  );
}

await executeRendererBundle(renderer);

console.log(
  [
    "json-render smoke verified",
    `baseline=${baseline.rawBytes} raw/${baseline.gzipBytes} gzip`,
    `renderer=${renderer.rawBytes} raw/${renderer.gzipBytes} gzip`,
    `delta=${rawDelta} raw/${gzipDelta} gzip`,
  ].join("; "),
);
