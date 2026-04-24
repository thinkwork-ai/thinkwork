#!/usr/bin/env tsx
/**
 * U1 — Pre-migration census of the bundled skill catalog.
 *
 * Walks every packages/skill-catalog/<slug>/skill.yaml and records the
 * signals the V1 agent-architecture plan needs to decide how to migrate
 * each skill: YAML shape, script entry points, git-history age, and
 * production usage from agent_skills. Emits a markdown report plus a
 * companion SQL probe for stages the runner cannot reach directly.
 *
 * The plan defines four buckets per slug:
 *   - zero-rows-safe-swap            — no prod rows, safe to rewrite in place
 *   - low-rows-notify                — prod rows exist; notify enabled tenants
 *   - needs-explicit-migration       — slug must be renamed (collision)
 *   - retirement-candidate           — FOUR signals: zero rows + >90d dormant
 *                                      + no open issue + feature-owner sign-off
 *
 * Since feature-owner sign-off cannot be collected autonomously, the
 * census emits `retirement-candidate-pending-signoff` for any slug that
 * meets the first three signals. A human promotes it to
 * `retirement-candidate` in a follow-up edit.
 *
 * Usage:
 *   tsx packages/skill-catalog/scripts/census.ts
 *   tsx packages/skill-catalog/scripts/census.ts --no-db
 *   tsx packages/skill-catalog/scripts/census.ts --root <dir> --out <file>
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type YamlExecution =
  | "script"
  | "context"
  | "mcp"
  | "unknown";

export interface SkillScriptEntry {
  name: string;
  path: string;
  description?: string;
}

/** Metadata parsed from a single skill.yaml, independent of git/DB signals. */
export interface SkillMetadata {
  dir: string;
  slug: string;
  yamlPath: string;
  execution: YamlExecution;
  mode?: string;
  description?: string;
  isDefault: boolean;
  scripts: SkillScriptEntry[];
  hasScriptsDir: boolean;
  hasReferencesDir: boolean;
  requiresEnv: string[];
  oauthProvider?: string;
  mcpServer?: string;
}

export interface SkillUsage {
  rows: number;
  tenants: number;
}

export interface SkillSignals {
  /** Days since the most recent commit under the skill directory, or null if git is unavailable. */
  daysSinceLastCommit: number | null;
  /** Rows in agent_skills where enabled=true and skill_id=<slug>. Null if DB was not queried. */
  usage: SkillUsage | null;
}

export type Bucket =
  | "zero-rows-safe-swap"
  | "low-rows-notify"
  | "needs-explicit-migration"
  | "retirement-candidate-pending-signoff";

export type MultiEntryDecision =
  | "single-entrypoint"
  | "collapse-via-action-proposed"
  | "explode-into-n-proposed"
  | "indeterminate";

export interface SkillVerdict {
  bucket: Bucket;
  multiEntry: MultiEntryDecision;
  numEntries: number;
  signalsUsed: {
    zeroRows: boolean | null;
    dormantNinetyDays: boolean | null;
  };
  notes: string[];
}

export interface SkillRow extends SkillMetadata, SkillSignals, SkillVerdict {}

// ---------------------------------------------------------------------------
// skill.yaml parsing
// ---------------------------------------------------------------------------

const EXECUTION_TYPES: readonly YamlExecution[] = [
  "script",
  "context",
  "mcp",
];

function coerceExecution(v: unknown): YamlExecution {
  if (
    typeof v === "string" &&
    (EXECUTION_TYPES as readonly string[]).includes(v)
  ) {
    return v as YamlExecution;
  }
  return "unknown";
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function coerceString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  return undefined;
}

function parseScriptEntries(raw: unknown): SkillScriptEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillScriptEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = coerceString(e.name);
    const path = coerceString(e.path);
    if (!name || !path) continue;
    out.push({
      name,
      path,
      description: coerceString(e.description),
    });
  }
  return out;
}

/**
 * Read a single skill.yaml into structured metadata. Accepts either `slug:`
 * or `id:` as the identifier (both appear in the current corpus).
 */
