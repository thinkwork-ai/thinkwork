import { describe, expect, it } from "vitest";
import {
  normalizeAgentRuntimeType,
  resolveRuntimeFunctionName,
  RuntimeNotProvisionedError,
} from "../resolve-runtime-function-name.js";

describe("normalizeAgentRuntimeType", () => {
  it("keeps pi and coerces legacy runtime selectors to pi", () => {
    expect(normalizeAgentRuntimeType("pi")).toBe("pi");
    expect(normalizeAgentRuntimeType("flue")).toBe("pi");
    expect(normalizeAgentRuntimeType("strands")).toBe("pi");
  });

  it("defaults null and unknown runtime values to pi", () => {
    expect(normalizeAgentRuntimeType(null)).toBe("pi");
    expect(normalizeAgentRuntimeType("unknown")).toBe("pi");
  });
});

describe("resolveRuntimeFunctionName", () => {
  it("uses the Pi function for legacy strands runtime selections", () => {
    expect(
      resolveRuntimeFunctionName("strands", {
        AGENTCORE_FUNCTION_NAME: "thinkwork-dev-agentcore",
        AGENTCORE_PI_FUNCTION_NAME: "thinkwork-dev-agentcore-pi",
      }),
    ).toBe("thinkwork-dev-agentcore-pi");
  });

  it("uses the Pi function for pi runtime", () => {
    expect(
      resolveRuntimeFunctionName("pi", {
        AGENTCORE_FUNCTION_NAME: "thinkwork-dev-agentcore",
        AGENTCORE_PI_FUNCTION_NAME: "thinkwork-dev-agentcore-pi",
      }),
    ).toBe("thinkwork-dev-agentcore-pi");
  });

  it("fails loudly when the selected runtime is not provisioned", () => {
    expect(() =>
      resolveRuntimeFunctionName("strands", {
        AGENTCORE_FUNCTION_NAME: "thinkwork-dev-agentcore",
        AGENTCORE_PI_FUNCTION_NAME: "",
      }),
    ).toThrow(RuntimeNotProvisionedError);
  });
});
