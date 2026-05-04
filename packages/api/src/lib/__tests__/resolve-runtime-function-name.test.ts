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
  });

  it("coerces stale 'pi' payloads to 'strands' as a one-way migration aid", () => {
    // Pi values still in flight from before the U3 migration (mid-deploy
    // warm Lambda containers, replayed in-flight invocations, fixture
    // residue) get normalized to strands. The SQL data migration
    // backfills `agents.runtime` to `flue` so this branch is only
    // reachable for stale wire payloads. Once the cutover window has
    // drained, this assertion can be removed.
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
