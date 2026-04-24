import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  classifySkill,
  collectSkillMetadata,
  parseSkillYaml,
  proposeMultiEntryDecision,
  renderUsageSql,
  type SkillSignals,
} from "../scripts/census";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeSkill(
  root: string,
  slug: string,
  yaml: string,
  {
    scriptsDir = false,
    referencesDir = false,
  }: { scriptsDir?: boolean; referencesDir?: boolean } = {},
): void {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "skill.yaml"), yaml);
  if (scriptsDir) mkdirSync(join(dir, "scripts"), { recursive: true });
  if (referencesDir) mkdirSync(join(dir, "references"), { recursive: true });
}

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "skill-catalog-census-"));
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Happy path — fixture repo with 3 skills produces correct buckets.
// ---------------------------------------------------------------------------

describe("census — happy path", () => {
  it("collects metadata, applies buckets, and captures multi-entry signals for 3 fixture skills", () => {
    writeSkill(
      fixtureRoot,
      "script-single",
      [
        "slug: script-single",
        "execution: script",
        "mode: tool",
        "description: A single-entry script skill",
        "scripts:",
        "  - name: run",
        "    path: scripts/run.py",
        "    description: Runs the thing",
      ].join("\n"),
      { scriptsDir: true },
    );
    writeSkill(
      fixtureRoot,
      "script-multi",
      [
        "slug: script-multi",
        "execution: script",
        "scripts:",
        "  - name: list",
        "    path: scripts/ops.py",
        "  - name: update",
        "    path: scripts/ops.py",
        "  - name: delete",
        "    path: scripts/ops.py",
      ].join("\n"),
      { scriptsDir: true },
    );
    writeSkill(
      fixtureRoot,
      "pure-context",
      [
        "id: pure-context",
        "execution: context",
        "mode: tool",
        "description: No scripts, SKILL.md-only",
      ].join("\n"),
    );

    const metas = collectSkillMetadata(fixtureRoot);
    expect(metas.map((m) => m.slug)).toEqual([
      "pure-context",
      "script-multi",
      "script-single",
    ]);

    const byMeta = Object.fromEntries(metas.map((m) => [m.slug, m]));
    expect(byMeta["script-single"]!.execution).toBe("script");
    expect(byMeta["script-single"]!.hasScriptsDir).toBe(true);
    expect(byMeta["script-single"]!.scripts).toHaveLength(1);

    expect(byMeta["script-multi"]!.scripts.map((s) => s.name)).toEqual([
      "list",
      "update",
      "delete",
    ]);
    expect(
      byMeta["script-multi"]!.scripts.every((s) => s.path === "scripts/ops.py"),
    ).toBe(true);

    expect(byMeta["pure-context"]!.execution).toBe("context");
    expect(byMeta["pure-context"]!.scripts).toHaveLength(0);
    expect(byMeta["pure-context"]!.hasScriptsDir).toBe(false);

    // Zero rows + dormant → retirement-candidate-pending-signoff.
    // Zero rows + NOT dormant → zero-rows-safe-swap.
    const dormant: SkillSignals = {
      daysSinceLastCommit: 120,
      usage: { rows: 0, tenants: 0 },
    };
    const fresh: SkillSignals = {
      daysSinceLastCommit: 3,
      usage: { rows: 0, tenants: 0 },
    };

    expect(classifySkill(byMeta["script-single"]!, fresh).bucket).toBe(
      "zero-rows-safe-swap",
    );
    expect(classifySkill(byMeta["script-multi"]!, fresh).multiEntry).toBe(
      "collapse-via-action-proposed",
    );
    expect(classifySkill(byMeta["script-multi"]!, fresh).numEntries).toBe(3);
    expect(classifySkill(byMeta["pure-context"]!, dormant).bucket).toBe(
      "retirement-candidate-pending-signoff",
    );
  });
});

// ---------------------------------------------------------------------------
// Edge — four-signal rule keeps a dormant-pre-launch slug out of
// retirement-candidate until a human promotes it.
// ---------------------------------------------------------------------------

