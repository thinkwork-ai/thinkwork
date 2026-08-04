import { describe, expect, it } from "vitest";
import { resolveChatDispatchTarget } from "./resolve-runtime-function-name.js";

const baseEnv = {
  AGENTCORE_PI_FUNCTION_NAME: "thinkwork-dev-agentcore-pi",
  AGENTCORE_RUNTIME_DISPATCH_FUNCTION_NAME:
    "thinkwork-dev-api-agentcore-runtime-dispatch",
};

describe("resolveChatDispatchTarget (KTD3)", () => {
  it("flag off (stage): Pi Lambda path, no sentinel", () => {
    const target = resolveChatDispatchTarget(
      { runtimeType: "pi", agentFlagEnabled: true },
      { ...baseEnv, AGENTCORE_RUNTIME_DISPATCH_ENABLED: "false" },
    );
    expect(target).toEqual({
      kind: "pi_lambda",
      functionName: "thinkwork-dev-agentcore-pi",
      stageFlagOn: false,
    });
  });

  it("stage on + agent on: dispatcher target", () => {
    const target = resolveChatDispatchTarget(
      { runtimeType: "pi", agentFlagEnabled: true },
      { ...baseEnv, AGENTCORE_RUNTIME_DISPATCH_ENABLED: "true" },
    );
    expect(target).toEqual({
      kind: "agentcore_runtime",
      functionName: "thinkwork-dev-api-agentcore-runtime-dispatch",
    });
  });

  it("stage on + agent off: Pi Lambda path with the sentinel signal", () => {
    const target = resolveChatDispatchTarget(
      { runtimeType: "pi", agentFlagEnabled: false },
      { ...baseEnv, AGENTCORE_RUNTIME_DISPATCH_ENABLED: "true" },
    );
    expect(target).toEqual({
      kind: "pi_lambda",
      functionName: "thinkwork-dev-agentcore-pi",
      stageFlagOn: true,
    });
  });
});
