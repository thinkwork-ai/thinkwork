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

  it("accepts the AGENTCORE runtime from the Agent-configuration dropdown (THINK-311)", () => {
    expect(parseAgentRuntimeInput("AGENTCORE")).toBe("agentcore");
    expect(parseAgentRuntimeInput("agentcore")).toBe("agentcore");
    expect(parseAgentRuntimeInput("harness")).toBe("agentcore");
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

  it("serializes internal harness rows as the AGENTCORE enum value (THINK-311)", () => {
    expect(agentRuntimeToGraphqlEnum("harness")).toBe("AGENTCORE");
    expect(agentRuntimeToGraphqlEnum("agentcore")).toBe("AGENTCORE");
  });
});
