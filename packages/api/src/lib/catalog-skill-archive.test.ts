import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  CATALOG_SKILL_ARCHIVE_LIMITS,
  parseCatalogSkillArchive,
  renderCatalogSkillArchive,
  textFromCatalogArchiveFile,
} from "./catalog-skill-archive.js";
import { parseWiringMd } from "./wiring-md.js";

const skillMd = (name: string, description = "Does useful work.") => `---
name: ${name}
description: ${description}
---

# ${name}
`;

async function zipBytes(entries: Record<string, string | Buffer>) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX" });
}

async function zipFrom(configure: (zip: JSZip) => void) {
  const zip = new JSZip();
  configure(zip);
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX" });
}

function expectInvalid(
  result: Awaited<ReturnType<typeof parseCatalogSkillArchive>>,
  code: string,
) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected invalid archive");
  expect(result.errors.some((error) => error.code === code)).toBe(true);
}

function fileText(
  result: Extract<
    Awaited<ReturnType<typeof parseCatalogSkillArchive>>,
    { ok: true }
  >,
  path: string,
) {
  const file = result.files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`missing file ${path}`);
  return textFromCatalogArchiveFile(file);
}

describe("parseCatalogSkillArchive", () => {
  it("returns invalid_zip for unreadable ZIP bytes", async () => {
    const result = await parseCatalogSkillArchive(Buffer.from("not a zip"));

    expectInvalid(result, "invalid_zip");
  });

  it("normalizes a top-level skill folder and preserves supporting files", async () => {
    const archive = await zipBytes({
      "pdf-processing/SKILL.md": skillMd("pdf-processing"),
      "pdf-processing/references/guide.md": "# Guide\n",
    });

    const result = await parseCatalogSkillArchive(archive);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid archive");
    expect(result.slug).toBe("pdf-processing");
    expect(result.generatedWiring).toBe(true);
    expect(result.files.map((file) => file.path).sort()).toEqual([
      "SKILL.md",
      "WIRING.md",
      "references/guide.md",
    ]);
    expect(fileText(result, "references/guide.md")).toBe("# Guide\n");
  });

  it("treats root SKILL.md as a virtual folder named from frontmatter", async () => {
    const archive = await zipBytes({
      "SKILL.md": skillMd("code-review"),
      "scripts/run.ts": "export async function run() {}\n",
    });

    const result = await parseCatalogSkillArchive(archive);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid archive");
    expect(result.slug).toBe("code-review");
    expect(result.files.map((file) => file.path).sort()).toEqual([
      "SKILL.md",
      "WIRING.md",
      "scripts/run.ts",
    ]);
  });

  it("generates parseable default wiring when WIRING.md is absent", async () => {
    const archive = await zipBytes({
      "support-agent/SKILL.md": skillMd("support-agent"),
    });

    const result = await parseCatalogSkillArchive(archive);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid archive");
    const wiring = parseWiringMd(fileText(result, "WIRING.md"));
    expect(wiring.suggestions).toHaveLength(1);
    expect(wiring.suggestions[0]).toMatchObject({
      id: "default",
      title: "Default",
    });
    expect(wiring.suggestions[0]!.snippet).toContain(
      "skills/support-agent/SKILL.md",
    );
  });

  it("preserves custom WIRING.md unchanged", async () => {
    const custom = `# Wiring suggestions

## Use directly

\`\`\`context-md
- Read skills/custom-wiring/SKILL.md.
\`\`\`
`;
    const archive = await zipBytes({
      "custom-wiring/SKILL.md": skillMd("custom-wiring"),
      "custom-wiring/WIRING.md": custom,
    });

    const result = await parseCatalogSkillArchive(archive);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid archive");
    expect(result.generatedWiring).toBe(false);
    expect(fileText(result, "WIRING.md")).toBe(custom);
  });

  it("preserves binary assets as bytes", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const archive = await zipBytes({
      "asset-skill/SKILL.md": skillMd("asset-skill"),
      "asset-skill/assets/icon.png": png,
    });

    const result = await parseCatalogSkillArchive(archive);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid archive");
    const asset = result.files.find((file) => file.path === "assets/icon.png");
    expect(asset?.content.equals(png)).toBe(true);
  });

  it("rejects top-level folder name that does not match SKILL.md name", async () => {
    const archive = await zipBytes({
      "folder-name/SKILL.md": skillMd("frontmatter-name"),
    });

    const result = await parseCatalogSkillArchive(archive);

    expectInvalid(result, "skill_name_mismatch");
  });

  it.each(["-bad", "bad-", "bad--name", "Bad"])(
    "rejects Agent Skills name shape: %s",
    async (name) => {
      const archive = await zipBytes({
        "bad-skill/SKILL.md": skillMd(name),
      });

      const result = await parseCatalogSkillArchive(archive);

      expectInvalid(result, "invalid_skill_frontmatter");
    },
  );

  it("rejects archives without SKILL.md", async () => {
    const result = await parseCatalogSkillArchive(
      await zipBytes({ "notes.md": "not a skill" }),
    );

    expectInvalid(result, "missing_skill_md");
  });

  it("rejects archives with multiple top-level skill folders", async () => {
    const result = await parseCatalogSkillArchive(
      await zipBytes({
        "one/SKILL.md": skillMd("one"),
        "two/SKILL.md": skillMd("two"),
      }),
    );

    expectInvalid(result, "multiple_skills");
  });

  it("rejects a top-level skill folder with sibling files outside the folder", async () => {
    const result = await parseCatalogSkillArchive(
      await zipBytes({
        "one/SKILL.md": skillMd("one"),
        "README.md": "outside",
      }),
    );

    expectInvalid(result, "multiple_skills");
  });

  it("rejects unsafe archive paths", async () => {
    const result = await parseCatalogSkillArchive(
      await zipBytes({
        "unsafe/SKILL.md": skillMd("unsafe"),
        "unsafe/../escape.md": "nope",
      }),
    );

    expectInvalid(result, "unsafe_path");
  });

  it("rejects absolute archive paths", async () => {
    const result = await parseCatalogSkillArchive(
      await zipBytes({
        "/absolute/SKILL.md": skillMd("absolute"),
      }),
    );

    expectInvalid(result, "unsafe_path");
  });

  it("rejects macOS metadata entries", async () => {
    const result = await parseCatalogSkillArchive(
      await zipBytes({
        "metadata-skill/SKILL.md": skillMd("metadata-skill"),
        "metadata-skill/.DS_Store": "metadata",
      }),
    );

    expectInvalid(result, "unsafe_path");
  });

  it("rejects symlink-like UNIX ZIP entries", async () => {
    const result = await parseCatalogSkillArchive(
      await zipFrom((zip) => {
        zip.file("symlink-skill/SKILL.md", skillMd("symlink-skill"));
        zip.file("symlink-skill/assets/link", "target", {
          unixPermissions: 0o120777,
        });
      }),
    );

    expectInvalid(result, "unsafe_path");
  });

  it("rejects archives over the entry count limit", async () => {
    const entries: Record<string, string> = {
      "too-many/SKILL.md": skillMd("too-many"),
    };
    for (let i = 0; i < CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries; i++) {
      entries[`too-many/references/${i}.md`] = String(i);
    }

    const result = await parseCatalogSkillArchive(await zipBytes(entries));

    expectInvalid(result, "size_limit_exceeded");
  });

  it("counts directory entries against the entry limit", async () => {
    const result = await parseCatalogSkillArchive(
      await zipFrom((zip) => {
        zip.file("too-many/SKILL.md", skillMd("too-many"));
        for (let i = 0; i < CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries; i++) {
          zip.folder(`too-many/references/${i}`);
        }
      }),
    );

    expectInvalid(result, "size_limit_exceeded");
  });

  it("rejects files over the uncompressed byte limit before accepting files", async () => {
    const result = await parseCatalogSkillArchive(
      await zipBytes({
        "too-large/SKILL.md": skillMd("too-large"),
        "too-large/assets/blob.bin": Buffer.alloc(
          CATALOG_SKILL_ARCHIVE_LIMITS.maxFileBytes + 1,
        ),
      }),
    );

    expectInvalid(result, "size_limit_exceeded");
  });

  it("rejects archives over the total uncompressed byte limit", async () => {
    const entries: Record<string, string | Buffer> = {
      "too-large-total/SKILL.md": skillMd("too-large-total"),
    };
    for (let i = 0; i < 6; i++) {
      entries[`too-large-total/assets/${i}.bin`] = Buffer.alloc(
        9 * 1024 * 1024,
      );
    }

    const result = await parseCatalogSkillArchive(await zipBytes(entries));

    expectInvalid(result, "size_limit_exceeded");
  });
});

