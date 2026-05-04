import { describe, expect, it } from "vitest";
import {
  normalizeAgentRuntimeType,
  resolveRuntimeFunctionName,
  RuntimeNotProvisionedError,
} from "../resolve-runtime-function-name.js";

describe("normalizeAgentRuntimeType", () => {
  it("keeps flue and defaults everything else to strands", () => {
    expect(normalizeAgentRuntimeType("flue")).toBe("flue");
    expect(normalizeAgentRuntimeType("strands")).toBe("strands");
    expect(normalizeAgentRuntimeType(null)).toBe("strands");
    expect(normalizeAgentRuntimeType("unknown")).toBe("strands");
    // Pi values still in flight from before the U3 migration get
    // normalized to strands; the SQL data migration backfills the
    // column to `flue` so this branch is only reachable for
    // fixtures or stale wire payloads.
    expect(normalizeAgentRuntimeType("pi")).toBe("strands");
  });
});

describe("resolveRuntimeFunctionName", () => {
  it("uses the Strands function for strands runtime", () => {
    expect(
      resolveRuntimeFunctionName("strands", {
        AGENTCORE_FUNCTION_NAME: "thinkwork-dev-agentcore",
        AGENTCORE_FLUE_FUNCTION_NAME: "thinkwork-dev-agentcore-flue",
      }),
    ).toBe("thinkwork-dev-agentcore");
  });

  it("uses the Flue function for flue runtime", () => {
    expect(
      resolveRuntimeFunctionName("flue", {
        AGENTCORE_FUNCTION_NAME: "thinkwork-dev-agentcore",
        AGENTCORE_FLUE_FUNCTION_NAME: "thinkwork-dev-agentcore-flue",
      }),
    ).toBe("thinkwork-dev-agentcore-flue");
  });

  it("fails loudly when the selected runtime is not provisioned", () => {
    expect(() =>
      resolveRuntimeFunctionName("flue", {
        AGENTCORE_FUNCTION_NAME: "thinkwork-dev-agentcore",
        AGENTCORE_FLUE_FUNCTION_NAME: "",
      }),
    ).toThrow(RuntimeNotProvisionedError);
  });
});
