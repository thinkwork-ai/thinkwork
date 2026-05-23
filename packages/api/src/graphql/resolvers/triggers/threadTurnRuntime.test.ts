import { describe, expect, it } from "vitest";
import { runtimeTypeFromTurn, withRuntimeType } from "./threadTurnRuntime.js";

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
});
