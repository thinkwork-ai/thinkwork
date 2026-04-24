/**
 * U8 — audit script + first-migration sanity checks.
 *
 * Keeps three guard rails on the U8 per-slug migration:
 *
 *   1. The audit script runs, emits the expected markdown skeleton.
 *   2. At least one composition → context migration has shipped (if 0,
 *      either the audit's detection is broken or the PR stack regressed).
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = resolve(__dirname, "..");
const auditScript = join(catalogRoot, "scripts", "u8-status.ts");

function runAudit(): string {
  return execSync(`pnpm exec tsx ${auditScript}`, {
    cwd: resolve(catalogRoot, "..", ".."),
    encoding: "utf8",
  });
}

function readYaml(slug: string): Record<string, unknown> {
  const path = join(catalogRoot, slug, "skill.yaml");
  return parseYaml(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("u8-status audit script", () => {
  it("runs + emits the expected markdown skeleton", () => {
    const out = runAudit();
    expect(out).toContain("# U8 — Skill catalog migration status");
    expect(out).toContain("## Summary");
    expect(out).toContain("## Per-slug detail");
    expect(out).toContain("## Migration guidance");
  });

  it("reports at least one migrated composition slug (sales-prep or later)", () => {
    const out = runAudit();
    const donePattern = /\| done \| (\d+) \|/;
    const match = out.match(donePattern);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(18);
  });

  it("still tracks remaining composition slugs for the next PR to pick up", () => {
    const out = runAudit();
    const compositionPattern = /\| composition \| (\d+) \|/;
    const match = out.match(compositionPattern);
    expect(match).not.toBeNull();
    // One composition slug remains: renewal-prep. smoke-package-only is
    // a smoke-probe (counted separately) and migrates last with U6.
    expect(Number(match![1])).toBe(1);
  });

  it("keeps the smoke-probe bucket honest (smoke-package-only stays there)", () => {
    const out = runAudit();
    const probePattern = /\| smoke-probe \| (\d+) \|/;
    const match = out.match(probePattern);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(1);
  });
});

describe("sales-prep (U8 first migration exemplar)", () => {
  it("declares execution: context, not composition", () => {
    const yml = readYaml("sales-prep");
    expect(yml.execution).toBe("context");
  });

  it("has no steps: block (composition_runner is the retired path)", () => {
    const yml = readYaml("sales-prep");
    expect(yml.steps).toBeUndefined();
  });

  it("declares requires_skills so template session_allowlist can include sub-skills", () => {
    const yml = readYaml("sales-prep");
    expect(Array.isArray(yml.requires_skills)).toBe(true);
    const required = yml.requires_skills as string[];
    for (const slug of ["frame", "synthesize", "package"]) {
      expect(required).toContain(slug);
    }
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
