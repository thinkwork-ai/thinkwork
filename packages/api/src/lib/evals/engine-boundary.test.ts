/**
 * Package-boundary enforcement (Trust Core U10, R14): the dataset
 * format and the verdict taxonomy must never depend on engine modules —
 * engine-specific concepts can't leak into datasets or verdicts. The
 * U4 extension-strip test in dataset-store.test.ts covers the runtime
 * half (core schema parses with engines.* stripped); this covers the
 * dependency direction.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEvalDatasetCase } from "./dataset-store.js";

const here = dirname(fileURLToPath(import.meta.url));

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
}

describe("engine-neutrality package boundary (U10)", () => {
  it("the dataset format module imports no engine module", () => {
    const specifiers = importSpecifiers(
      readFileSync(join(here, "dataset-store.ts"), "utf8"),
    );
    expect(
      specifiers.filter((specifier) => /engines\//.test(specifier)),
    ).toEqual([]);
    // It may use S3 for storage, but never an engine SDK.
    expect(
      specifiers.filter((specifier) =>
        /bedrock|agentcore-direct/.test(specifier),
      ),
    ).toEqual([]);
  });

  it("the evals-core verdict taxonomy and scoring modules import no engine module and no AWS SDK", () => {
    const evalsCoreSrc = join(here, "../../../../evals-core/src");
    for (const module of ["types.ts", "scoring.ts"]) {
      const specifiers = importSpecifiers(
        readFileSync(join(evalsCoreSrc, module), "utf8"),
      );
      expect(
        specifiers.filter((specifier) =>
          /engine|@aws-sdk|engines\//.test(specifier),
        ),
      ).toEqual([]);
    }
  });

  it("core case schema parses with the engines.* extension block stripped (U4 guarantee holds at the seam)", () => {
    const parsed = parseEvalDatasetCase(
      JSON.stringify({
        case_id: "case-a",
        name: "case-a",
        category: "red-team",
        query: "Please refuse this",
        assertions: [{ type: "icontains", value: "refuse" }],
        engines: { agentcore: { evaluator_ids: ["Builtin.Toxicity"] } },
      }),
    );
    expect(parsed.core).not.toHaveProperty("engines");
    expect(Object.keys(parsed.core).join(",")).not.toMatch(/agentcore/);
    expect(parsed.engines).toEqual({
      agentcore: { evaluator_ids: ["Builtin.Toxicity"] },
    });
  });
});
