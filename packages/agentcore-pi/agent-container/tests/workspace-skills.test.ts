import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverWorkspaceSkills } from "../src/runtime/workspace-skills.js";

function skillMd(slug: string, description: string): string {
  return `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${slug}\n`;
}

async function writeSkill(
  root: string,
  relSkillDir: string,
  slug: string,
  description: string,
): Promise<void> {
  const dir = path.join(root, relSkillDir, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), skillMd(slug, description));
}

describe("discoverWorkspaceSkills subtree scoping", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "workspace-skills-scope-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("root discovery returns only the root skill when a nested same-slug skill exists (AE3)", async () => {
    await writeSkill(root, "skills", "crm", "root crm skill");
    await writeSkill(
      root,
      "agents/researcher/skills",
      "crm",
      "nested crm skill",
    );

    const skills = await discoverWorkspaceSkills(root);

    expect(skills.map((s) => s.slug)).toEqual(["crm"]);
    expect(skills[0]?.description).toBe("root crm skill");
    expect(skills[0]?.skillPath).toBe(
      path.join(root, "skills", "crm", "SKILL.md"),
    );
  });

  it("a nested-only skill is absent from root discovery", async () => {
    await writeSkill(root, "skills", "crm", "root crm skill");
    await writeSkill(
      root,
      "agents/researcher/skills",
      "web",
      "nested web skill",
    );

    const skills = await discoverWorkspaceSkills(root);

    expect(skills.map((s) => s.slug)).toEqual(["crm"]);
  });

  it("a scoped call on a sub-agent folder returns exactly the nested skills", async () => {
    await writeSkill(root, "skills", "crm", "root crm skill");
    await writeSkill(
      root,
      "agents/researcher/skills",
      "web",
      "nested web skill",
    );
    await writeSkill(
      root,
      "agents/researcher/skills",
      "crm",
      "nested crm skill",
    );

    const skills = await discoverWorkspaceSkills(
      path.join(root, "agents", "researcher"),
    );

    expect(skills.map((s) => s.slug)).toEqual(["crm", "web"]);
    expect(skills.find((s) => s.slug === "crm")?.description).toBe(
      "nested crm skill",
    );
  });

  it("a deeply nested agents/a/agents/b skill is invisible to root and first-level scopes", async () => {
    await writeSkill(root, "agents/a/agents/b/skills", "x", "doubly nested");

    const rootSkills = await discoverWorkspaceSkills(root);
    const firstLevel = await discoverWorkspaceSkills(
      path.join(root, "agents", "a"),
    );

    expect(rootSkills).toEqual([]);
    expect(firstLevel).toEqual([]);
  });

  it("agents/ exclusion anchors at the scope root — skill assets under skills/<slug>/agents/ survive", async () => {
    await writeSkill(root, "skills", "skill-creator", "creator skill");
    // Real precedent: skills/skill-creator/agents/analyzer.md ships as a
    // skill asset. A deeper `agents` segment must not prune the walk.
    const assetDir = path.join(root, "skills", "skill-creator", "agents");
    await mkdir(assetDir, { recursive: true });
    await writeFile(path.join(assetDir, "analyzer.md"), "# analyzer\n");
    // A skills tree hiding under that asset dir would still be admitted by
    // the shape rule; only the scope root's own agents/ folder is excluded.
    await writeSkill(
      root,
      "skills/skill-creator/agents/helper/skills",
      "asset-skill",
      "asset-shaped skill",
    );

    const skills = await discoverWorkspaceSkills(root);

    expect(skills.map((s) => s.slug)).toEqual(["asset-skill", "skill-creator"]);
  });

  it("an empty or missing skills/ dir under a scope returns empty without error", async () => {
    await mkdir(path.join(root, "agents", "researcher"), { recursive: true });

    await expect(
      discoverWorkspaceSkills(path.join(root, "agents", "researcher")),
    ).resolves.toEqual([]);
    await expect(
      discoverWorkspaceSkills(path.join(root, "agents", "missing")),
    ).resolves.toEqual([]);
  });
});
