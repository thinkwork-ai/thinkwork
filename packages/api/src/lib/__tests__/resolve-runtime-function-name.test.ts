import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAgentRuntimeType,
  resolveRuntimeFunctionName,
  RuntimeNotProvisionedError,
  UnknownAgentRuntimeTypeError,
} from "../resolve-runtime-function-name.js";

describe("normalizeAgentRuntimeType", () => {
  it("keeps pi and coerces legacy runtime selectors to pi", () => {
    expect(normalizeAgentRuntimeType("pi")).toBe("pi");
    expect(normalizeAgentRuntimeType("flue")).toBe("pi");
    expect(normalizeAgentRuntimeType("strands")).toBe("pi");
  });

  it("defaults null and empty runtime values to pi", () => {
    expect(normalizeAgentRuntimeType(null)).toBe("pi");
    expect(normalizeAgentRuntimeType(undefined)).toBe("pi");
    expect(normalizeAgentRuntimeType("")).toBe("pi");
  });

  it("normalizes legacy harness selectors to Pi (THINK-324)", () => {
    expect(normalizeAgentRuntimeType("agentcore")).toBe("pi");
    expect(normalizeAgentRuntimeType("AGENTCORE")).toBe("pi");
    expect(normalizeAgentRuntimeType("harness")).toBe("pi");
    expect(normalizeAgentRuntimeType("HARNESS")).toBe("pi");
  });

  it("fails loudly on unknown runtime selectors instead of silently running Pi", () => {
    expect(() => normalizeAgentRuntimeType("unknown")).toThrow(
      UnknownAgentRuntimeTypeError,
    );
    expect(() => normalizeAgentRuntimeType("harness2")).toThrow(
      UnknownAgentRuntimeTypeError,
    );
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves legacy agentcore/harness selectors to the Pi function (THINK-324)", () => {
    expect(
      resolveRuntimeFunctionName("agentcore", {
        AGENTCORE_PI_FUNCTION_NAME: "thinkwork-dev-agentcore-pi",
      }),
    ).toBe("thinkwork-dev-agentcore-pi");
  });
});
