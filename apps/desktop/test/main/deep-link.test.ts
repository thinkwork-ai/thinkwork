import { describe, expect, it, vi } from "vitest";
import {
  createDeepLinkController,
  isDeepLinkUrl,
  parseDeepLinkCallback,
  resolveDeepLinkScheme,
} from "../../src/main/deep-link";

describe("desktop deep links", () => {
  it("resolves the per-stage URL scheme", () => {
    expect(resolveDeepLinkScheme("prod")).toBe("thinkwork");
    expect(resolveDeepLinkScheme("production")).toBe("thinkwork");
    expect(resolveDeepLinkScheme("stable")).toBe("thinkwork");
    expect(resolveDeepLinkScheme("canary")).toBe("thinkwork-canary");
    expect(resolveDeepLinkScheme("thinkwork-canary")).toBe("thinkwork-canary");
    expect(resolveDeepLinkScheme("dev")).toBe("thinkwork-dev");
    expect(resolveDeepLinkScheme("thinkwork-dev")).toBe("thinkwork-dev");
    expect(resolveDeepLinkScheme(undefined)).toBe("thinkwork-dev");
  });

  it("parses a valid OAuth callback URL", () => {
    expect(
      parseDeepLinkCallback("thinkwork://oauth/callback?code=abc&state=xyz"),
    ).toEqual({
      code: "abc",
      state: "xyz",
    });
  });

  it("ignores extra Cognito callback query params once code and state are present", () => {
    expect(
      parseDeepLinkCallback(
        "thinkwork://oauth/callback?code=abc&state=xyz&iss=https%3A%2F%2Fexample.com",
      ),
    ).toEqual({
      code: "abc",
      state: "xyz",
    });
  });

  it("parses OAuth error callbacks so the renderer can show the hosted UI reason", () => {
    expect(
      parseDeepLinkCallback(
        "thinkwork://oauth/callback?error=invalid_request&error_description=Bad%20redirect&state=xyz",
      ),
    ).toEqual({
      error: "invalid_request",
      errorDescription: "Bad redirect",
      state: "xyz",
    });
  });

  it("rejects disallowed paths, missing data, and malformed URLs", () => {
    const logger = { warn: vi.fn() };

    expect(
      parseDeepLinkCallback("thinkwork://malicious/command?cmd=rm", { logger }),
    ).toBeNull();
    expect(
      parseDeepLinkCallback(
        "thinkwork://oauth:123/callback?code=abc&state=xyz",
        { logger },
      ),
    ).toBeNull();
    expect(
      parseDeepLinkCallback("thinkwork://oauth/callback?code=abc", { logger }),
    ).toBeNull();
    expect(
      parseDeepLinkCallback(
        "thinkwork://oauth/callback?code=abc&state=xyz#frag",
        { logger },
      ),
    ).toBeNull();
    expect(parseDeepLinkCallback("not a url", { logger })).toBeNull();

    expect(logger.warn).toHaveBeenCalledTimes(5);
  });

  it("rejects callbacks for schemes outside the active stage", () => {
    expect(
      parseDeepLinkCallback(
        "thinkwork-canary://oauth/callback?code=abc&state=xyz",
        {
          allowedSchemes: ["thinkwork-dev"],
        },
      ),
    ).toBeNull();
  });

  it("buffers valid URLs until the OAuth IPC handler is ready", () => {
    const controller = createDeepLinkController({ scheme: "thinkwork" });

    controller.handleUrl("thinkwork://oauth/callback?code=abc&state=xyz");

    expect(controller.pendingCount()).toBe(1);
    expect(controller.consumePending()).toEqual({ code: "abc", state: "xyz" });
    expect(controller.pendingCount()).toBe(0);
  });

  it("drains buffered URLs when marked ready and routes later URLs immediately", () => {
    const controller = createDeepLinkController({ scheme: "thinkwork" });
    const dispatch = vi.fn();

    controller.handleUrl("thinkwork://oauth/callback?code=one&state=first");
    controller.markReady(dispatch);
    controller.handleUrl("thinkwork://oauth/callback?code=two&state=second");

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      code: "one",
      state: "first",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      code: "two",
      state: "second",
    });
    expect(controller.pendingCount()).toBe(0);
  });

  it("buffers valid cold-start Windows argv URLs and ignores unrelated args", () => {
    const controller = createDeepLinkController({ scheme: "thinkwork-dev" });

    const callbacks = controller.handleArgv([
      "--some-flag",
      "thinkwork-dev://oauth/callback?code=abc&state=xyz",
      "https://thinkwork.ai",
    ]);

    expect(callbacks).toEqual([{ code: "abc", state: "xyz" }]);
    expect(controller.consumeAllPending()).toEqual([
      { code: "abc", state: "xyz" },
    ]);
  });

  it("identifies supported custom-scheme URLs for argv scanning", () => {
    expect(isDeepLinkUrl("thinkwork://oauth/callback?code=abc&state=xyz")).toBe(
      true,
    );
    expect(isDeepLinkUrl("thinkwork-canary://oauth/callback")).toBe(true);
    expect(isDeepLinkUrl("https://thinkwork.ai")).toBe(false);
  });
});
