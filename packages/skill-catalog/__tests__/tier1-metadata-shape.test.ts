/**
 * Plan 2026-04-24-009 §U3 — `tier1_metadata` JSONB shape preservation.
 *
 * `sync-catalog-db.ts` writes the parsed SKILL.md frontmatter into the
 * `skill_catalog.tier1_metadata` JSONB column. Downstream readers
 * (`setAgentSkills.mutation.ts::parseTier1Metadata`,
 * `extractDefaultEnabledOps`, the template-sync resolvers) depend on
 * specific keys living on that blob. Flipping the producer's source
 * from `skill.yaml` (retired) to SKILL.md frontmatter must not change
 * the downstream-visible shape.
 *
 * This test exercises the producer path on a real catalog fixture and
 * asserts the keys consumers care about land where they expect.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSkillMdInternal } from "../../api/src/lib/skill-md-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = resolve(__dirname, "..");

/**
 * Mirror the producer logic in `scripts/sync-catalog-db.ts`: parse a
 * SKILL.md, return the JSONB blob that would land in
 * `skill_catalog.tier1_metadata`. The function under test is only the
 * shape-preserving part; the DB upsert is end-to-end exercised on
 * deploy by the catalog sync step.
 */
function tier1MetadataFor(slug: string): Record<string, unknown> {
  const path = join(catalogRoot, slug, "SKILL.md");
  const result = parseSkillMdInternal(readFileSync(path, "utf-8"), path);
  if (!result.valid) {
    throw new Error(
      `parse failed for ${slug}: ${result.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return result.parsed.data;
}

describe("tier1_metadata JSONB shape (U3 producer flip)", () => {
  it("sales-prep frontmatter exposes the catalog-sync surface keys", () => {
    const meta = tier1MetadataFor("sales-prep");
    // Slug-shaped name (post-U2 canonical).
    expect(meta.name).toBe("sales-prep");
    expect(typeof meta.description).toBe("string");
    expect(meta.execution).toBe("context");
    // Inputs / triggers / requires_skills are the deliverable-shape
    // contract keys downstream consumers look for.
    expect(typeof meta.inputs).toBe("object");
    expect(meta.inputs).toHaveProperty("customer");
    expect(typeof meta.triggers).toBe("object");
    expect(Array.isArray(meta.requires_skills)).toBe(true);
    expect(meta.requires_skills).toContain("package");
  });

  it("artifacts (script-shape) frontmatter exposes scripts[] for default-enabled-ops scan", () => {
    // setAgentSkills.mutation.ts::extractDefaultEnabledOps walks
    // tier1_metadata.scripts[] and pulls `name`s where
    // `default_enabled === true`. Artifacts is a script-shape skill —
    // its scripts[] entries carry `name` / `path` / `description` and
    // (for skills that opt in) `default_enabled`. Verify the producer
    // path preserves the array-of-objects shape with those keys.
    const meta = tier1MetadataFor("artifacts");
    expect(meta.execution).toBe("script");
    expect(Array.isArray(meta.scripts)).toBe(true);
    const scripts = meta.scripts as Array<Record<string, unknown>>;
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.path).toBe("string");
    }
    // Sanity: the keys parseTier1Metadata's downstream readers expect
    // (permissions_model, scripts) are at the top level of the blob,
    // not nested under metadata.* or anywhere else.
    expect(Object.keys(meta)).toEqual(expect.arrayContaining(["execution", "scripts"]));
  });

  it("a script-shape skill with default_enabled scripts surfaces real booleans (not 'true' strings)", () => {
    // Pick any catalog skill that declares a real boolean default_enabled.
    // If none in the current corpus do, this test is informational —
    // assert the YAML coercion contract still holds against a fixture
    // we hand-author here.
    const fixture = [
      "---",
      "name: fixture-script",
      "description: x",
      "execution: script",
      "permissions_model: operations",
      "scripts:",
      "  - name: op_a",
      "    path: scripts/ops.py",
      "    default_enabled: true",
      "  - name: op_b",
      "    path: scripts/ops.py",
      "    default_enabled: false",
      "---",
      "",
      "Body.",
    ].join("\n");
    const result = parseSkillMdInternal(fixture, "fixture/SKILL.md");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const meta = result.parsed.data;
    expect(meta.permissions_model).toBe("operations");
    const scripts = meta.scripts as Array<Record<string, unknown>>;
    // Real booleans, not the literal strings "true" / "false".
    expect(scripts[0].default_enabled).toBe(true);
    expect(scripts[1].default_enabled).toBe(false);
  });

  it("catalog frontmatter is JSON-stringifiable for the JSONB write path", () => {
    // sync-catalog-db.ts does `JSON.stringify(parsed)` before handing
    // the blob to drizzle's RDS Data API path. Anything that doesn't
    // round-trip cleanly (functions, circular refs, BigInts) would
    // break the upsert. Smoke-test against the largest-shaped skill
    // we have on hand.
    const meta = tier1MetadataFor("sales-prep");
    const json = JSON.stringify(meta);
    const round = JSON.parse(json) as Record<string, unknown>;
    expect(round.name).toBe(meta.name);
    expect(round.execution).toBe(meta.execution);
  });
});
