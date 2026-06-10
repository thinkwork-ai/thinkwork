import { Menu, app } from "electron";
import type { MenuItemConstructorOptions } from "electron";

export type MenuUnsubscribe = () => void;

export interface DesktopMenuCommandHandlers {
  checkForUpdates(): void | Promise<void>;
  signOut(): unknown | Promise<unknown>;
  isAuthenticated(): boolean;
  onAuthenticationChanged?(listener: () => void): MenuUnsubscribe;
}

export interface BuildDesktopMenuTemplateOptions extends DesktopMenuCommandHandlers {
  appName?: string;
  isMac?: boolean;
  isDev?: boolean;
}

export interface InstallDesktopMenuOptions extends DesktopMenuCommandHandlers {
  appName?: string;
  isDev?: boolean;
}

export interface ElectronMenuLike {
  buildFromTemplate(template: MenuItemConstructorOptions[]): unknown;
  setApplicationMenu(menu: unknown): void;
}

export interface InstallDesktopMenuDependencies {
  menu?: ElectronMenuLike;
  isMac?: boolean;
}

export interface InstalledDesktopMenu {
  refresh(): void;
  dispose(): void;
}

export function installDesktopMenu(
  options: InstallDesktopMenuOptions,
  dependencies: InstallDesktopMenuDependencies = {},
): InstalledDesktopMenu {
  const menu = dependencies.menu ?? Menu;
  const isMac = dependencies.isMac ?? process.platform === "darwin";

  function refresh(): void {
    menu.setApplicationMenu(
      menu.buildFromTemplate(
        buildDesktopMenuTemplate({
          ...options,
          appName: options.appName ?? app?.name ?? "ThinkWork Spaces",
          isMac,
        }),
      ),
    );
  }

  refresh();

  return {
    refresh,
    dispose: () => undefined,
  };
}

export function buildDesktopMenuTemplate(
  options: BuildDesktopMenuTemplateOptions,
): MenuItemConstructorOptions[] {
  const isMac = options.isMac ?? process.platform === "darwin";
  const isDev = options.isDev ?? false;
  const appName = options.appName ?? "ThinkWork Spaces";
  const signOutItem = createSignOutItem(options);
  const template: MenuItemConstructorOptions[] = [
    createFileMenu(signOutItem, isMac),
    createEditMenu(),
    createViewMenu(isDev),
    createWindowMenu(isMac),
    createHelpMenu(options),
  ];

  if (isMac) {
    template.unshift(createAppMenu(appName, signOutItem));
  }

  return template;
}

function createAppMenu(
  appName: string,
  signOutItem: MenuItemConstructorOptions,
): MenuItemConstructorOptions {
  return {
    label: appName,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      signOutItem,
      { type: "separator" },
      { role: "quit" },
    ],
  };
}

function createFileMenu(
  signOutItem: MenuItemConstructorOptions,
  isMac: boolean,
): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: isMac ? [{ role: "close" }] : [signOutItem, { role: "quit" }],
  };
}

function createEditMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };
}

function createViewMenu(_isDev: boolean): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    { role: "reload" },
    { role: "forceReload" },
  ];

  // Always expose DevTools (not just in dev). Packaged canary/release builds
  // disable the dev server, so without this the only way to diagnose a renderer
  // failure was to cut a new build — DevTools makes errors visible in-place.
  submenu.push({ role: "toggleDevTools" });

  submenu.push(
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  );

  return { label: "View", submenu };
}

function createWindowMenu(isMac: boolean): MenuItemConstructorOptions {
  return {
    label: "Window",
    submenu: isMac
      ? [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
        ]
      : [{ role: "minimize" }, { role: "zoom" }],
  };
}

function createHelpMenu(
  options: BuildDesktopMenuTemplateOptions,
): MenuItemConstructorOptions {
  return {
    role: "help",
    submenu: [
      {
        label: "Check for Updates",
        click: () => {
          void options.checkForUpdates();
        },
      },
    ],
  };
}

function createSignOutItem(
  options: BuildDesktopMenuTemplateOptions,
): MenuItemConstructorOptions {
  return {
    label: "Sign Out",
    enabled: true,
    click: () => {
      if (!options.isAuthenticated()) return;

      void options.signOut();
    },
  };
}
