import { describe, expect, it } from "vitest";
import {
  normalizeAgentRuntimeType,
  resolveRuntimeFunctionName,
  RuntimeNotProvisionedError,
} from "../resolve-runtime-function-name.js";

describe("normalizeAgentRuntimeType", () => {
  it("keeps pi and defaults everything else to strands", () => {
    expect(normalizeAgentRuntimeType("pi")).toBe("pi");
    expect(normalizeAgentRuntimeType("strands")).toBe("strands");
    expect(normalizeAgentRuntimeType(null)).toBe("strands");
    expect(normalizeAgentRuntimeType("unknown")).toBe("strands");
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

  it("uses the Pi function for pi runtime", () => {
    expect(
      resolveRuntimeFunctionName("pi", {
        AGENTCORE_FUNCTION_NAME: "thinkwork-dev-agentcore",
        AGENTCORE_FLUE_FUNCTION_NAME: "thinkwork-dev-agentcore-flue",
      }),
    ).toBe("thinkwork-dev-agentcore-flue");
  });

  it("fails loudly when the selected runtime is not provisioned", () => {
    expect(() =>
      resolveRuntimeFunctionName("pi", {
        AGENTCORE_FUNCTION_NAME: "thinkwork-dev-agentcore",
        AGENTCORE_FLUE_FUNCTION_NAME: "",
      }),
    ).toThrow(RuntimeNotProvisionedError);
  });
});
