/**
 * U2 — every catalog SKILL.md carries valid frontmatter.
 *
 * After plan 2026-04-24-009 §U2 the per-slug `skill.yaml` is gone and
 * its fields live on the SKILL.md frontmatter instead. This test pins
 * the new world:
 *
 *   1. Every catalog skill directory has a SKILL.md.
 *   2. Each SKILL.md parses cleanly with U1's `parseSkillMdInternal`.
 *   3. The frontmatter `name` matches the directory slug — that's the
 *      anchor the runtime uses to look up the skill.
 *   4. The frontmatter `description` is a non-empty string.
 *   5. `execution` (when present) is one of the two supported values
 *      (`script` | `context`); U6 retired everything else.
 *   6. `customer-onboarding` and `sandbox-pilot` — the two skills that
 *      shipped without frontmatter prior to U2 — now have valid
 *      frontmatter (regression pin so they don't regress to the old
 *      no-frontmatter state).
 *   7. No `skill.yaml` files remain on disk anywhere under the catalog.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSkillMdInternal } from "../../api/src/lib/skill-md-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = resolve(__dirname, "..");

function listSlugDirs(catalog: string): string[] {
  // Mirrors the filter set in scripts/u8-status.ts so the audit
  // surface and the test surface stay aligned.
  return readdirSync(catalog, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .filter((name) => name !== "node_modules" && name !== "dist")
    .filter((name) => name !== "scripts" && name !== "tests")
    .filter((name) => name !== "__tests__" && name !== "characterization")
    .sort();
}

const slugDirs = listSlugDirs(catalogRoot);

describe("skill-catalog SKILL.md frontmatter (post-U2)", () => {
  it("discovers at least one skill directory (sanity)", () => {
    expect(slugDirs.length).toBeGreaterThan(0);
  });

  it.each(slugDirs)(
    "%s — SKILL.md parses with parseSkillMdInternal + name matches slug",
    (slug) => {
      const skillMdPath = join(catalogRoot, slug, "SKILL.md");
      expect(
        existsSync(skillMdPath),
        `${skillMdPath} must exist`,
      ).toBe(true);

      const src = readFileSync(skillMdPath, "utf8");
      const result = parseSkillMdInternal(src, skillMdPath);
      expect(
        result.valid,
        result.valid ? "" : JSON.stringify(result.errors),
      ).toBe(true);

      if (!result.valid) return; // narrowing for the type-checker
      const { parsed } = result;

      expect(parsed.frontmatterPresent).toBe(true);
      expect(parsed.data.name).toBe(slug);
      expect(typeof parsed.data.description).toBe("string");
      expect((parsed.data.description as string).length).toBeGreaterThan(0);

      // U6's retired execution values surface here as parser errors;
      // a missing/empty execution coerces to null and the skill loader
      // defaults it to context downstream — both are acceptable in U2.
      if (parsed.execution !== null) {
        expect(["script", "context"]).toContain(parsed.execution);
      }
    },
  );

  it("customer-onboarding now carries frontmatter (was missing pre-U2)", () => {
    const skillMdPath = join(catalogRoot, "customer-onboarding", "SKILL.md");
    const src = readFileSync(skillMdPath, "utf8");
    const result = parseSkillMdInternal(src, skillMdPath);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.parsed.frontmatterPresent).toBe(true);
    expect(result.parsed.data.name).toBe("customer-onboarding");
    expect(result.parsed.execution).toBe("context");
  });

  it("sandbox-pilot now carries frontmatter (was missing pre-U2)", () => {
    const skillMdPath = join(catalogRoot, "sandbox-pilot", "SKILL.md");
    const src = readFileSync(skillMdPath, "utf8");
    const result = parseSkillMdInternal(src, skillMdPath);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.parsed.frontmatterPresent).toBe(true);
    expect(result.parsed.data.name).toBe("sandbox-pilot");
    expect(result.parsed.execution).toBe("script");
  });

  it("no skill.yaml files remain anywhere under the catalog (U2 collapsed them into SKILL.md frontmatter)", () => {
    const stragglers: string[] = [];
    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
        } else if (entry.name === "skill.yaml") {
          stragglers.push(p);
        }
      }
    }
    // Defensively walk catalog dirs only — scripts/__tests__/characterization
    // can't carry a skill.yaml and we don't care if they do.
    for (const slug of slugDirs) walk(join(catalogRoot, slug));
    expect(stragglers).toEqual([]);
  });

  it("frontmatter carries a behavioral execution field (script | context | omitted)", () => {
    // Census-shape sanity: every skill should be one of the two
    // supported execution modes (or omitted, which the runtime
    // defaults to context). If a future slug ships with the legacy
    // `composition` mode this assertion catches it before the runtime
    // does.
    const observed = new Set<string>();
    for (const slug of slugDirs) {
      const skillMdPath = join(catalogRoot, slug, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;
      const src = readFileSync(skillMdPath, "utf8");
      const result = parseSkillMdInternal(src, skillMdPath);
      if (!result.valid) continue;
      const exec = result.parsed.execution ?? "context";
      observed.add(exec);
    }
    // Subset-of test, not equality — adding a new skill type later
    // shouldn't break this guard rail.
    for (const v of observed) {
      expect(["script", "context"]).toContain(v);
    }
  });
});

// Tiny narrative for the sanity check at the catalog directory level —
// this catches an outright wipe of the catalog (would otherwise pass
// vacuously in the it.each above with zero rows).
describe("catalog directory shape (post-U2)", () => {
  it("includes the two slugs that shipped without frontmatter pre-U2", () => {
    expect(slugDirs).toContain("customer-onboarding");
    expect(slugDirs).toContain("sandbox-pilot");
  });

  it("every directory in slugDirs has a SKILL.md", () => {
    for (const slug of slugDirs) {
      const p = join(catalogRoot, slug, "SKILL.md");
      expect(
        existsSync(p) && statSync(p).isFile(),
        `${p} must exist`,
      ).toBe(true);
    }
  });
});
