import { describe, expect, it } from "vitest";
import {
  agentRuntimeToGraphqlEnum,
  parseAgentRuntimeInput,
} from "./runtime.js";

describe("parseAgentRuntimeInput", () => {
  it("accepts both legacy FLUE and new PI inputs as the internal pi runtime", () => {
    expect(parseAgentRuntimeInput("FLUE")).toBe("pi");
    expect(parseAgentRuntimeInput("PI")).toBe("pi");
  });
});

describe("agentRuntimeToGraphqlEnum", () => {
  it("serializes the internal pi runtime through the deployed legacy FLUE enum", () => {
    expect(agentRuntimeToGraphqlEnum("pi")).toBe("FLUE");
    expect(agentRuntimeToGraphqlEnum("PI")).toBe("FLUE");
  });

  it("serializes strands as the GraphQL enum value", () => {
    expect(agentRuntimeToGraphqlEnum("strands")).toBe("STRANDS");
  });
});
