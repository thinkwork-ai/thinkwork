import { describe, expect, it, vi } from "vitest";
import { configureDesktopBranding } from "../../src/main/branding";

describe("configureDesktopBranding", () => {
  it("sets local development app name and dock icon", async () => {
    const app = {
      dock: { setIcon: vi.fn() },
      isPackaged: false,
      setName: vi.fn(),
      setAboutPanelOptions: vi.fn(),
      setAppUserModelId: vi.fn(),
      whenReady: vi.fn().mockResolvedValue(undefined),
    };
    const icon = {} as never;
    const nativeImage = { createFromPath: vi.fn(() => icon) };

    await configureDesktopBranding({
      app,
      nativeImage,
      rootDir: "/repo/apps/desktop/out/main",
    });

    expect(app.setName).toHaveBeenCalledWith("ThinkWork Spaces");
    expect(app.setAboutPanelOptions).toHaveBeenCalledWith({
      applicationName: "ThinkWork Spaces",
    });
    expect(app.setAppUserModelId).toHaveBeenCalledWith(
      "ai.thinkwork.spaces.desktop.dev",
    );
    expect(nativeImage.createFromPath).toHaveBeenCalledWith(
      "/repo/apps/desktop/build/icons/icon.png",
    );
    expect(app.dock.setIcon).toHaveBeenCalledWith(icon);
  });

  it("keeps packaged app icons owned by the bundle metadata", async () => {
    const app = {
      dock: { setIcon: vi.fn() },
      isPackaged: true,
      setName: vi.fn(),
      setAboutPanelOptions: vi.fn(),
      whenReady: vi.fn().mockResolvedValue(undefined),
    };
    const nativeImage = { createFromPath: vi.fn() };

    await configureDesktopBranding({
      app,
      nativeImage,
      rootDir: "/repo/apps/desktop/out/main",
    });

    expect(app.whenReady).not.toHaveBeenCalled();
    expect(nativeImage.createFromPath).not.toHaveBeenCalled();
    expect(app.dock.setIcon).not.toHaveBeenCalled();
  });
});
