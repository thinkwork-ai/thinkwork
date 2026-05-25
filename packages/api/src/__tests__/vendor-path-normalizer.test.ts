import { describe, expect, it } from "vitest";

import {
  collisionCheck,
  normalizePath,
  normalizeTree,
} from "../lib/vendor-path-normalizer.js";

describe("vendor path normalizer", () => {
  it.each([".claude", ".codex", ".gemini"])(
    "normalizes %s agent folders to workspace paths",
    (vendor) => {
      expect(normalizePath(`${vendor}/agents/expenses/CONTEXT.md`)).toBe(
        "workspaces/expenses/CONTEXT.md",
      );
    },
  );

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
        normalizedPath: "workspaces/expenses/CONTEXT.md",
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
        "workspaces/expenses/CONTEXT.md": "plain",
        ".claude/agents/expenses/CONTEXT.md": "vendor",
      }),
    ).toEqual({ "workspaces/expenses/CONTEXT.md": "vendor" });
  });

  it("normalizes nested Codex agent folders to workspace paths", () => {
    expect(
      normalizePath(".codex/agents/finance-analyst/skills/snowflake/SKILL.md"),
    ).toBe("workspaces/finance-analyst/skills/snowflake/SKILL.md");
  });
});
