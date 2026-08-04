/**
 * Quality gate (subagent-folders plan 2026-07-15-001, U11): no production
 * code path reads or writes the retired `agent_profiles` /
 * `agent_profile_space_assignments` tables. Sub-agent profiles are
 * workspace `agents/<slug>/INSTRUCTIONS.md` folders compiled into the
 * capabilities manifest; the tables stay in the schema only for the
 * deferred DROP (THINK-297).
 *
 * Grep-backed: scans every production TypeScript source in this package
 * (tests excluded) for a Drizzle operation on — or an import of — the
 * retired table bindings. Mirrors the agent_skills retirement
 * choreography: readers first, writers second, DROP deferred.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..");

const SCAN_ROOTS = [join(PACKAGE_ROOT, "src")];
const ROOT_LEVEL_ENTRYPOINT_SUFFIX = ".ts";

function isTestPath(path: string): boolean {
  return (
    path.includes("__tests__") ||
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    path.includes(`${join("test", "integration")}`)
  );
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (full.endsWith(".ts") && !isTestPath(full)) {
      yield full;
    }
  }
}

function productionSources(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) files.push(...walk(root));
  // Root-level Lambda entrypoints (workspace-files.ts, graphql.ts, …).
  for (const entry of readdirSync(PACKAGE_ROOT)) {
    if (!entry.endsWith(ROOT_LEVEL_ENTRYPOINT_SUFFIX)) continue;
    if (isTestPath(entry)) continue;
    const full = join(PACKAGE_ROOT, entry);
    if (statSync(full).isFile()) files.push(full);
  }
  return files;
}

const RETIRED_TABLE_BINDINGS = [
  "agentProfiles",
  "agentProfileSpaceAssignments",
] as const;

// Drizzle operations on a retired table binding.
const OPERATION_RE = new RegExp(
  String.raw`\b(?:from|insert|update|delete)\(\s*(?:${RETIRED_TABLE_BINDINGS.join("|")})\b`,
);
// Importing the retired table bindings from the schema (or the graphql
// utils re-export barrel) — nothing in this package may bind the Drizzle
// tables. The resolver function named `agentProfiles` (imported from
// ./agentProfiles.query.js) is not a table binding and is exempt.
const IMPORT_RE = new RegExp(
  String.raw`import\s+(?:type\s+)?\{[^}]*\b(?:${RETIRED_TABLE_BINDINGS.join("|")})\b[^}]*\}\s+from\s+["'][^"']*(?:database-pg\/schema|\/utils\.js)["']`,
  "s",
);

describe("agent_profiles retirement gate (U11)", () => {
  it("no production source performs a Drizzle operation on agent_profiles", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const source = readFileSync(file, "utf8");
      if (OPERATION_RE.test(source)) {
        offenders.push(relative(PACKAGE_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no production source imports the retired table bindings", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const source = readFileSync(file, "utf8");
      const imports =
        source.match(/import\s+(?:type\s+)?\{[^}]*\}\s+from[^;]+;/gs) ?? [];
      for (const statement of imports) {
        if (IMPORT_RE.test(statement)) {
          offenders.push(relative(PACKAGE_ROOT, file));
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