describe("renderCatalogSkillArchive", () => {
  it("renders a ZIP that parses back to the same skill files", async () => {
    const archive = await renderCatalogSkillArchive({
      slug: "round-trip",
      files: [
        { path: "SKILL.md", content: Buffer.from(skillMd("round-trip")) },
        { path: "references/guide.md", content: Buffer.from("# Guide\n") },
      ],
    });

    expect(archive.filename).toBe("round-trip.zip");
    expect(archive.contentType).toBe("application/zip");

    const parsed = await parseCatalogSkillArchive(archive.bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected valid archive");
    expect(parsed.slug).toBe("round-trip");
    expect(fileText(parsed, "references/guide.md")).toBe("# Guide\n");
  });

  it("rejects slugs that are valid legacy catalog slugs but invalid archive slugs", async () => {
    await expect(
      renderCatalogSkillArchive({
        slug: "lastmile--crm-basics",
        files: [
          {
            path: "SKILL.md",
            content: Buffer.from(skillMd("lastmile--crm-basics")),
          },
        ],
      }),
    ).rejects.toThrow("Invalid catalog skill slug");
  });

  it.each(["", "../escape.md"])(
    "rejects unsafe rendered paths: %s",
    async (path) => {
      await expect(
        renderCatalogSkillArchive({
          slug: "bad-path",
          files: [{ path, content: Buffer.from("nope") }],
        }),
      ).rejects.toThrow("Invalid skill archive path");
    },
  );
});
