/**
 * AgentCore adapter skeleton (Trust Core U10): same contract, still the
 * stubbed "economy mode" path. Activation (real AgentCore Evaluations
 * calls) is a deferred follow-up — gate ON must still produce stubs and
 * this module must never import an AgentCore/Bedrock SDK before that PR.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runScoringEngine } from "@thinkwork/evals-core";
import {
  agentCoreEvaluatorsEnabled,
  createAgentCoreScoringEngine,
  EVAL_AGENTCORE_ENGINE_ID,
} from "./agentcore.js";

const INPUT = {
  query: "Is the deploy done?",
  assertions: [],
  evaluatorIds: ["Builtin.ToolSelectionAccuracy", "Builtin.Toxicity"],
  response: { output: "done", durationMs: 100, sessionId: "s" },
};

/** The exact stub row the pre-contract worker persisted ("economy mode"). */
function skippedStub(evaluatorId: string) {
  return {
    evaluator_id: evaluatorId,
    source: "agentcore",
    value: null,
    label: "skipped",
    explanation:
      "Skipped by eval-worker economy mode. Computer-task eval execution currently uses in-house scoring only.",
    skipped: true,
  };
}

afterEach(() => {
  delete process.env.EVAL_AGENTCORE_EVALUATORS;
});

describe("agentcore adapter through the contract", () => {
  it("identifies as the agentcore engine", () => {
    expect(createAgentCoreScoringEngine().id).toBe(EVAL_AGENTCORE_ENGINE_ID);
  });

  it("gate OFF: returns the byte-identical skipped stubs the pre-contract worker persisted", async () => {
    delete process.env.EVAL_AGENTCORE_EVALUATORS;
    const result = await runScoringEngine(
      createAgentCoreScoringEngine(),
      INPUT,
    );
    expect(JSON.stringify(result.verdicts)).toBe(
      JSON.stringify([
        skippedStub("Builtin.ToolSelectionAccuracy"),
        skippedStub("Builtin.Toxicity"),
      ]),
    );
    expect(result.assertions).toEqual([]);
  });

  it("gate ON: the adapter is invoked but STILL returns stubs (activation deferred, shapes unchanged)", async () => {
    process.env.EVAL_AGENTCORE_EVALUATORS = "enabled";
    expect(agentCoreEvaluatorsEnabled()).toBe(true);
    const result = await runScoringEngine(
      createAgentCoreScoringEngine(),
      INPUT,
    );
    expect(result.verdicts).toEqual([
      skippedStub("Builtin.ToolSelectionAccuracy"),
      skippedStub("Builtin.Toxicity"),
    ]);
    expect(result.assertions).toEqual([]);
  });

  it("no evaluator selection → empty verdicts", async () => {
    const result = await runScoringEngine(createAgentCoreScoringEngine(), {
      ...INPUT,
      evaluatorIds: undefined,
    });
    expect(result.verdicts).toEqual([]);
  });

  it("keeps the gate disabled unless explicitly enabled (existing EVAL_AGENTCORE_EVALUATORS semantics)", () => {
    expect(agentCoreEvaluatorsEnabled(undefined)).toBe(false);
    expect(agentCoreEvaluatorsEnabled("disabled")).toBe(false);
    expect(agentCoreEvaluatorsEnabled("enabled")).toBe(true);
    expect(agentCoreEvaluatorsEnabled("FULL")).toBe(true);
  });

  it("makes no AgentCore/Bedrock SDK calls — the module imports no AWS SDK at all (skeleton invariant)", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "agentcore.ts"),
      "utf8",
    );
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    expect(
      specifiers.filter((specifier) =>
        /@aws-sdk|bedrock|agentcore-direct/.test(specifier),
      ),
    ).toEqual([]);
    // And no dynamic SDK imports either.
    expect(source).not.toMatch(/import\(["']@aws-sdk/);
  });
});
