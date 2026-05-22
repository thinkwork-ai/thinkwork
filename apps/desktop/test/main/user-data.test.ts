import { describe, expect, it, vi } from "vitest";
import {
  configureDevUserDataPath,
  type DesktopAppPathLike,
} from "../../src/main/user-data";

function appPathDouble(isPackaged: boolean): DesktopAppPathLike {
  return {
    isPackaged,
    setPath: vi.fn(),
  };
}

describe("configureDevUserDataPath", () => {
  it("allows dev runs to use an isolated user data directory", () => {
    const app = appPathDouble(false);

    configureDevUserDataPath(app, {
      THINKWORK_DESKTOP_USER_DATA_DIR: "/tmp/thinkwork-profile",
    });

    expect(app.setPath).toHaveBeenCalledWith(
      "userData",
      "/tmp/thinkwork-profile",
    );
  });

  it("ignores the override for packaged apps", () => {
    const app = appPathDouble(true);

    configureDevUserDataPath(app, {
      THINKWORK_DESKTOP_USER_DATA_DIR: "/tmp/thinkwork-profile",
    });

    expect(app.setPath).not.toHaveBeenCalled();
  });
});
