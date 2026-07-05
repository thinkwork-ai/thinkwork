import { describe, expect, it } from "vitest";
import type { CatalogSkillArchiveFile } from "../catalog-skill-archive.js";
import { computeCatalogSkillSha } from "../catalog-skill-sha.js";
import { isCurrentPassedSkillTrustReport } from "./runtime-gate.js";
import type { SkillSpectorRunResult } from "./skillspector.js";
import {
  __test,
  buildTrustedDefaultSkillArtifacts,
  DEFAULT_CATALOG_SKILLS,
  loadDefaultSkillSourceFiles,
} from "./seed-default-skills.js";

const COMPLETED_SCAN: SkillSpectorRunResult = {
  scanner: { status: "completed", version: "test" },
  findings: [],
};

function skillFile(path: string, content: string): CatalogSkillArchiveFile {
  return { path, content: Buffer.from(content, "utf8") };
}

function minimalSkill(slug: string): CatalogSkillArchiveFile[] {
  return [
    skillFile(
      "SKILL.md",
      `---\nname: ${slug}\ndescription: A test skill that does a thing.\n---\n\n# ${slug}\n\nDo the thing.\n`,
    ),
  ];
}

describe("loadDefaultSkillSourceFiles", () => {
  it("loads real default skill source with SKILL.md", () => {
    const files = loadDefaultSkillSourceFiles("artifact-builder");
    expect(files).not.toBeNull();
    expect(files!.some((f) => f.path === "SKILL.md")).toBe(true);
    // relative paths only — no `skills/<slug>/` prefix leaks through
    expect(files!.every((f) => !f.path.startsWith("skills/"))).toBe(true);
  });

  it("returns null for a slug that ships no default source", () => {
    expect(loadDefaultSkillSourceFiles("no-such-default-skill")).toBeNull();
  });

  it("lists artifact-builder as the auto-grant default", () => {
    const artifactBuilder = DEFAULT_CATALOG_SKILLS.find(
      (s) => s.slug === "artifact-builder",
    );
    expect(artifactBuilder?.autoGrant).toBe(true);
  });

  it("does not auto-publish skill-creator (blocking SkillSpector findings)", () => {
    // skill-creator is a developer authoring tool bundling Python runner
    // scripts that SkillSpector flags as blocking (verified live on dev). It
    // must not be in the auto-publish set or every deploy would fail the gate.
    expect(DEFAULT_CATALOG_SKILLS.some((s) => s.slug === "skill-creator")).toBe(
      false,
    );
  });
});

describe("buildTrustedDefaultSkillArtifacts", () => {
  it("produces a runtime-ready report + deterministic content sha and adds WIRING.md", async () => {
    const built = await buildTrustedDefaultSkillArtifacts({
      slug: "widget",
      sourceFiles: minimalSkill("widget"),
      scan: COMPLETED_SCAN,
    });

    // WIRING.md auto-generated so agent-scope grants can wire it.
    expect(built.finalFiles.some((f) => f.path === "WIRING.md")).toBe(true);
    // signed
    expect(built.finalFiles.some((f) => f.path === "skill.oms.sig")).toBe(true);
    // no signing secret in test env → approved_unverified passes the gate
    expect(built.report.evidence.signature).toBe("approved_unverified");
    expect(built.report.status).toBe("passed");

    // The persisted content sha must equal the sha the catalog index would
    // compute over the same file set — the load-bearing gate invariant.
    const indexSha = computeCatalogSkillSha(
      built.finalFiles.map((f) => ({
        relativePath: f.path,
        content: f.content,
      })),
    );
    expect(built.catalogContentSha).toBe(indexSha);

    // A row with content_sha == trust_report_content_sha passes the gate.
    expect(
      isCurrentPassedSkillTrustReport({
        slug: "widget",
        content_sha: built.catalogContentSha,
        trust_report: built.report,
        trust_report_content_sha: built.catalogContentSha,
        trust_report_pipeline_version: "thinkwork-skill-trust-v1",
      }),
    ).toBe(true);
  });

  it("fails loudly when SkillSpector is not configured", async () => {
    await expect(
      buildTrustedDefaultSkillArtifacts({
        slug: "widget",
        sourceFiles: minimalSkill("widget"),
        scan: { scanner: { status: "not_configured" }, findings: [] },
      }),
    ).rejects.toThrow(/SkillSpector is not configured/);
  });

  it("fails loudly when SkillSpector has blocking findings", async () => {
    await expect(
      buildTrustedDefaultSkillArtifacts({
        slug: "widget",
        sourceFiles: minimalSkill("widget"),
        scan: {
          scanner: { status: "completed" },
          findings: [
            {
              id: "f1",
              severity: "critical",
              category: "prompt-injection",
              message: "bad",
            },
          ],
        },
      }),
    ).rejects.toThrow(/critical\/high SkillSpector findings/);
  });

  it("rejects a source whose SKILL.md name does not match the slug", async () => {
    await expect(
      buildTrustedDefaultSkillArtifacts({
        slug: "widget",
        sourceFiles: minimalSkill("gadget"),
        scan: COMPLETED_SCAN,
      }),
    ).rejects.toThrow(/SKILL.md name is 'gadget'/);
  });

  it("every shipped default skill builds a runtime-ready report", async () => {
    for (const skill of DEFAULT_CATALOG_SKILLS) {
      const source = loadDefaultSkillSourceFiles(skill.slug);
      expect(source, `default skill ${skill.slug} ships source`).not.toBeNull();
      const built = await buildTrustedDefaultSkillArtifacts({
        slug: skill.slug,
        sourceFiles: source!,
        scan: COMPLETED_SCAN,
      });
      expect(built.report.spec.status, skill.slug).toBe("passed");
      expect(built.report.status, skill.slug).toBe("passed");
    }
  });
});

describe("idempotency helpers", () => {
  it("nonSignatureFilesEqual ignores the signature file", () => {
    const a = [
      skillFile("SKILL.md", "same"),
      skillFile("skill.oms.sig", "sigA"),
    ];
    const b = [
      skillFile("SKILL.md", "same"),
      skillFile("skill.oms.sig", "sigB-different"),
    ];
    expect(__test.nonSignatureFilesEqual(a, b)).toBe(true);
  });

  it("nonSignatureFilesEqual detects real content drift", () => {
    const a = [skillFile("SKILL.md", "one")];
    const b = [skillFile("SKILL.md", "two")];
    expect(__test.nonSignatureFilesEqual(a, b)).toBe(false);
  });

  it("nonSignatureFilesEqual detects an added file", () => {
    const a = [skillFile("SKILL.md", "one")];
    const b = [skillFile("SKILL.md", "one"), skillFile("REF.md", "x")];
    expect(__test.nonSignatureFilesEqual(a, b)).toBe(false);
  });
});
