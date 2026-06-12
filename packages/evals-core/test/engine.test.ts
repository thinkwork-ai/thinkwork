import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  engineScoringResultViolations,
  EvalEngineContractViolationError,
  runScoringEngine,
  validateEngineScoringResult,
  type EngineScoringInput,
  type EngineScoringResult,
  type ScoringEngine,
} from "../src/index.js";

const INPUT: EngineScoringInput = {
  query: "Is the deploy done?",
  assertions: [{ type: "contains", value: "done" }],
  response: { output: "The deploy is done.", durationMs: 800, sessionId: "s" },
};

function engineReturning(result: unknown): ScoringEngine {
  return {
    id: "test-engine",
    score: async () => result as EngineScoringResult,
  };
}

describe("engine contract boundary validation", () => {
  it("accepts a well-formed result (verdict rows + assertion-snapshot rows)", async () => {
    const result: EngineScoringResult = {
      verdicts: [
        {
          evaluator_id: "Builtin.Toxicity",
          source: "agentcore",
          value: null,
          label: "skipped",
          explanation: "economy mode",
          skipped: true,
        },
      ],
      assertions: [
        {
          type: "contains",
          value: "done",
          passed: true,
          reason: 'Contains "done"',
        },
      ],
    };
    await expect(
      runScoringEngine(engineReturning(result), INPUT),
    ).resolves.toEqual(result);
  });

  it("rejects an unknown status/shape at the boundary with EvalEngineContractViolationError", async () => {
    const malformed = [
      // Engines never decide case status.
      { status: "pass", verdicts: [], assertions: [] },
      // Unknown verdict source vocabulary.
      {
        verdicts: [
          {
            evaluator_id: "x",
            source: "mystery-engine",
            value: 1,
            label: null,
            explanation: null,
          },
        ],
        assertions: [],
      },
      // Non-boolean passed on an assertion row.
      {
        verdicts: [],
        assertions: [{ type: "contains", passed: "maybe", reason: "?" }],
      },
      // Non-numeric verdict value.
      {
        verdicts: [
          {
            evaluator_id: "x",
            source: "agentcore",
            value: "high",
            label: null,
            explanation: null,
          },
        ],
        assertions: [],
      },
      // Missing arrays / not an object at all.
      { verdicts: [], assertions: "nope" },
      null,
      "pass",
    ];

    for (const result of malformed) {
      await expect(
        runScoringEngine(engineReturning(result), INPUT),
      ).rejects.toBeInstanceOf(EvalEngineContractViolationError);
    }
  });

  it("reports every violation with the offending engine id", () => {
    try {
      validateEngineScoringResult("rogue", {
        status: "great",
        verdicts: [{ evaluator_id: "", source: "nope", value: NaN }],
        assertions: [{ type: "", passed: 1 }],
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      const violation = err as EvalEngineContractViolationError;
      expect(violation).toBeInstanceOf(EvalEngineContractViolationError);
      expect(violation.engineId).toBe("rogue");
      expect(violation.message).toContain("'rogue'");
      expect(violation.violations.length).toBeGreaterThanOrEqual(5);
      expect(violation.violations.join("\n")).toMatch(/status/);
    }
  });

  it("returns no violations for a valid result via the collecting form", () => {
    expect(
      engineScoringResultViolations({ verdicts: [], assertions: [] }),
    ).toEqual([]);
  });

  it("propagates engine-thrown errors RAW — never wrapped (throttles stay SQS-retryable)", async () => {
    const throttle = Object.assign(new Error("Rate exceeded"), {
      name: "ThrottlingException",
    });
    const engine: ScoringEngine = {
      id: "in_house",
      score: async () => {
        throw throttle;
      },
    };
    await expect(runScoringEngine(engine, INPUT)).rejects.toBe(throttle);
  });
});

describe("engine-neutrality package boundary", () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  it("evals-core declares no AWS SDK dependency (engines inject side-effectful collaborators)", () => {
    const pkg = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    const declared = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    expect(declared.filter((name) => name.startsWith("@aws-sdk"))).toEqual([]);
  });

  it("the verdict taxonomy and scoring modules never import the engine contract (engines depend on the taxonomy, not the reverse)", () => {
    for (const module of ["types.ts", "scoring.ts"]) {
      const source = readFileSync(join(packageRoot, "src", module), "utf8");
      expect(source).not.toMatch(/from\s+["'].*engine(\.js)?["']/);
      expect(source).not.toMatch(/@aws-sdk/);
    }
  });
});
