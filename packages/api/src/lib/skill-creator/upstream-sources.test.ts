import { describe, expect, it } from "vitest";
import {
  UPSTREAM_SKILL_CREATOR_SOURCE,
  computeSkillCreatorContentDigest,
  isUpstreamSkillCreatorProvenance,
} from "./upstream-sources.js";

describe("upstream skill creator source metadata", () => {
  it("computes a stable digest independent of file ordering", () => {
    const a = computeSkillCreatorContentDigest([
      { path: "SKILL.md", sha256: "a".repeat(64) },
      { path: "references/schemas.md", sha256: "b".repeat(64) },
    ]);
    const b = computeSkillCreatorContentDigest([
      { path: "references/schemas.md", sha256: "b".repeat(64) },
      { path: "SKILL.md", sha256: "a".repeat(64) },
    ]);

    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
  });

  it("validates provenance for the committed upstream bundle", () => {
    expect(
      isUpstreamSkillCreatorProvenance({
        source: UPSTREAM_SKILL_CREATOR_SOURCE,
        commit: "57546260929473d4e0d1c1bb75297be2fdfa1949",
        fetchedAt: "2026-06-22T00:00:00.000Z",
        contentSha256: "c".repeat(64),
        files: [
          {
            path: "SKILL.md",
            sha: "65b3a402dbd09b8e83f9d637c6b553875189085c",
            size: 33168,
            sha256: "d".repeat(64),
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects provenance that points outside the upstream skill directory", () => {
    expect(
      isUpstreamSkillCreatorProvenance({
        source: UPSTREAM_SKILL_CREATOR_SOURCE,
        commit: "57546260929473d4e0d1c1bb75297be2fdfa1949",
        fetchedAt: "2026-06-22T00:00:00.000Z",
        contentSha256: "c".repeat(64),
        files: [
          {
            path: "../SKILL.md",
            sha: "65b3a402dbd09b8e83f9d637c6b553875189085c",
            size: 33168,
            sha256: "d".repeat(64),
          },
        ],
      }),
    ).toBe(false);
  });
});