export function parseSkillYaml(
  yamlText: string,
  yamlPath: string,
): SkillMetadata {
  const y = (parseYaml(yamlText) as Record<string, unknown>) ?? {};
  const slug = coerceString(y.slug) ?? coerceString(y.id) ?? "";
  const dir = dirname(yamlPath);
  const hasScriptsDir =
    existsSync(join(dir, "scripts")) &&
    statSync(join(dir, "scripts")).isDirectory();
  const hasReferencesDir =
    existsSync(join(dir, "references")) &&
    statSync(join(dir, "references")).isDirectory();

  return {
    dir,
    slug,
    yamlPath,
    execution: coerceExecution(y.execution),
    mode: coerceString(y.mode),
    description: coerceString(y.description),
    isDefault: y.is_default === true || y.is_default === "true",
    scripts: parseScriptEntries(y.scripts),
    hasScriptsDir,
    hasReferencesDir,
    requiresEnv: coerceStringArray(y.requires_env),
    oauthProvider: coerceString(y.oauth_provider),
    mcpServer: coerceString(y.mcp_server),
  };
}

/**
 * Walk a catalog root and return one SkillMetadata per skill.yaml found.
 * Sorted by slug for deterministic output.
 */
export function collectSkillMetadata(catalogRoot: string): SkillMetadata[] {
  const entries = readdirSync(catalogRoot, { withFileTypes: true });
  const skills: SkillMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (
      entry.name === "scripts" ||
      entry.name === "templates" ||
      entry.name === "tests"
    )
      continue;
    const yamlPath = join(catalogRoot, entry.name, "skill.yaml");
    if (!existsSync(yamlPath)) continue;
    const yamlText = readFileSync(yamlPath, "utf-8");
    const meta = parseSkillYaml(yamlText, yamlPath);
    if (!meta.slug) continue;
    skills.push(meta);
  }
  skills.sort((a, b) => a.slug.localeCompare(b.slug));
  return skills;
}

// ---------------------------------------------------------------------------
// Multi-entry heuristic
// ---------------------------------------------------------------------------

/**
 * Per the plan: if multiple scripts[] entries share a single path, they
 * already collapse-via-action naturally (propose `collapse-via-action`).
 * If each entry points at its own file, propose `explode-into-N`. A human
 * can override either proposal in the committed census.
 */
export function proposeMultiEntryDecision(meta: SkillMetadata): {
  decision: MultiEntryDecision;
  numEntries: number;
} {
  const entries = meta.scripts;
  if (entries.length === 0) {
    return { decision: "single-entrypoint", numEntries: 0 };
  }
  if (entries.length === 1) {
    return { decision: "single-entrypoint", numEntries: 1 };
  }
  const uniquePaths = new Set(entries.map((e) => e.path));
  if (uniquePaths.size === 1) {
    return {
      decision: "collapse-via-action-proposed",
      numEntries: entries.length,
    };
  }
  if (uniquePaths.size === entries.length) {
    return { decision: "explode-into-n-proposed", numEntries: entries.length };
  }
  return { decision: "indeterminate", numEntries: entries.length };
}

// ---------------------------------------------------------------------------
// Bucketing (four-signal rule)
// ---------------------------------------------------------------------------

const DORMANT_DAYS = 90;

/**
 * Apply the four-signal retirement rule on top of basic usage signals.
 * Three signals are mechanical; feature-owner sign-off is tracked by
 * emitting the explicit `-pending-signoff` suffix, never promoting a
 * slug to `retirement-candidate` unsupervised.
 *
 * Slug-collision detection (the driver of `needs-explicit-migration`) is
 * not mechanical either — it requires a rename decision. Census leaves
 * this bucket unused by default; operators set it during review.
 */
