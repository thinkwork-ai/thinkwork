import { describe, expect, it } from "vitest";
import { mentionsRunbook, routeRunbookPrompt } from "./router.js";
import { loadCatalogRunbookSkills } from "./test-fixtures.js";

const runbooks = await loadCatalogRunbookSkills();

describe("runbook router", () => {
  const requireRunbook = (slug: string) => {
    const runbook = runbooks.find((candidate) => candidate.slug === slug);
    if (!runbook) throw new Error(`Missing test runbook ${slug}`);
    return runbook;
  };

  it("routes explicit named runbook invocation without confirmation", () => {
    const match = routeRunbookPrompt({
      prompt: "run the CRM dashboard runbook for LastMile",
      runbooks,
    });

    expect(match.kind).toBe("explicit");
    if (match.kind === "explicit") {
      expect(match.runbook.slug).toBe("crm-dashboard");
      expect(match.confidence).toBe(1);
    }
  });

  it("routes a new-thread CRM dashboard prompt as an explicit runbook invocation", () => {
    const match = routeRunbookPrompt({
      prompt:
        "Create a CRM dashboard for a B2B SaaS sales pipeline from LastMile CRM data. Use the CRM Dashboard runbook. Include pipeline stages, top accounts, stuck deals, forecast risk, and recommended follow-ups.",
      runbooks,
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
      runbooks,
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
        runbooks,
      }),
    ).toEqual({ kind: "no_match" });
  });

  it("does not route explicit named runbooks that are not assigned", () => {
    expect(
      routeRunbookPrompt({
        prompt: "run the CRM dashboard runbook for LastMile",
        runbooks: [requireRunbook("map-artifact")],
      }),
    ).toEqual({ kind: "no_match" });
  });

  it("detects explicit runbook intent even when no assigned skill matches", () => {
    expect(
      mentionsRunbook("Use the CRM Dashboard runbook for this request"),
    ).toBe(true);
    expect(mentionsRunbook("Create a dense CRM dashboard")).toBe(false);
  });

  it("returns ambiguous when top candidates are too close", () => {
    const match = routeRunbookPrompt({
      prompt: "build an evidence dashboard map for supplier risk",
      runbooks,
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
