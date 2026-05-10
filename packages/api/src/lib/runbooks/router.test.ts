import { describe, expect, it } from "vitest";
import { runbookRegistry } from "@thinkwork/runbooks";
import { routeRunbookPrompt } from "./router.js";

describe("runbook router", () => {
  it("routes explicit named runbook invocation without confirmation", () => {
    const match = routeRunbookPrompt({
      prompt: "run the CRM dashboard runbook for LastMile",
      runbooks: runbookRegistry.all,
    });

    expect(match.kind).toBe("explicit");
    if (match.kind === "explicit") {
      expect(match.runbook.slug).toBe("crm-dashboard");
      expect(match.confidence).toBe(1);
    }
  });

  it("auto-selects the map runbook for a high-confidence map request", () => {
    const match = routeRunbookPrompt({
      prompt: "build me a map of supplier risk",
      runbooks: runbookRegistry.all,
    });

    expect(match.kind).toBe("auto");
    if (match.kind === "auto") {
      expect(match.runbook.slug).toBe("map-artifact");
      expect(match.confidence).toBeGreaterThanOrEqual(0.62);
    }
  });

  it("returns no_match for novel work without a confident published runbook", () => {
    expect(
      routeRunbookPrompt({
        prompt: "help me rewrite this onboarding email",
        runbooks: runbookRegistry.all,
      }),
    ).toEqual({ kind: "no_match" });
  });

  it("returns ambiguous when top candidates are too close", () => {
    const match = routeRunbookPrompt({
      prompt: "build an evidence dashboard map for supplier risk",
      runbooks: runbookRegistry.all,
    });

    expect(match.kind).toBe("ambiguous");
    if (match.kind === "ambiguous") {
      expect(
        match.candidates.map((candidate) => candidate.runbook.slug),
      ).toContain("research-dashboard");
      expect(match.candidates.length).toBeGreaterThan(1);
    }
  });
});
