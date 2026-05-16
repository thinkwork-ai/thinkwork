import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const seedsDir = dirname(dirname(fileURLToPath(import.meta.url)));

const NEW_AGENT_FILES = [
  "red-team-agents-prompt-injection.json",
  "red-team-agents-tool-misuse.json",
  "red-team-agents-data-boundary.json",
  "red-team-agents-safety-scope.json",
] as const;

const CATEGORY_BY_FILE: Record<string, string> = {
  "red-team-agents-prompt-injection.json": "red-team-prompt-injection",
  "red-team-agents-tool-misuse.json": "red-team-tool-misuse",
  "red-team-agents-data-boundary.json": "red-team-data-boundary",
  "red-team-agents-safety-scope.json": "red-team-safety-scope",
};

const ALLOWED_EVALUATORS = new Set([
  "Builtin.Helpfulness",
  "Builtin.Correctness",
  "Builtin.Faithfulness",
  "Builtin.ResponseRelevance",
  "Builtin.Conciseness",
  "Builtin.Coherence",
  "Builtin.InstructionFollowing",
  "Builtin.Refusal",
  "Builtin.Harmfulness",
  "Builtin.Stereotyping",
  "Builtin.ToolSelectionAccuracy",
  "Builtin.ToolParameterAccuracy",
  "Builtin.GoalSuccessRate",
  "Builtin.TrajectoryExactOrderMatch",
  "Builtin.TrajectoryInOrderMatch",
  "Builtin.TrajectoryAnyOrderMatch",
]);

const ALLOWED_ASSERTIONS = new Set([
  "contains",
  "not-contains",
  "icontains",
  "equals",
  "regex",
  "llm-rubric",
]);

interface SeedAssertion {
  type?: unknown;
  value?: unknown;
}

interface SeedCase {
  name?: unknown;
  category?: unknown;
  target_surface?: unknown;
  prompt?: unknown;
  query?: unknown;
  expected_behavior?: unknown;
  assertions?: unknown;
  agentcore_evaluator_ids?: unknown;
  threshold?: unknown;
}

function readSeedFile(fileName: string): SeedCase[] {
  const parsed = JSON.parse(readFileSync(join(seedsDir, fileName), "utf8"));
  expect(Array.isArray(parsed), `${fileName} should contain a JSON array`).toBe(
    true,
  );
  return parsed as SeedCase[];
}

describe("eval seed shape invariants", () => {
  it("keeps all seed case names globally unique", () => {
    const seen = new Map<string, string>();

    for (const fileName of readdirSync(seedsDir).filter((name) =>
      name.endsWith(".json"),
    )) {
      for (const testCase of readSeedFile(fileName)) {
        expect(typeof testCase.name, `${fileName} case is missing name`).toBe(
          "string",
        );
        const name = testCase.name as string;
        expect(
          seen.get(name),
          `${name} appears in both ${seen.get(name)} and ${fileName}`,
        ).toBe(undefined);
        seen.set(name, fileName);
      }
    }
  });

  it("validates the default-agent red-team corpus shape", () => {
    for (const fileName of NEW_AGENT_FILES) {
      const cases = readSeedFile(fileName);
      expect(cases, `${fileName} should ship 15 cases`).toHaveLength(15);

      for (const testCase of cases) {
        expect(testCase.category).toBe(CATEGORY_BY_FILE[fileName]);
        expect(testCase.target_surface).toBe("agent");
        expect(typeof testCase.name).toBe("string");
        expect((testCase.name as string).length).toBeGreaterThan(0);
        expect(typeof testCase.prompt).toBe("string");
        expect((testCase.prompt as string).length).toBeGreaterThan(20);
        expect(testCase.query).toBe(testCase.prompt);
        expect(typeof testCase.expected_behavior).toBe("string");
        expect((testCase.expected_behavior as string).length).toBeGreaterThan(
          20,
        );
        expect(typeof testCase.threshold).toBe("number");
        expect(testCase.threshold as number).toBeGreaterThan(0);
        expect(testCase.threshold as number).toBeLessThanOrEqual(1);

        expect(Array.isArray(testCase.agentcore_evaluator_ids)).toBe(true);
        expect(
          (testCase.agentcore_evaluator_ids as unknown[]).length,
        ).toBeGreaterThan(0);
        for (const evaluatorId of testCase.agentcore_evaluator_ids as unknown[]) {
          expect(typeof evaluatorId).toBe("string");
          expect(
            ALLOWED_EVALUATORS.has(evaluatorId as string),
            `${evaluatorId}`,
          ).toBe(true);
        }

        expect(Array.isArray(testCase.assertions)).toBe(true);
        expect((testCase.assertions as unknown[]).length).toBeGreaterThan(0);
        for (const assertion of testCase.assertions as SeedAssertion[]) {
          expect(typeof assertion.type).toBe("string");
          expect(
            ALLOWED_ASSERTIONS.has(assertion.type as string),
            `${assertion.type}`,
          ).toBe(true);
          expect(
            typeof assertion.value === "string" || assertion.value === null,
            `${testCase.name} assertion value should be string or null`,
          ).toBe(true);
        }
      }
    }
  });
});
