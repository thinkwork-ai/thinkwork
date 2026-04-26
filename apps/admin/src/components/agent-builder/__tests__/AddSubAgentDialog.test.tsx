import { describe, expect, it } from "vitest";
import { renderSubAgentContext } from "../AddSubAgentDialog";

describe("AddSubAgentDialog helpers", () => {
  it("renders a minimal CONTEXT.md for the chosen slug", () => {
    expect(renderSubAgentContext("support", "minimal")).toBe(
      "# Support\n\nDescribe the work this sub-agent owns.\n",
    );
  });

  it("falls back to the minimal snippet for unknown snippet ids", () => {
    expect(renderSubAgentContext("sales-ops", "missing")).toContain(
      "# Sales Ops",
    );
  });
});
