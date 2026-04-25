/**
 * U8 — audit script + first-migration sanity checks.
 *
 * Keeps three guard rails on the U8 per-slug migration:
 *
 *   1. The audit script runs and emits the expected markdown skeleton.
 *   2. The `regressed` bucket is empty — no slug still declares a
 *      composition or declarative execution type now that U6 has
 *      removed the runtime for those.
 *   3. The first-migration exemplar (`sales-prep`) stays on the new
 *      shape: `execution: context`, no `steps:` block, `requires_skills`
 *      declared, SKILL.md still valid frontmatter.
 *
 * Test runs from the catalog package root via vitest; no DB / network.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { parseSkillMdInternal } from "../../api/src/lib/skill-md-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = resolve(__dirname, "..");
const auditScript = join(catalogRoot, "scripts", "u8-status.ts");

function runAudit(): string {
  return execSync(`pnpm exec tsx ${auditScript}`, {
    cwd: resolve(catalogRoot, "..", ".."),
    encoding: "utf8",
  });
}

/**
 * Read a skill's frontmatter as a plain mapping. Post plan 2026-04-24-009
 * §U2 the canonical source is SKILL.md frontmatter — this helper goes
 * through U1's lenient parser so the test reads exactly what the catalog
 * loaders read. The function name stays historical (formerly read
 * `skill.yaml`) to keep the call sites compact.
 */
function readYaml(slug: string): Record<string, unknown> {
  const path = join(catalogRoot, slug, "SKILL.md");
  const result = parseSkillMdInternal(readFileSync(path, "utf8"), path);
  if (!result.valid) {
    throw new Error(
      `SKILL.md frontmatter for ${slug} did not parse: ` +
        result.errors.map((e) => e.message).join("; "),
    );
  }
  return result.parsed.data;
}

describe("u8-status audit script", () => {
  it("runs + emits the expected markdown skeleton", () => {
    const out = runAudit();
    expect(out).toContain("# U8 — Skill catalog migration status");
    expect(out).toContain("## Summary");
    expect(out).toContain("## Per-slug detail");
    expect(out).toContain("## Migration guidance");
  });

  it("reports the deliverable set + connectors as `done`", () => {
    const out = runAudit();
    const donePattern = /\| done \| (\d+) \|/;
    const match = out.match(donePattern);
    expect(match).not.toBeNull();
    // Post pure-skill-spec cleanup the 4 composition primitives (frame,
    // synthesize, gather, compound) are gone. Remaining deliverables +
    // connectors + built-ins still clear 16.
    expect(Number(match![1])).toBeGreaterThanOrEqual(16);
  });

  it("has no regressed slugs (composition / declarative / unsupported)", () => {
    const out = runAudit();
    const regressedPattern = /\| regressed \| (\d+) \|/;
    const match = out.match(regressedPattern);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(0);
  });

  it("has no unknown slugs — every SKILL.md parses + declares execution", () => {
    const out = runAudit();
    const unknownPattern = /\| unknown \| (\d+) \|/;
    const match = out.match(unknownPattern);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(0);
  });
});

describe("sales-prep (U8 first migration exemplar)", () => {
  it("declares execution: context on the post-U8 shape", () => {
    // Post plan 2026-04-24-009 §U2 the per-slug skill.yaml is gone and
    // the canonical metadata lives on SKILL.md frontmatter. We read it
    // through U1's lenient parser so this assertion stays aligned with
    // how the catalog loaders see the field.
    const skillMdPath = join(catalogRoot, "sales-prep", "SKILL.md");
    const result = parseSkillMdInternal(
      readFileSync(skillMdPath, "utf8"),
      skillMdPath,
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.parsed.execution).toBe("context");
  });

  it("has no steps: block (the composition runner is the retired path)", () => {
    const yml = readYaml("sales-prep");
    expect(yml.steps).toBeUndefined();
  });

  it("declares requires_skills so template session_allowlist includes the real tool-call dependencies", () => {
    const yml = readYaml("sales-prep");
    expect(Array.isArray(yml.requires_skills)).toBe(true);
    const required = yml.requires_skills as string[];
    // Post pure-skill-spec cleanup: framing + synthesis happen inline,
    // only `package` and connector slugs belong on requires_skills.
    expect(required).toContain("package");
    expect(required).not.toContain("frame");
    expect(required).not.toContain("synthesize");
    expect(required).not.toContain("gather");
  });

  it("keeps the original inputs contract (customer, meeting_date, focus)", () => {
    const yml = readYaml("sales-prep");
    const inputs = yml.inputs as Record<string, unknown>;
    expect(inputs).toHaveProperty("customer");
    expect(inputs).toHaveProperty("meeting_date");
    expect(inputs).toHaveProperty("focus");
  });

  it("SKILL.md has valid frontmatter (U9 validator contract)", () => {
    const md = readFileSync(
      join(catalogRoot, "sales-prep", "SKILL.md"),
      "utf8",
    );
    expect(md.startsWith("---\n")).toBe(true);
    const frontmatterEnd = md.indexOf("\n---\n", 4);
    expect(frontmatterEnd).toBeGreaterThan(0);
    const frontmatter = parseYaml(md.slice(4, frontmatterEnd + 1)) as Record<
      string,
      unknown
    >;
    expect(frontmatter.name).toBe("sales-prep");
    expect(typeof frontmatter.description).toBe("string");
  });
});
