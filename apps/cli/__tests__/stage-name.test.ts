import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_STAGE_NAME_LENGTH, validateStage } from "../src/config.js";

/**
 * Harness cycle-6 ledger entry: a 16-character stage name pushed
 * `thinkwork-<stage>-api-knowledge-graph-observations-ingest` past Lambda's
 * 64-character function-name cap, 437 resources into the first apply. The
 * stage-length cap must stay consistent with the actual handler list.
 */

describe("validateStage length cap", () => {
  it("accepts real stage names", () => {
    for (const stage of ["dev", "prod", "mcpherson", "hp260701123"]) {
      expect(validateStage(stage).valid, stage).toBe(true);
    }
  });

  it("rejects stages longer than the Lambda-name budget", () => {
    const result = validateStage("hprod-260701-979");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("64");
  });
});

describe("MAX_STAGE_NAME_LENGTH vs the real handler list", () => {
  it("leaves every handler name within Lambda's 64-char cap", () => {
    const handlers = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "terraform",
        "modules",
        "app",
        "lambda-api",
        "handlers.tf",
      ),
      "utf8",
    );
    // Handler map keys: `    "name" = {` with kebab-case names (route maps
    // use "POST /api/..." keys and are excluded by the charset).
    const names = [...handlers.matchAll(/^\s+"([a-z][a-z0-9-]+)"\s*=\s*\{/gm)]
      .map((m) => m[1])
      .filter((n) => !n.includes(" "));
    expect(names.length).toBeGreaterThan(20);
    const longest = names.reduce((a, b) => (b.length > a.length ? b : a));
    // thinkwork-<stage>-api-<handler> → 10 + stage + 5 + handler ≤ 64
    const worstCase =
      "thinkwork-".length +
      MAX_STAGE_NAME_LENGTH +
      "-api-".length +
      longest.length;
    expect(
      worstCase,
      `longest handler "${longest}" (${longest.length}) + ${MAX_STAGE_NAME_LENGTH}-char stage = ${worstCase} — raise/lower MAX_STAGE_NAME_LENGTH`,
    ).toBeLessThanOrEqual(64);
  });
});