describe("census — four-signal retirement rule", () => {
  it("emits retirement-candidate-pending-signoff rather than retirement-candidate", () => {
    writeSkill(
      fixtureRoot,
      "dormant-slug",
      ["slug: dormant-slug", "execution: script"].join("\n"),
    );
    const [meta] = collectSkillMetadata(fixtureRoot);
    expect(meta).toBeDefined();

    const verdict = classifySkill(meta!, {
      daysSinceLastCommit: 200,
      usage: { rows: 0, tenants: 0 },
    });
    expect(verdict.bucket).toBe("retirement-candidate-pending-signoff");
    // Explicit safeguard: the census never emits a bare `retirement-candidate`.
    expect(verdict.bucket as string).not.toBe("retirement-candidate");
    expect(verdict.notes.join(" ")).toMatch(/feature-owner sign-off/);
  });

  it("keeps low-rows-notify even when commits are old, because rows are non-zero", () => {
    writeSkill(
      fixtureRoot,
      "in-use-slug",
      ["slug: in-use-slug", "execution: script"].join("\n"),
    );
    const [meta] = collectSkillMetadata(fixtureRoot);
    expect(meta).toBeDefined();

    const verdict = classifySkill(meta!, {
      daysSinceLastCommit: 365,
      usage: { rows: 12, tenants: 3 },
    });
    expect(verdict.bucket).toBe("low-rows-notify");
    expect(verdict.notes.join(" ")).toMatch(/3 tenant/);
  });

  it("does not promote to retirement-candidate when dormancy signal is missing (git unavailable)", () => {
    writeSkill(
      fixtureRoot,
      "unknown-age",
      ["slug: unknown-age", "execution: script"].join("\n"),
    );
    const [meta] = collectSkillMetadata(fixtureRoot);
    expect(meta).toBeDefined();

    const verdict = classifySkill(meta!, {
      daysSinceLastCommit: null,
      usage: { rows: 0, tenants: 0 },
    });
    // Can't be retirement-candidate-pending-signoff without the dormancy signal;
    // zero-rows-safe-swap is the safe downgrade.
    expect(verdict.bucket).toBe("zero-rows-safe-swap");
    expect(verdict.signalsUsed.dormantNinetyDays).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge — multi-entry slug captures all callables + proposes a decision.
// ---------------------------------------------------------------------------

describe("census — multi-entry decisions", () => {
  it("proposes collapse-via-action when all entries share one scripts[].path", () => {
    writeSkill(
      fixtureRoot,
      "shared-path",
      [
        "slug: shared-path",
        "execution: script",
        "scripts:",
        ...["list", "create", "update", "delete"].flatMap((name) => [
          `  - name: ${name}`,
          `    path: scripts/ops.py`,
        ]),
      ].join("\n"),
      { scriptsDir: true },
    );
    const [meta] = collectSkillMetadata(fixtureRoot);
    expect(meta).toBeDefined();
    expect(meta!.scripts).toHaveLength(4);

    const decision = proposeMultiEntryDecision(meta!);
    expect(decision.decision).toBe("collapse-via-action-proposed");
    expect(decision.numEntries).toBe(4);
  });

  it("proposes explode-into-n when each entry has its own path", () => {
    writeSkill(
      fixtureRoot,
      "distinct-paths",
      [
        "slug: distinct-paths",
        "execution: script",
        "scripts:",
        "  - name: alpha",
        "    path: scripts/alpha.py",
        "  - name: beta",
        "    path: scripts/beta.py",
        "  - name: gamma",
        "    path: scripts/gamma.py",
      ].join("\n"),
      { scriptsDir: true },
    );
    const [meta] = collectSkillMetadata(fixtureRoot);
    expect(meta).toBeDefined();

    const decision = proposeMultiEntryDecision(meta!);
    expect(decision.decision).toBe("explode-into-n-proposed");
    expect(decision.numEntries).toBe(3);
  });

  it("flags indeterminate when the corpus mixes shared and distinct paths", () => {
    writeSkill(
      fixtureRoot,
      "mixed",
      [
        "slug: mixed",
        "execution: script",
        "scripts:",
        "  - name: a",
        "    path: scripts/a.py",
        "  - name: b",
        "    path: scripts/a.py",
        "  - name: c",
        "    path: scripts/c.py",
      ].join("\n"),
      { scriptsDir: true },
    );
    const [meta] = collectSkillMetadata(fixtureRoot);
    expect(meta).toBeDefined();

    const decision = proposeMultiEntryDecision(meta!);
    expect(decision.decision).toBe("indeterminate");
  });

  it("simulates the 33-entry thinkwork-admin shape by capturing every callable", () => {
    const scriptsBlock: string[] = ["scripts:"];
    for (let i = 0; i < 33; i++) {
      scriptsBlock.push(`  - name: op_${String(i).padStart(2, "0")}`);
      scriptsBlock.push(`    path: scripts/admin_ops.py`);
      scriptsBlock.push(`    description: admin op ${i}`);
    }
    writeSkill(
      fixtureRoot,
      "thinkwork-admin-fixture",
      [
        "slug: thinkwork-admin-fixture",
        "execution: script",
        "mode: tool",
        ...scriptsBlock,
      ].join("\n"),
      { scriptsDir: true },
    );
    const [meta] = collectSkillMetadata(fixtureRoot);
    expect(meta).toBeDefined();
    expect(meta!.scripts).toHaveLength(33);
    expect(meta!.scripts.every((s) => s.path === "scripts/admin_ops.py")).toBe(
      true,
    );

    const decision = proposeMultiEntryDecision(meta!);
    expect(decision.decision).toBe("collapse-via-action-proposed");
    expect(decision.numEntries).toBe(33);
  });
});

// ---------------------------------------------------------------------------
// Parsing edge cases: `id:` vs `slug:`, execution coercion.
// ---------------------------------------------------------------------------

describe("parseSkillYaml", () => {
  it("accepts id: as a slug alias", () => {
    const meta = parseSkillYaml(
      ["id: legacy-id-form", "execution: context"].join("\n"),
      "/tmp/legacy-id-form/skill.yaml",
    );
    expect(meta.slug).toBe("legacy-id-form");
    expect(meta.execution).toBe("context");
  });

  it("coerces unknown execution values to `unknown` instead of silently passing through", () => {
    const meta = parseSkillYaml(
      ["slug: weird", "execution: moonshot"].join("\n"),
      "/tmp/weird/skill.yaml",
    );
    expect(meta.execution).toBe("unknown");
  });

  it("treats malformed YAML values gracefully and produces a null-ish metadata struct", () => {
    const meta = parseSkillYaml(
      [
        "slug: no-scripts-array",
        "execution: script",
        "scripts: not-a-list",
      ].join("\n"),
      "/tmp/no-scripts-array/skill.yaml",
    );
    expect(meta.slug).toBe("no-scripts-array");
    expect(meta.scripts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SQL probe shape.
// ---------------------------------------------------------------------------

describe("renderUsageSql", () => {
  it("quotes slugs and groups by skill_id", () => {
    const sql = renderUsageSql(["alpha", "beta-two"]);
    expect(sql).toContain("from agent_skills");
    expect(sql).toContain("'alpha'");
    expect(sql).toContain("'beta-two'");
    expect(sql).toMatch(/group by skill_id/);
    expect(sql).toMatch(/enabled = true/);
  });

  it("escapes single-quotes in slugs defensively", () => {
    const sql = renderUsageSql(["normal", "weird's-slug"]);
    expect(sql).toContain("'weird''s-slug'");
  });
});

// ---------------------------------------------------------------------------
// Integration-ish: full walk of the real repo fixture layout emits one row
// per skill.yaml and the rows are deterministic across runs.
// ---------------------------------------------------------------------------

describe("collectSkillMetadata", () => {
  it("produces the same ordered output across repeated runs", () => {
    writeSkill(fixtureRoot, "b-slug", "slug: b-slug\nexecution: context\n");
    writeSkill(fixtureRoot, "a-slug", "slug: a-slug\nexecution: script\n", {
      scriptsDir: true,
    });
    writeSkill(fixtureRoot, "c-slug", "slug: c-slug\nexecution: mcp\n");

    const first = collectSkillMetadata(fixtureRoot).map((m) => m.slug);
    const second = collectSkillMetadata(fixtureRoot).map((m) => m.slug);
    expect(first).toEqual(["a-slug", "b-slug", "c-slug"]);
    expect(first).toEqual(second);
  });

  it("ignores non-skill directories like scripts/, tests/, and dotfiles", () => {
    mkdirSync(join(fixtureRoot, "scripts"), { recursive: true });
    mkdirSync(join(fixtureRoot, "tests"), { recursive: true });
    mkdirSync(join(fixtureRoot, ".dot"), { recursive: true });
    mkdirSync(join(fixtureRoot, "node_modules"), { recursive: true });
    writeSkill(
      fixtureRoot,
      "real-skill",
      "slug: real-skill\nexecution: script\n",
    );

    const metas = collectSkillMetadata(fixtureRoot);
    expect(metas.map((m) => m.slug)).toEqual(["real-skill"]);
  });
});
