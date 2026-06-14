import { describe, expect, it, vi } from "vitest";
import { configureNavigationHandlers } from "../../src/main/window.js";

interface WillNavigateListener {
  (event: { preventDefault: () => void }, url: string): void;
}

function makeWebContents() {
  let willNavigate: WillNavigateListener | undefined;
  return {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((event: string, listener: WillNavigateListener) => {
      if (event === "will-navigate") willNavigate = listener;
    }),
    fireWillNavigate(url: string) {
      const event = { preventDefault: vi.fn() };
      willNavigate?.(event, url);
      return event;
    },
  };
}

describe("configureNavigationHandlers will-navigate", () => {
  it("cancels full-document navigations to in-app URLs without opening externally", () => {
    const webContents = makeWebContents();
    const shell = { openExternal: vi.fn(async () => undefined) };
    configureNavigationHandlers(webContents as never, shell);

    // A dropped thread link triggers a full load to our own deep route. This
    // must be cancelled (the SPA already shows it) and must NOT be treated as
    // an external URL.
    const event = webContents.fireWillNavigate(
      "thinkwork://app/threads/abc-123",
    );

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("cancels in-app navigations to the app root too", () => {
    const webContents = makeWebContents();
    const shell = { openExternal: vi.fn(async () => undefined) };
    configureNavigationHandlers(webContents as never, shell);

    const event = webContents.fireWillNavigate("thinkwork://app/");

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("still routes allowed external URLs to the OS browser", () => {
    const webContents = makeWebContents();
    const shell = { openExternal: vi.fn(async () => undefined) };
    configureNavigationHandlers(webContents as never, shell);

    const event = webContents.fireWillNavigate(
      "https://docs.thinkwork.ai/guide",
    );

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://docs.thinkwork.ai/guide",
    );
  });

  it("routes plugin OAuth authorize URLs to the OS browser", () => {
    const webContents = makeWebContents();
    const shell = { openExternal: vi.fn(async () => undefined) };
    configureNavigationHandlers(webContents as never, shell);

    const url =
      "https://straightforward-dragon-14-staging.authkit.app/authorize?client_id=lastmile&state=signed";
    const event = webContents.fireWillNavigate(url);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith(url);
  });
});
