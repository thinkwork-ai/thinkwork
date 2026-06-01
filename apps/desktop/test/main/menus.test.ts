import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import {
  buildDesktopMenuTemplate,
  installDesktopMenu,
} from "../../src/main/menus";
import {
  buildMainWindowOptions,
  configureNavigationHandlers,
  preventPageTitleUpdate,
  type NavigationEventLike,
  type NavigationWebContentsLike,
} from "../../src/main/window";
import { isAllowedExternalUrl } from "../../src/main/url-allowlist";

describe("desktop native menu", () => {
  it("wires Check for Updates through the Help menu", () => {
    const checkForUpdates = vi.fn();
    const template = buildDesktopMenuTemplate({
      appName: "ThinkWork Spaces",
      isMac: false,
      isAuthenticated: () => false,
      signOut: vi.fn(),
      checkForUpdates,
    });

    clickMenuItem(template, "Check for Updates");

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("disables Sign Out when unauthenticated and enables it when authenticated", () => {
    const signOut = vi.fn();
    const unauthenticated = buildDesktopMenuTemplate({
      isMac: false,
      isAuthenticated: () => false,
      signOut,
      checkForUpdates: vi.fn(),
    });
    const authenticated = buildDesktopMenuTemplate({
      isMac: false,
      isAuthenticated: () => true,
      signOut,
      checkForUpdates: vi.fn(),
    });

    expect(findMenuItem(unauthenticated, "Sign Out")?.enabled).toBe(false);
    expect(findMenuItem(authenticated, "Sign Out")?.enabled).toBe(true);

    clickMenuItem(unauthenticated, "Sign Out");
    clickMenuItem(authenticated, "Sign Out");

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("refreshes the installed menu when authentication changes", () => {
    const listeners = new Set<() => void>();
    let authenticated = false;
    const menu = {
      buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({
        template,
      })),
      setApplicationMenu: vi.fn(),
    };

    installDesktopMenu(
      {
        isAuthenticated: () => authenticated,
        signOut: vi.fn(),
        checkForUpdates: vi.fn(),
        onAuthenticationChanged: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      { menu, isMac: false },
    );

    authenticated = true;
    for (const listener of listeners) listener();

    expect(menu.setApplicationMenu).toHaveBeenCalledTimes(2);
    const latestMenu = menu.buildFromTemplate.mock.calls.at(-1)?.[0];
    expect(findMenuItem(latestMenu ?? [], "Sign Out")?.enabled).toBe(true);
  });
});

describe("desktop window navigation", () => {
  it("opens only allowlisted external URLs from window.open and denies the Electron window", () => {
    const webContents = createWebContents();
    const shell = { openExternal: vi.fn(async () => undefined) };
    configureNavigationHandlers(webContents, shell);

    expect(
      webContents.openHandler?.({
        url: "https://thinkwork.ai/docs",
      }),
    ).toEqual({ action: "deny" });
    webContents.openHandler?.({
      url: "https://github.com/thinkwork-ai/thinkwork/releases/tag/desktop-v1.0.0",
    });
    webContents.openHandler?.({
      url: "https://github.com/login/oauth/authorize?client_id=evil_app",
    });
    webContents.openHandler?.({
      url: "https://accounts.google.com/o/oauth2/v2/auth",
    });
    webContents.openHandler?.({
      url: "https://malicious.example.com/",
    });

    expect(shell.openExternal).toHaveBeenCalledTimes(2);
    expect(shell.openExternal).toHaveBeenNthCalledWith(
      1,
      "https://thinkwork.ai/docs",
    );
    expect(shell.openExternal).toHaveBeenNthCalledWith(
      2,
      "https://github.com/thinkwork-ai/thinkwork/releases/tag/desktop-v1.0.0",
    );
  });

  it("prevents in-window navigation away from the desktop app URL", () => {
    const webContents = createWebContents();
    const shell = { openExternal: vi.fn(async () => undefined) };
    configureNavigationHandlers(webContents, shell);

    const appNavigation = createNavigationEvent();
    webContents.navigateHandler?.(appNavigation, "thinkwork://app/new");
    expect(appNavigation.preventDefault).not.toHaveBeenCalled();

    const externalNavigation = createNavigationEvent();
    webContents.navigateHandler?.(
      externalNavigation,
      "https://thinkwork.ai/releases",
    );

    expect(externalNavigation.preventDefault).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://thinkwork.ai/releases",
    );
  });

  it("keeps renderer title changes from reaching the OS-level title", () => {
    const event = createNavigationEvent();

    preventPageTitleUpdate(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("uses hidden macOS chrome and the vibrancy-ready window defaults", () => {
    expect(buildMainWindowOptions("/preload.mjs", "darwin")).toMatchObject({
      show: false,
      // Transparent backing + the sidebar material make the sidebar translucent.
      backgroundColor: "#00000000",
      vibrancy: "sidebar",
      visualEffectState: "followWindow",
      title: "ThinkWork Spaces",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 14 },
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        preload: "/preload.mjs",
      },
    });
  });

  it("keeps the opaque background and no vibrancy off macOS", () => {
    const options = buildMainWindowOptions("/preload.mjs", "win32");
    expect(options).toMatchObject({
      backgroundColor: "#101114",
      titleBarStyle: "default",
    });
    expect(options.vibrancy).toBeUndefined();
    expect(options.visualEffectState).toBeUndefined();
  });
});

describe("desktop URL allowlist", () => {
  it("allows ThinkWork HTTPS URLs and the ThinkWork GitHub organization only", () => {
    expect(isAllowedExternalUrl("https://thinkwork.ai/docs")).toBe(true);
    expect(isAllowedExternalUrl("https://docs.thinkwork.ai/releases")).toBe(
      true,
    );
    expect(
      isAllowedExternalUrl("https://github.com/thinkwork-ai/thinkwork"),
    ).toBe(true);
    expect(
      isAllowedExternalUrl(
        "https://github.com/login/oauth/authorize?client_id=evil_app",
      ),
    ).toBe(false);
    expect(isAllowedExternalUrl("https://accounts.google.com/")).toBe(false);
  });
});

function createWebContents(): NavigationWebContentsLike & {
  openHandler?: (details: { url: string }) => { action: "deny" };
  navigateHandler?: (event: NavigationEventLike, url: string) => void;
} {
  return {
    setWindowOpenHandler(handler) {
      this.openHandler = handler;
    },
    on(event, listener) {
      if (event === "will-navigate") {
        this.navigateHandler = listener;
      }
    },
  };
}

function createNavigationEvent(): NavigationEventLike & {
  preventDefault: ReturnType<typeof vi.fn>;
} {
  return { preventDefault: vi.fn() };
}

function clickMenuItem(
  template: MenuItemConstructorOptions[],
  label: string,
): void {
  const item = findMenuItem(template, label);
  if (!item?.click) throw new Error(`missing menu item: ${label}`);
  if (item.enabled === false) {
    item.click(undefined as never, undefined as never, undefined as never);
    return;
  }

  item.click(undefined as never, undefined as never, undefined as never);
}

function findMenuItem(
  items: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions | null {
  for (const item of items) {
    if (item.label === label) return item;
    const submenu = Array.isArray(item.submenu) ? item.submenu : [];
    const nested = findMenuItem(submenu, label);
    if (nested) return nested;
  }

  return null;
}
