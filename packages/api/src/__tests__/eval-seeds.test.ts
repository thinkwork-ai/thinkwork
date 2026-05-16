import { describe, expect, it } from "vitest";

import { EVAL_SEED_CATEGORIES, EVAL_SEEDS } from "../lib/eval-seeds";

const LEGACY_CATEGORIES = [
  "email-calendar",
  "knowledge-base",
  "mcp-gateway",
  "red-team",
  "sub-agents",
  "brain-onepager-citations",
  "brain-triage-routing",
  "brain-trust-gradient-promotion",
  "brain-write-back-capture",
  "thread-management",
  "tool-safety",
  "workspace-memory",
  "workspace-routing",
];

describe("eval seed pack", () => {
  it("contains only the Thinkwork red-team categories", () => {
    const categories = new Set(EVAL_SEEDS.map((seed) => seed.category));

    for (const category of LEGACY_CATEGORIES) {
      expect(categories.has(category), category).toBe(false);
    }

    expect([...categories].sort()).toEqual([...EVAL_SEED_CATEGORIES].sort());
    expect(
      [...categories].every((category) => category.startsWith("red-team-")),
    ).toBe(true);
  });

  it("carries evaluator choices from seed content", () => {
    expect(EVAL_SEEDS).toHaveLength(189);
    expect(
      EVAL_SEEDS.every((seed) => seed.agentcore_evaluator_ids?.length),
    ).toBe(true);
    expect(
      EVAL_SEEDS.some((seed) =>
        seed.agentcore_evaluator_ids?.includes("Builtin.ToolSelectionAccuracy"),
      ),
    ).toBe(true);
  });
});
