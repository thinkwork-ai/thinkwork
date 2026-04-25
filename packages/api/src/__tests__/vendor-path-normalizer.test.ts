import { describe, expect, it } from "vitest";

import {
  collisionCheck,
  normalizePath,
  normalizeTree,
} from "../lib/vendor-path-normalizer.js";

describe("vendor path normalizer", () => {
  it("normalizes Claude agent folders to FOG-pure paths", () => {
    expect(normalizePath(".claude/agents/expenses/CONTEXT.md")).toBe(
      "expenses/CONTEXT.md",
    );
  });

  it("normalizes Claude skills to local skills folders", () => {
    expect(normalizePath(".claude/skills/approve-receipt/SKILL.md")).toBe(
      "skills/approve-receipt/SKILL.md",
    );
  });

  it("passes plain and unknown vendor paths through unchanged", () => {
    expect(normalizePath("expenses/CONTEXT.md")).toBe("expenses/CONTEXT.md");
    expect(normalizePath(".vendor/agents/foo/CONTEXT.md")).toBe(
      ".vendor/agents/foo/CONTEXT.md",
    );
  });

  it("detects multiple source paths normalizing to the same target", () => {
    expect(
      collisionCheck({
        ".claude/agents/expenses/CONTEXT.md": "a",
        ".codex/agents/expenses/CONTEXT.md": "b",
      }),
    ).toEqual([
      {
        normalizedPath: "expenses/CONTEXT.md",
        sourcePaths: [
          ".claude/agents/expenses/CONTEXT.md",
          ".codex/agents/expenses/CONTEXT.md",
        ],
      },
    ]);
  });

  it("lets explicit vendor-prefixed content win over a plain-path collision", () => {
    expect(
      normalizeTree({
        "expenses/CONTEXT.md": "plain",
        ".claude/agents/expenses/CONTEXT.md": "vendor",
      }),
    ).toEqual({ "expenses/CONTEXT.md": "vendor" });
  });
});
