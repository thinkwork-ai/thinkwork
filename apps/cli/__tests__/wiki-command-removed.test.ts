import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Regression guard for the wiki-backend removal arc (plan 2026-07-24-002 U6).
 *
 * `thinkwork wiki {compile,rebuild,status}` drove the compile pipeline that U1
 * removed. The command modules are gone, so the usual "register it and inspect
 * the Command tree" shape has nothing to import — these assertions work on the
 * source instead, which is also what catches a re-add that never gets wired to
 * a test of its own.
 *
 * This is load-bearing for U5: the CLI's codegen scope is `src/**`, so a
 * surviving `commands/wiki/gql.ts` would fail codegen the moment the GraphQL
 * wiki surface is removed from the schema.
 */
describe("thinkwork wiki command — removed (U6)", () => {
  it("ships no wiki command module", () => {
    expect(existsSync(path.join(cliRoot, "src/commands/wiki.ts"))).toBe(false);
    expect(existsSync(path.join(cliRoot, "src/commands/wiki"))).toBe(false);
  });

  it("does not register a wiki command in the CLI entrypoint", async () => {
    const source = await readFile(path.join(cliRoot, "src/cli.ts"), "utf8");

    expect(source).not.toContain("registerWikiCommand");
    expect(source).not.toContain("commands/wiki");
  });

  it("leaves no wiki GraphQL document in the codegen scope", async () => {
    // `src/**/*.{ts,tsx}` is the CLI codegen document glob. A wiki operation
    // anywhere under src/ selects fields the schema no longer declares, which
    // fails codegen rather than degrading quietly.
    const { readdir } = await import("node:fs/promises");
    const sources: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "gql") continue;
          await walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          sources.push(full);
        }
      }
    };
    await walk(path.join(cliRoot, "src"));

    const offenders: string[] = [];
    for (const file of sources) {
      const text = await readFile(file, "utf8");
      if (
        /\b(wikiPage|wikiSearch|wikiGraph|wikiCompileJobs|compileWikiNow|resetWikiCursor|recentWikiPages)\b/.test(
          text,
        )
      ) {
        offenders.push(path.relative(cliRoot, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
