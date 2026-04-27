import { describe, expect, it } from "vitest";
import { composeSystemPrompt } from "../src/runtime/system-prompt.js";

describe("composeSystemPrompt", () => {
  it("uses the explicit prompt when provided", () => {
    expect(composeSystemPrompt({ system_prompt: "Be precise." })).toBe(
      "Be precise.",
    );
  });

  it("builds a default Pi runtime prompt", () => {
    const prompt = composeSystemPrompt({
      agent_name: "Researcher",
      tenant_slug: "acme",
      instance_id: "researcher",
    });
    expect(prompt).toContain("Researcher");
    expect(prompt).toContain("Pi AgentCore runtime");
    expect(prompt).toContain("Tenant: acme");
  });
});
