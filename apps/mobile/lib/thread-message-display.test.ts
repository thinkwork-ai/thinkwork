import { describe, expect, it } from "vitest";
import {
  initialsForName,
  resolveHumanMessageDisplay,
} from "./thread-message-display";

describe("thread message display", () => {
  it("labels the current user's messages as You without initials", () => {
    expect(
      resolveHumanMessageDisplay(
        { sender: { id: "user-1", displayName: "Eric Odom" } },
        "user-1",
      ),
    ).toEqual({ label: "You", initials: null, isCurrentUser: true });
  });

  it("uses another participant's display name and initials", () => {
    expect(
      resolveHumanMessageDisplay(
        { sender: { id: "user-2", displayName: "Scott Hertel" } },
        "user-1",
      ),
    ).toEqual({ label: "Scott Hertel", initials: "SH", isCurrentUser: false });
  });

  it("falls back to stable initials for missing names", () => {
    expect(resolveHumanMessageDisplay({}, "user-1")).toEqual({
      label: "User",
      initials: "US",
      isCurrentUser: false,
    });
    expect(initialsForName("Ada")).toBe("AD");
  });
});
