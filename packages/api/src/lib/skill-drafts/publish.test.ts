import { describe, expect, it } from "vitest";
import { computeSkillDraftContentHash } from "./files.js";
import { prepareSkillDraftPublish } from "./publish.js";

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

describe("prepareSkillDraftPublish", () => {
  it("returns normalized publish files when validation and trust pass", () => {
    const result = prepareSkillDraftPublish({
      files: [{ path: "SKILL.md", content: skillMd("draft-helper") }],
      trustReady: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe("draft-helper");
    expect(result.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "WIRING.md",
    ]);
    expect(result.contentHash).toBe(computeSkillDraftContentHash(result.files));
  });

  it("blocks publish when trust has not passed for the current content", () => {
    const files = [{ path: "SKILL.md", content: skillMd("draft-helper") }];
    const currentHash = computeSkillDraftContentHash(files);

    expect(
      prepareSkillDraftPublish({ files, trustReady: false }),
    ).toMatchObject({ ok: false, code: "trust_not_ready" });
    expect(
      prepareSkillDraftPublish({
        files,
        trustReady: true,
        trustContentHash: `stale-${currentHash}`,
      }),
    ).toMatchObject({ ok: false, code: "stale_trust_result" });
  });

  it("requires explicit confirmation before replacing an existing catalog skill", () => {
    const files = [{ path: "SKILL.md", content: skillMd("draft-helper") }];

    expect(
      prepareSkillDraftPublish({
        files,
        trustReady: true,
        existingCatalogSlug: "draft-helper",
      }),
    ).toMatchObject({ ok: false, code: "skill_exists" });
    expect(
      prepareSkillDraftPublish({
        files,
        trustReady: true,
        existingCatalogSlug: "draft-helper",
        confirmReplace: true,
      }),
    ).toMatchObject({ ok: true, slug: "draft-helper" });
  });
});
