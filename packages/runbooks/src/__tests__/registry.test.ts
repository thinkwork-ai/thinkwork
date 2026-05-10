import { describe, expect, it } from "vitest";
import { runbookRegistry, createRunbookRegistry } from "../registry.js";
import { RunbookValidationError, type RunbookDefinition } from "../schema.js";

describe("runbook registry", () => {
  it("exports the initial published runbooks", () => {
    expect(runbookRegistry.all.map((runbook) => runbook.slug)).toEqual([
      "crm-dashboard",
      "map-artifact",
      "research-dashboard",
    ]);

    for (const slug of [
      "crm-dashboard",
      "map-artifact",
      "research-dashboard",
    ]) {
      const runbook = runbookRegistry.require(slug);
      expect(runbook.approval.expectedOutputs.length).toBeGreaterThan(0);
      expect(runbook.phases.map((phase) => phase.id)).toEqual([
        "discover",
        "analyze",
        "produce",
        "validate",
      ]);
      expect(runbook.phases.every((phase) => phase.guidanceMarkdown)).toBe(
        true,
      );
    }
  });

  it("rejects duplicate slugs", () => {
    const first = runbookRegistry.require("crm-dashboard");
    const duplicate: RunbookDefinition = {
      ...first,
      version: "0.1.1",
    };

    expect(() => createRunbookRegistry([first, duplicate])).toThrow(
      RunbookValidationError,
    );
  });

  it("throws a clear error when requiring a missing runbook", () => {
    expect(() => runbookRegistry.require("missing")).toThrow(
      "Runbook not found: missing",
    );
  });
});
