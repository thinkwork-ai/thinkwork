/**
 * Parity tests for catalog-only skills.
 *
 * Same contract as `parity.test.ts`: the inline TypeScript constants in
 * `src/index.ts` must match the authoritative `.md` sources byte-for-byte, so
 * editing one without the other fails immediately.
 *
 * The extra assertion here is the *separation*. Catalog-only skills must stay
 * out of `CANONICAL_FILE_NAMES` / `loadDefaults()`, because everything in
 * `loadDefaults()` is copied into each tenant's `_catalog/defaults/workspace/`
 * template and from there into every new agent's workspace. A catalog-only
 * skill that leaks into the defaults canon is silently installed everywhere —
 * which is exactly what this split exists to prevent.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_FILE_NAMES,
  CATALOG_SKILL_FILE_NAMES,
  loadCatalogSkills,
  loadDefaults,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const CATALOG_SKILLS_DIR = join(PACKAGE_ROOT, "files", "catalog-skills");

describe("catalog-only skill parity", () => {
  it("loadCatalogSkills() returns exactly the declared file names", () => {
    expect(Object.keys(loadCatalogSkills()).sort()).toEqual(
      [...CATALOG_SKILL_FILE_NAMES].sort(),
    );
  });

  it.each(CATALOG_SKILL_FILE_NAMES)(
    "content for %s matches its authoritative .md source byte-for-byte",
    (name) => {
      const inline = loadCatalogSkills()[name];
      const authoritative = readFileSync(
        join(CATALOG_SKILLS_DIR, ...name.split("/")),
        "utf8",
      );
      expect(inline).toEqual(authoritative);
    },
  );

  it("keeps catalog-only skills out of the workspace-defaults template", () => {
    const defaults = loadDefaults();
    for (const name of CATALOG_SKILL_FILE_NAMES) {
      const slug = name.split("/")[0];
      expect(defaults).not.toHaveProperty(`skills/${slug}/SKILL.md`);
      expect(CANONICAL_FILE_NAMES).not.toContain(`skills/${name}`);
    }
  });

  it("returns a fresh object each call", () => {
    const first = loadCatalogSkills();
    const second = loadCatalogSkills();
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("n8n-workflow-operator carries no plugin framing", () => {
    const skill = loadCatalogSkills()["n8n-workflow-operator/SKILL.md"];
    expect(skill).not.toMatch(/plugin/i);
    expect(skill).toContain("registered n8n MCP server");
  });
});
