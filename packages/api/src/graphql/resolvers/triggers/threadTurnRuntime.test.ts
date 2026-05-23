import { describe, expect, it } from "vitest";
import {
  modelFromTurn,
  runtimeTypeFromTurn,
  withRuntimeType,
} from "./threadTurnRuntime.js";

describe("thread turn runtime helpers", () => {
  it("prefers the persisted runtime_type column", () => {
    expect(
      runtimeTypeFromTurn({
        runtime_type: "pi",
        result_json: { runtime: "strands" },
      }),
    ).toBe("pi");
  });

  it("falls back to legacy JSON snapshots", () => {
    expect(
      withRuntimeType({
        contextSnapshot: { runtime_type: "strands" },
      }).runtimeType,
    ).toBe("strands");
    expect(
      withRuntimeType({
        resultJson: { response: { runtime: "pi" } },
      }).runtimeType,
    ).toBe("pi");
  });

  it("extracts the model from turn snapshots", () => {
    expect(
      modelFromTurn({
        context_snapshot: { model: "us.anthropic.claude-haiku-4-5-v1:0" },
      }),
    ).toBe("us.anthropic.claude-haiku-4-5-v1:0");
    expect(
      modelFromTurn({
        usageJson: { response: { modelId: "openai.gpt-oss-120b-1:0" } },
      }),
    ).toBe("openai.gpt-oss-120b-1:0");
  });
});
