import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HarnessChatDispatchOnlyError,
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

  it("recognizes the harness trial selector (THINK-311)", () => {
    expect(normalizeAgentRuntimeType("agentcore")).toBe("agentcore");
    expect(normalizeAgentRuntimeType("AGENTCORE")).toBe("agentcore");
    expect(normalizeAgentRuntimeType("harness")).toBe("agentcore");
    expect(normalizeAgentRuntimeType("HARNESS")).toBe("agentcore");
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

  it("resolves the harness runner for the harness runtime, never the Pi function", () => {
    expect(
      resolveRuntimeFunctionName("agentcore", {
        AGENTCORE_PI_FUNCTION_NAME: "thinkwork-dev-agentcore-pi",
        HARNESS_RUNNER_FUNCTION_NAME: "thinkwork-dev-harness-runner",
      }),
    ).toBe("thinkwork-dev-harness-runner");
  });

  it("derives the harness runner name from STAGE when no override is set (R1/R10)", () => {
    vi.stubEnv("STAGE", "dev");
    expect(
      resolveRuntimeFunctionName("agentcore", {
        AGENTCORE_PI_FUNCTION_NAME: "thinkwork-dev-agentcore-pi",
      }),
    ).toBe("thinkwork-dev-api-harness-runner");
  });

  it("fails loudly while the harness runner is unprovisioned (inert phase)", () => {
    vi.stubEnv("STAGE", "");
    // The Pi function being configured must NOT rescue a harness-flagged
    // agent — that would be the silent fallback R4 forbids.
    expect(() =>
      resolveRuntimeFunctionName("agentcore", {
        AGENTCORE_PI_FUNCTION_NAME: "thinkwork-dev-agentcore-pi",
        HARNESS_RUNNER_FUNCTION_NAME: "",
      }),
    ).toThrow(RuntimeNotProvisionedError);
    try {
      resolveRuntimeFunctionName("agentcore", {
        AGENTCORE_PI_FUNCTION_NAME: "thinkwork-dev-agentcore-pi",
      });
      expect.unreachable("harness resolution must throw while unprovisioned");
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeNotProvisionedError);
      expect((err as RuntimeNotProvisionedError).runtimeType).toBe("agentcore");
      expect((err as Error).message).toContain("Harness runtime");
    }
  });
});

describe("HarnessChatDispatchOnlyError", () => {
  it("names the rejected dispatch channel", () => {
    const err = new HarnessChatDispatchOnlyError("wakeup");
    expect(err.message).toContain("chat dispatch");
    expect(err.message).toContain("wakeup");
    expect(err.channel).toBe("wakeup");
  });
});
