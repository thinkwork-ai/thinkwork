/**
 * THINK-220 guard: no source file may hard-code a schema-qualified Hindsight
 * table reference (`hindsight.<table>`). Every such reference must route
 * through the database-pg seam (`hindsightSql()` / `hindsightSchemaPrefix()`)
 * so a single env flip (`HINDSIGHT_DATABASE_NAME`) moves all Hindsight SQL to
 * the dedicated `public`-schema database. A literal that bypasses the seam
 * would silently keep pointing at the retired `hindsight` schema post-cutover.
 *
 * The scan covers packages/api/src plus the Pi memory provider (which cannot
 * import database-pg and carries its own module-local seam). *.test.ts files
 * and this guard are excluded.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HINDSIGHT_TABLES = [
  "memory_units",
  "banks",
  "documents",
  "entities",
  "mental_models",
  "unit_entities",
  "memory_links",
  "entity_cooccurrences",
  "chunks",
  "directives",
  "webhooks",
  "async_operations",
  "audit_log",
  "observations",
] as const;

const FORBIDDEN = new RegExp(`hindsight\\.(${HINDSIGHT_TABLES.join("|")})`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/api/src
const API_SRC = path.resolve(HERE, "../..");
// packages/agentcore-pi/agent-container/src/runtime/providers/...
const PI_PROVIDER = path.resolve(
  HERE,
  "../../../../agentcore-pi/agent-container/src/runtime/providers/hindsight-memory-provider.ts",
);

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts")) continue;
    out.push(full);
  }
  return out;
}

describe("hindsight schema seam guard", () => {
  it("has no literal hindsight.<table> references outside the seam", () => {
    const files = [...collectTsFiles(API_SRC), PI_PROVIDER];
    const offenders: string[] = [];
    for (const file of files) {
      const contents = readFileSync(file, "utf8");
      const lines = contents.split("\n");
      lines.forEach((line, idx) => {
        if (FORBIDDEN.test(line)) {
          offenders.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
