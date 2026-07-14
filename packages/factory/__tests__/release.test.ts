import { describe, expect, it } from "vitest";

import {
  latestTag,
  nextN,
  releaseTags,
  tagForN,
  tagGlob,
  tagRegex,
} from "../src/domain/release.js";

describe("release tag templates", () => {
  it("expands, globs, and matches the default-style template", () => {
    expect(tagForN("v0.1.0-canary.<N>", 355)).toBe("v0.1.0-canary.355");
    expect(tagGlob("v0.1.0-canary.<N>")).toBe("v0.1.0-canary.*");
    expect(tagRegex("v0.1.0-canary.<N>").test("v0.1.0-canary.355")).toBe(true);
    // Dots are escaped — "v0x1x0-canaryX355" must not match.
    expect(tagRegex("v0.1.0-canary.<N>").test("v0x1x0-canaryX355")).toBe(false);
    // Anchored — no partial matches.
    expect(tagRegex("v0.1.0-canary.<N>").test("xv0.1.0-canary.355")).toBe(false);
    expect(tagRegex("v0.1.0-canary.<N>").test("v0.1.0-canary.355-rc")).toBe(false);
  });

  it("works with a completely different project's scheme", () => {
    const t = "release/2026.<N>";
    expect(tagForN(t, 12)).toBe("release/2026.12");
    expect(nextN(t, "release/2026.12\nrelease/2026.11\n")).toBe(13);
    expect(latestTag(t, "garbage\nrelease/2026.9")).toBe("release/2026.9");
  });

  it("nextN is 1 on an empty tag list and skips non-matching lines", () => {
    expect(nextN("v<N>", "")).toBe(1);
    expect(nextN("v<N>", "not-a-tag\nalso-not")).toBe(1);
    expect(nextN("v<N>", "junk\nv41")).toBe(42);
  });

  it("latestTag returns null when nothing matches", () => {
    expect(latestTag("v<N>", "")).toBeNull();
    expect(latestTag("v<N>", "vNaN\nfoo")).toBeNull();
  });

  it("releaseTags mints primary first plus every extra at the same N", () => {
    expect(
      releaseTags(
        {
          tagTemplate: "v0.1.0-canary.<N>",
          extraTagTemplates: ["desktop-v0.1.0-canary.<N>"],
        },
        356,
      ),
    ).toEqual(["v0.1.0-canary.356", "desktop-v0.1.0-canary.356"]);
    expect(
      releaseTags({ tagTemplate: "r<N>", extraTagTemplates: [] }, 1),
    ).toEqual(["r1"]);
  });
});
