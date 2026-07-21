import { describe, expect, it } from "vitest";
import {
  agentRuntimeToGraphqlEnum,
  parseAgentRuntimeInput,
} from "./runtime.js";

describe("parseAgentRuntimeInput", () => {
  it("accepts legacy runtime inputs as the internal pi runtime", () => {
    expect(parseAgentRuntimeInput(null)).toBe("pi");
    expect(parseAgentRuntimeInput("STRANDS")).toBe("pi");
    expect(parseAgentRuntimeInput("FLUE")).toBe("pi");
    expect(parseAgentRuntimeInput("PI")).toBe("pi");
  });

  it("normalizes legacy AGENTCORE/harness inputs to Pi (THINK-324)", () => {
    expect(parseAgentRuntimeInput("AGENTCORE")).toBe("pi");
    expect(parseAgentRuntimeInput("agentcore")).toBe("pi");
    expect(parseAgentRuntimeInput("harness")).toBe("pi");
  });

  it("still rejects unknown runtimes", () => {
    expect(() => parseAgentRuntimeInput("warp")).toThrow(
      "Invalid agent runtime",
    );
  });
});

describe("agentRuntimeToGraphqlEnum", () => {
  it("serializes the internal pi runtime through the deployed legacy FLUE enum", () => {
    expect(agentRuntimeToGraphqlEnum("pi")).toBe("FLUE");
    expect(agentRuntimeToGraphqlEnum("PI")).toBe("FLUE");
  });

  it("serializes legacy strands runtime rows through the deployed Pi enum", () => {
    expect(agentRuntimeToGraphqlEnum("strands")).toBe("FLUE");
  });

  it("serializes legacy harness rows as FLUE — Pi is the only runtime (THINK-324)", () => {
    expect(agentRuntimeToGraphqlEnum("harness")).toBe("FLUE");
    expect(agentRuntimeToGraphqlEnum("agentcore")).toBe("FLUE");
  });
});
