import { describe, expect, it } from "vitest";
import {
  computeSkillDraftContentHash,
  skillDraftPrefix,
  validateSkillDraftFiles,
  validateSkillDraftPath,
} from "./files.js";

function skillMd(name: string): Buffer {
  return Buffer.from(
    `---
name: ${name}
description: Test skill
---

# ${name}
`,
    "utf8",
  );
}

describe("skill draft files", () => {
  it("validates draft files through the catalog skill rules and generates WIRING.md", () => {
    const result = validateSkillDraftFiles([
      { path: "SKILL.md", content: skillMd("draft-helper") },
      { path: "references/guide.md", content: Buffer.from("# Guide\n") },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe("draft-helper");
    expect(result.generatedWiring).toBe(true);
    expect(result.files.map((file) => file.path).sort()).toEqual([
      "SKILL.md",
      "WIRING.md",
      "references/guide.md",
    ]);
    expect(result.currentContentHash).toBe(
      computeSkillDraftContentHash(result.files),
    );
  });

  it("rejects built-in tool slugs before publish", () => {
    const result = validateSkillDraftFiles([
      { path: "SKILL.md", content: skillMd("web-search") },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("built-in tool slug");
  });

  it("normalizes draft prefixes and rejects unsafe paths", () => {
    expect(skillDraftPrefix("acme", "draft-1")).toBe(
      "tenants/acme/skill-drafts/draft-1/",
    );
    expect(validateSkillDraftPath("references/guide.md")).toEqual({
      ok: true,
      path: "references/guide.md",
    });
    const traversal = validateSkillDraftPath("../secret.txt");
    expect(traversal.ok).toBe(false);
  });
});