export function classifySkill(
  meta: SkillMetadata,
  signals: SkillSignals,
): SkillVerdict {
  const multi = proposeMultiEntryDecision(meta);
  const zeroRows = signals.usage == null ? null : signals.usage.rows === 0;
  const dormant =
    signals.daysSinceLastCommit == null
      ? null
      : signals.daysSinceLastCommit >= DORMANT_DAYS;
  const notes: string[] = [];

  let bucket: Bucket;
  if (zeroRows == null) {
    // No DB data; default to safe-swap with a note so humans reconcile later.
    bucket = "zero-rows-safe-swap";
    notes.push(
      "db-usage not queried — assumed zero rows; reconcile with staging/prod SQL",
    );
  } else if (zeroRows) {
    if (dormant === true) {
      bucket = "retirement-candidate-pending-signoff";
      notes.push(
        "three mechanical signals met (zero rows + dormant >90d). " +
          "Promote to `retirement-candidate` ONLY after: (a) feature-owner sign-off, " +
          "(b) confirming no open issue references this slug.",
      );
    } else {
      bucket = "zero-rows-safe-swap";
    }
  } else {
    bucket = "low-rows-notify";
    const rows = signals.usage?.rows ?? 0;
    const tenants = signals.usage?.tenants ?? 0;
    notes.push(
      `notify ${tenants} tenant(s) (${rows} enabled rows) before rename or cutover`,
    );
  }

  return {
    bucket,
    multiEntry: multi.decision,
    numEntries: multi.numEntries,
    signalsUsed: {
      zeroRows,
      dormantNinetyDays: dormant,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Git signal (side-effectful — not exercised by unit tests)
// ---------------------------------------------------------------------------

function daysSinceLastCommit(dir: string): number | null {
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${dir}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!iso) return null;
    const last = new Date(iso).getTime();
    if (!Number.isFinite(last)) return null;
    const diffMs = Date.now() - last;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DB signal (side-effectful — not exercised by unit tests)
// ---------------------------------------------------------------------------

interface UsageMap {
  [slug: string]: SkillUsage;
}

async function queryAgentSkillsUsage(
  slugs: string[],
): Promise<UsageMap | null> {
  // Only attempt when an explicit connection is available. We do not want
  // the census to silently talk to "some" database.
  if (!process.env.DATABASE_URL && !process.env.DATABASE_SECRET_ARN) {
    return null;
  }
  if (slugs.length === 0) return {};

  let mod: typeof import("@thinkwork/database-pg") | null = null;
  try {
    mod = await import("@thinkwork/database-pg");
  } catch (err) {
    console.warn(
      "[census] @thinkwork/database-pg unavailable; skipping live query. " +
        `(${(err as Error).message})`,
    );
    return null;
  }

  try {
    const { getDb } = mod;
    const { sql } = await import("drizzle-orm");
    const db = getDb() as unknown as {
      execute: (q: unknown) => Promise<{
        rows: Array<{
          skill_id: string;
          rows: string | number;
          tenants: string | number;
        }>;
      }>;
    };

    // Query one slug at a time rather than binding a text[] — drizzle's
    // raw `sql` template on node-postgres surfaces a "cannot cast record
    // to text[]" when passed a JS array. A per-slug query is trivially
    // fast against the indexed `agent_skills.skill_id` column for the
    // current corpus size (~20 slugs) and avoids driver coercion quirks.
    const map: UsageMap = {};
    for (const slug of slugs) {
      const result = await db.execute(sql`
				select count(*)::int as rows, count(distinct tenant_id)::int as tenants
				from agent_skills
				where enabled = true and skill_id = ${slug}
			`);
      const row = (result.rows ?? [])[0];
      map[slug] = {
        rows:
          typeof row?.rows === "string"
            ? parseInt(row.rows, 10)
            : Number(row?.rows ?? 0),
        tenants:
          typeof row?.tenants === "string"
            ? parseInt(row.tenants, 10)
            : Number(row?.tenants ?? 0),
      };
    }
    return map;
  } catch (err) {
    throw new Error(
      `[census] agent_skills query failed — refusing to report empty counts. ` +
        `Unset DATABASE_URL to skip the DB signal. (${(err as Error).message})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface CensusContext {
  stageLabel: string; // e.g. "dev", or "no-db"
  generatedAt: string;
  repoRoot: string;
  thinkworkAdminNote: string;
}

function mdRow(cells: Array<string | number>): string {
  return `| ${cells.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`;
}

export function renderMarkdown(rows: SkillRow[], ctx: CensusContext): string {
  const header: string[] = [];
  header.push(`# V1 agent-architecture — pre-migration census (U1)`);
  header.push("");
  header.push(`- Generated: ${ctx.generatedAt}`);
  header.push(`- Usage signal: ${ctx.stageLabel}`);
  header.push(`- Catalog root: packages/skill-catalog/`);
  header.push(`- Repo: ${ctx.repoRoot}`);
  header.push("");
  header.push(
    "Plan reference: `docs/plans/2026-04-23-007-feat-v1-agent-architecture-final-call-plan.md` §Implementation Units → U1.",
  );
  header.push("");
  header.push(
    "This file is re-generated by `tsx packages/skill-catalog/scripts/census.ts`. " +
      "Human edits are expected in the Bucket column and the Multi-entry decision column " +
      "— in both cases promote the census's *proposed* verdict to a final one.",
  );
  header.push("");

  // Summary table
  const sum: string[] = [];
  sum.push(`## Summary`);
  sum.push("");
  sum.push(
    mdRow([
      "Slug",
      "YAML execution",
      "Mode",
      "Entries",
      "Multi-entry decision",
      "scripts/",
      "references/",
      "Last commit (days)",
      "Enabled rows",
      "Tenants",
      "Bucket",
    ]),
  );
  sum.push(
    mdRow([
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
    ]),
  );
  for (const r of rows) {
    sum.push(
      mdRow([
        r.slug,
        r.execution,
        r.mode ?? "",
        r.numEntries,
        r.multiEntry,
        r.hasScriptsDir ? "yes" : "no",
        r.hasReferencesDir ? "yes" : "no",
        r.daysSinceLastCommit ?? "?",
        r.usage ? r.usage.rows : "—",
        r.usage ? r.usage.tenants : "—",
        r.bucket,
      ]),
    );
  }
  sum.push("");

  // Aggregate counts
  const bucketCounts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.bucket] = (acc[r.bucket] ?? 0) + 1;
    return acc;
  }, {});
  sum.push(`### Bucket totals`);
  sum.push("");
  for (const [b, n] of Object.entries(bucketCounts).sort()) {
    sum.push(`- **${b}**: ${n}`);
  }
  sum.push("");

  // Per-slug details
  const detail: string[] = [];
  detail.push(`## Per-slug detail`);
  detail.push("");
  for (const r of rows) {
    detail.push(`### ${r.slug}`);
    detail.push("");
    detail.push(`- Path: \`${relative(ctx.repoRoot, r.dir) || r.dir}\``);
    detail.push(
      `- YAML \`execution\`: \`${r.execution}\`` +
        (r.mode ? `, mode: \`${r.mode}\`` : ""),
    );
    if (r.description)
      detail.push(`- Description: ${r.description.split("\n")[0]}`);
    detail.push(`- \`scripts/\`: ${r.hasScriptsDir ? "yes" : "no"}`);
    detail.push(`- \`references/\`: ${r.hasReferencesDir ? "yes" : "no"}`);
    if (r.requiresEnv.length > 0)
      detail.push(`- \`requires_env\`: ${r.requiresEnv.join(", ")}`);
    if (r.oauthProvider)
      detail.push(`- \`oauth_provider\`: ${r.oauthProvider}`);
    if (r.mcpServer) detail.push(`- \`mcp_server\`: ${r.mcpServer}`);
    detail.push(
      `- Last commit under dir: ${r.daysSinceLastCommit ?? "?"} days ago`,
    );
    if (r.usage) {
      detail.push(
        `- \`agent_skills\` (${ctx.stageLabel}): ${r.usage.rows} enabled rows across ${r.usage.tenants} tenants`,
      );
    } else {
      detail.push(
        `- \`agent_skills\`: not queried (see Staging/Prod SQL section)`,
      );
    }
    detail.push(
      `- Verdict: **${r.bucket}**, entries=${r.numEntries}, multi-entry=${r.multiEntry}`,
    );
    if (r.scripts.length > 0) {
      detail.push("");
      detail.push(`**\`scripts[]\` entries:**`);
      detail.push("");
      for (const e of r.scripts) {
        detail.push(
          `- \`${e.name}\` → \`${e.path}\`` +
            (e.description ? ` — ${e.description}` : ""),
        );
      }
    }
    if (r.notes.length > 0) {
      detail.push("");
      for (const n of r.notes) detail.push(`> ${n}`);
    }
    detail.push("");
  }

  // Staging/prod SQL
  const sql: string[] = [];
  sql.push(`## Staging / prod SQL`);
  sql.push("");
  sql.push(
    "The census only auto-queries the database when `DATABASE_URL` is set " +
      "(typically dev via `scripts/db-push.sh --stage dev` resolution). Run the SQL below " +
      "against staging and prod, paste the result back into this file under " +
      "'Per-slug detail', and re-bucket accordingly.",
  );
  sql.push("");
  sql.push("```sql");
  sql.push(renderUsageSql(rows.map((r) => r.slug)));
  sql.push("```");
  sql.push("");

  // Operational notes
  const ops: string[] = [];
  ops.push(`## Operational notes`);
  ops.push("");
  ops.push(
    "- **Retirement-candidate promotion:** for every slug marked `retirement-candidate-pending-signoff`, " +
      'check `gh issue list --search "<slug>" --state open` and obtain written feature-owner sign-off ' +
      "before editing the bucket to `retirement-candidate` in this file and the follow-up PR.",
  );
  ops.push(
    "- **`needs-explicit-migration`:** census never sets this automatically. Set it on a slug during review " +
      "when you've decided to rename (e.g., a new canonical slug coexists alongside the old slug suffixed `-legacy`).",
  );
  ops.push(
    "- **Multi-entry decisions:** the `*-proposed` suffix means the heuristic (shared vs. distinct `scripts[].path`) " +
      "picked a direction; confirm or flip during U8 per-slug PRs.",
  );
  ops.push("");
  ops.push(ctx.thinkworkAdminNote);
  ops.push("");

  return [
    header.join("\n"),
    sum.join("\n"),
    detail.join("\n"),
    sql.join("\n"),
    ops.join("\n"),
  ].join("\n");
}

export function renderUsageSql(slugs: string[]): string {
  const lines: string[] = [];
  lines.push(
    "-- agent_skills usage probe, generated by packages/skill-catalog/scripts/census.ts",
  );
  lines.push(
    "-- Run against staging and prod; paste counts back into the census markdown.",
  );
  lines.push("select");
  lines.push("  skill_id,");
  lines.push("  count(*)                         as enabled_rows,");
  lines.push("  count(distinct tenant_id)        as tenants,");
  lines.push("  min(created_at)                  as first_enabled_at,");
  lines.push("  max(created_at)                  as latest_enabled_at");
  lines.push("from agent_skills");
  lines.push("where enabled = true");
  lines.push(
    `  and skill_id in (${slugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(", ")})`,
  );
  lines.push("group by skill_id");
  lines.push("order by enabled_rows desc, skill_id;");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

interface CliArgs {
  root: string;
  out: string;
  sqlOut: string;
  jsonOut: string;
  noDb: boolean;
}

function parseCliArgs(argv: string[]): CliArgs {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(scriptPath), "..", "..", "..");
  const catalogRoot = resolve(dirname(scriptPath), "..");
  const defaultOut = join(
    repoRoot,
    "docs",
    "plans",
    "2026-04-23-007-feat-v1-agent-architecture-final-call-plan.census.md",
  );
  const defaultSqlOut = join(
    repoRoot,
    "docs",
    "plans",
    "2026-04-23-007-feat-v1-agent-architecture-final-call-plan.census.sql",
  );
  const defaultJsonOut = join(
    repoRoot,
    "docs",
    "plans",
    "2026-04-23-007-feat-v1-agent-architecture-final-call-plan.census.json",
  );

  let root = catalogRoot;
  let out = defaultOut;
  let sqlOut = defaultSqlOut;
  let jsonOut = defaultJsonOut;
  let noDb = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--root":
        root = resolve(argv[++i]!);
        break;
      case "--out":
        out = resolve(argv[++i]!);
        break;
      case "--sql-out":
        sqlOut = resolve(argv[++i]!);
        break;
      case "--json-out":
        jsonOut = resolve(argv[++i]!);
        break;
      case "--no-db":
        noDb = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        console.error(`Unknown arg: ${arg}`);
        printHelp();
        process.exit(2);
    }
  }

  return { root, out, sqlOut, jsonOut, noDb };
}

function printHelp(): void {
  console.log(
    [
      "Usage: tsx packages/skill-catalog/scripts/census.ts [options]",
      "",
      "Options:",
      "  --root <dir>      Catalog root (default: packages/skill-catalog)",
      "  --out <path>      Markdown output (default: docs/plans/...-census.md)",
      "  --sql-out <path>  SQL probe output (default: docs/plans/...-census.sql)",
      "  --json-out <path> Machine-readable JSON (default: docs/plans/...-census.json)",
      "  --no-db           Skip Aurora query even if DATABASE_URL is set",
      "  --help            Show this help",
      "",
      "When DATABASE_URL is set, the agent_skills query runs against that DB.",
      "When unset (or --no-db), only the SQL probe is emitted and usage is recorded as null.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv);
  const metas = collectSkillMetadata(args.root);
  const slugs = metas.map((m) => m.slug);

  let usageMap: UsageMap | null = null;
  let stageLabel = "no-db";
  if (!args.noDb) {
    try {
      usageMap = await queryAgentSkillsUsage(slugs);
      stageLabel = usageMap
        ? (process.env.THINKWORK_STAGE ?? "live (DATABASE_URL)")
        : "no-db";
    } catch (err) {
      // Per the plan: "Aurora failure → actionable error; no empty counts."
      console.error((err as Error).message);
      process.exit(1);
    }
  }

  const rows: SkillRow[] = metas.map((m) => {
    const signals: SkillSignals = {
      daysSinceLastCommit: daysSinceLastCommit(m.dir),
      usage: usageMap ? (usageMap[m.slug] ?? { rows: 0, tenants: 0 }) : null,
    };
    const verdict = classifySkill(m, signals);
    return { ...m, ...signals, ...verdict };
  });

  const ctx: CensusContext = {
    stageLabel,
    generatedAt: new Date().toISOString(),
    repoRoot: resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
    ),
    thinkworkAdminNote: thinkworkAdminNote(),
  };

  const md = renderMarkdown(rows, ctx);
  const sqlProbe = renderUsageSql(slugs);
  const jsonPayload = {
    generatedAt: ctx.generatedAt,
    stageLabel: ctx.stageLabel,
    rows,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, md);
  writeFileSync(args.sqlOut, sqlProbe + "\n");
  writeFileSync(args.jsonOut, JSON.stringify(jsonPayload, null, 2) + "\n");

  console.log(`census: wrote ${rows.length} slugs`);
  console.log(`  markdown → ${args.out}`);
  console.log(`  sql      → ${args.sqlOut}`);
  console.log(`  json     → ${args.jsonOut}`);
  console.log(`  stage    → ${stageLabel}`);
}

/**
 * Fixed operational note about the `thinkwork-admin` skill. It lives only
 * in the `shared-admin-ops-brainstorm` worktree as of 2026-04-24 and is
 * not present in `main`. The plan references it as a 33-entry example for
 * multi-entrypoint bucketing; this note ensures the census audit trail
 * captures why it is absent.
 */
function thinkworkAdminNote(): string {
  return [
    "### `thinkwork-admin` (planned, not yet merged to main)",
    "",
    "The V1 plan references `thinkwork-admin` with 33 script entries as the largest",
    "multi-entrypoint example. As of this census it lives only under",
    "`.claude/worktrees/shared-admin-ops-brainstorm/packages/skill-catalog/thinkwork-admin/`",
    "and is not in `main`. Re-run the census after that worktree's PR merges; expect a new",
    "row with `multi-entry-decision` either `collapse-via-action-proposed` (if all 33",
    "entries share one `scripts[].path`) or `explode-into-n-proposed` (if each has its own).",
  ].join("\n");
}

// Only execute main() when invoked directly — tests import the pure helpers above.
const thisModulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisModulePath) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
