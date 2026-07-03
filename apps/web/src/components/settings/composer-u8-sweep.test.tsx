import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Composer plan U8 — AE4 sweep (R3/R11).
 *
 * After v-final, the unified capability grant/detach write path lives in ONE
 * place: the Composer (`SettingsCapabilities.tsx`). No other component may
 * reference the grant/detach mutations — registries and the Agents surface are
 * inventory only. This test walks the web source tree and fails if any
 * non-Composer, non-generated, non-test module names those mutations.
 */

const WEB_SRC = join(process.cwd(), "src");
const MUTATION_NAMES = [
  "SettingsGrantCapabilityMutation",
  "SettingsDetachCapabilityMutation",
];

// The ONLY files allowed to name the grant/detach mutations: the Composer
// component itself, and the query-document module that DEFINES them.
const ALLOWED = new Set([
  join("components", "settings", "SettingsCapabilities.tsx"),
  join("lib", "settings-queries.ts"),
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Generated GraphQL artifacts legitimately contain the mutation names.
      if (entry === "gql") continue;
      out.push(...walk(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe("Composer U8 — grant/detach live only in the Composer (AE4)", () => {
  it("no non-Composer web module references the unified grant/detach mutations", () => {
    const offenders: string[] = [];
    for (const file of walk(WEB_SRC)) {
      const rel = file.slice(WEB_SRC.length + 1);
      if (ALLOWED.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (MUTATION_NAMES.some((name) => source.includes(name))) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
