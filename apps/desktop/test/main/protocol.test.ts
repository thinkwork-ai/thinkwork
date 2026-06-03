import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDesktopCsp,
  DESKTOP_APP_URL,
  handleThinkworkProtocolUrl,
  registerThinkworkProtocol,
} from "../../src/main/protocol";

const csp = buildDesktopCsp({
  apiUrl: "https://api-dev.thinkwork.ai",
  graphqlHttpUrl: "https://api-id.execute-api.us-east-1.amazonaws.com/graphql",
  graphqlUrl: "https://appsync-id.appsync-api.us-east-1.amazonaws.com/graphql",
  graphqlWsUrl:
    "wss://appsync-id-ats.appsync-realtime-api.us-east-1.amazonaws.com/graphql",
  cognitoDomain: "thinkwork-dev",
  sandboxFrameSrc: "https://sandbox.thinkwork.ai/iframe-shell.html",
});

describe("thinkwork protocol handler", () => {
  let rendererRoot: string;

  beforeEach(async () => {
    rendererRoot = await mkdtemp(join(tmpdir(), "thinkwork-renderer-"));
    await mkdir(join(rendererRoot, "assets"));
    await writeFile(join(rendererRoot, "index.html"), "<main>app</main>");
    await writeFile(
      join(rendererRoot, "assets", "index-abc123.js"),
      "export {};",
    );
  });

  afterEach(async () => {
    await rm(rendererRoot, { recursive: true, force: true });
  });

  it("serves index.html with CSP headers", async () => {
    const response = await handleThinkworkProtocolUrl(
      `${DESKTOP_APP_URL}index.html`,
      { rendererRoot, csp },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Content-Security-Policy")).toBe(csp);
    expect(await response.text()).toBe("<main>app</main>");
  });

  it("allows data: and blob: in connect-src so the composer can reify attachments", () => {
    const connectSrc = csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("connect-src "));
    expect(connectSrc).toBeDefined();
    // fetch() of the blob/data URLs the composer produces is governed by
    // connect-src; without these the packaged build silently drops every
    // attachment upload.
    expect(connectSrc).toContain("data:");
    expect(connectSrc).toContain("blob:");
  });

  it("serves JavaScript assets with the expected content type", async () => {
    const response = await handleThinkworkProtocolUrl(
      `${DESKTOP_APP_URL}assets/index-abc123.js`,
      { rendererRoot, csp },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "application/javascript",
    );
    expect(await response.text()).toBe("export {};");
  });

  it("falls back to index.html for SPA routes and the root path", async () => {
    await expect(
      handleThinkworkProtocolUrl(`${DESKTOP_APP_URL}agents/some-agent`, {
        rendererRoot,
        csp,
      }).then((response) => response.text()),
    ).resolves.toBe("<main>app</main>");

    const rootResponse = await handleThinkworkProtocolUrl(DESKTOP_APP_URL, {
      rendererRoot,
      csp,
    });

    expect(rootResponse.status).toBe(200);
    expect(await rootResponse.text()).toBe("<main>app</main>");
  });

  it("rejects decoded traversal segments before URL normalization can hide them", async () => {
    const rawTraversalResponse = await handleThinkworkProtocolUrl(
      "thinkwork://app/../../../etc/passwd",
      { rendererRoot, csp },
    );
    const encodedTraversalResponse = await handleThinkworkProtocolUrl(
      "thinkwork://app/assets/%2e%2e/index.html",
      { rendererRoot, csp },
    );

    expect(rawTraversalResponse.status).toBe(403);
    expect(encodedTraversalResponse.status).toBe(403);
  });

  it("returns 404 for missing assets", async () => {
    const response = await handleThinkworkProtocolUrl(
      `${DESKTOP_APP_URL}assets/does-not-exist.js`,
      { rendererRoot, csp },
    );

    expect(response.status).toBe(404);
  });

  it("builds CSP from specific deployment origins", () => {
    expect(csp).toContain("https://api-id.execute-api.us-east-1.amazonaws.com");
    expect(csp).toContain(
      "https://appsync-id.appsync-api.us-east-1.amazonaws.com",
    );
    expect(csp).toContain(
      "wss://appsync-id-ats.appsync-realtime-api.us-east-1.amazonaws.com",
    );
    expect(csp).toContain(
      "https://thinkwork-dev.auth.us-east-1.amazoncognito.com",
    );
    expect(csp).not.toContain("*.execute-api.us-east-1.amazonaws.com");
  });

  it("registers a handler on the thinkwork scheme", async () => {
    let handledUrl: string | null = null;

    registerThinkworkProtocol({
      rendererRoot,
      csp,
      protocol: {
        handle(scheme, handler) {
          expect(scheme).toBe("thinkwork");
          handledUrl = `${DESKTOP_APP_URL}index.html`;
          void handler({ url: handledUrl });
        },
      },
    });

    expect(handledUrl).toBe(`${DESKTOP_APP_URL}index.html`);
  });
});
