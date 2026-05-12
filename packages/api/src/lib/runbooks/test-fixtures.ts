import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildComputerRunbookSkill,
  type ComputerRunbookSkill,
} from "./skill-discovery.js";

const skillCatalogRoot = fileURLToPath(
  new URL("../../../../skill-catalog/", import.meta.url),
);

export async function loadCatalogRunbookSkills(
  slugs?: string[],
): Promise<ComputerRunbookSkill[]> {
  const selectedSlugs =
    slugs ??
    readdirSync(skillCatalogRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  const runbooks: ComputerRunbookSkill[] = [];

  for (const slug of selectedSlugs) {
    const skillRoot = join(skillCatalogRoot, slug);
    const skillMdPath = join(skillRoot, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    const runbook = await buildComputerRunbookSkill({
      skillMdPath: `skills/${slug}/SKILL.md`,
      skillMd: readFileSync(skillMdPath, "utf8"),
      readSkillFile: async (relativePath) =>
        readFileSync(join(skillRoot, relativePath), "utf8"),
    });
    if (runbook) runbooks.push(runbook);
  }

  return runbooks.sort((a, b) => a.slug.localeCompare(b.slug));
}
