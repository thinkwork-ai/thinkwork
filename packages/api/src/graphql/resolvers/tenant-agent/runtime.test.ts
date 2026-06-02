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
});

describe("agentRuntimeToGraphqlEnum", () => {
  it("serializes the internal pi runtime through the deployed legacy FLUE enum", () => {
    expect(agentRuntimeToGraphqlEnum("pi")).toBe("FLUE");
    expect(agentRuntimeToGraphqlEnum("PI")).toBe("FLUE");
  });

  it("serializes legacy strands runtime rows through the deployed Pi enum", () => {
    expect(agentRuntimeToGraphqlEnum("strands")).toBe("FLUE");
  });
});
