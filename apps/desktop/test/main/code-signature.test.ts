import { describe, expect, it, vi } from "vitest";
import {
  readAppleTeamIdentifier,
  verifyAppleTeamIdentifier,
} from "../../src/main/code-signature";

describe("macOS code-signature verification", () => {
  it("skips non-macOS, unpackaged, or unconfigured launches", () => {
    expect(
      verifyAppleTeamIdentifier({
        platform: "linux",
        isPackaged: true,
        expectedTeamId: "TEAMID",
        executablePath: "/app",
      }),
    ).toEqual({ checked: false, teamId: null });

    expect(
      verifyAppleTeamIdentifier({
        platform: "darwin",
        isPackaged: false,
        expectedTeamId: "TEAMID",
        executablePath: "/app",
      }),
    ).toEqual({ checked: false, teamId: null });

    expect(
      verifyAppleTeamIdentifier({
        platform: "darwin",
        isPackaged: true,
        expectedTeamId: "",
        executablePath: "/app",
      }),
    ).toEqual({ checked: false, teamId: null });
  });

  it("accepts the expected team identifier", () => {
    const spawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "Executable=/app\nTeamIdentifier=ABC1234567\n",
    });

    expect(
      verifyAppleTeamIdentifier({
        platform: "darwin",
        isPackaged: true,
        expectedTeamId: "ABC1234567",
        executablePath: "/app",
        spawn,
      }),
    ).toEqual({ checked: true, teamId: "ABC1234567" });
  });

  it("rejects an unexpected team identifier", () => {
    const spawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "TeamIdentifier=OTHERTEAM\n",
    });

    expect(() =>
      verifyAppleTeamIdentifier({
        platform: "darwin",
        isPackaged: true,
        expectedTeamId: "ABC1234567",
        executablePath: "/app",
        spawn,
      }),
    ).toThrow("Unexpected macOS signing team identifier");
  });

  it("parses codesign team identifiers from stderr", () => {
    const spawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "Authority=Developer ID Application\nTeamIdentifier=ABC1234567\n",
    });

    expect(readAppleTeamIdentifier("/app", spawn)).toBe("ABC1234567");
  });
});
