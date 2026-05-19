import { describe, expect, it } from "vitest";

import { validatePlannerResult } from "./planner.js";

function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    pageUpdates: [],
    newPages: [],
    unresolvedMentions: [],
    promotions: [],
    ...overrides,
  };
}

describe("validatePlannerResult", () => {
  it("treats blank optional ontology strings as absent", () => {
    const plan = basePlan({
      newPages: [
        {
          type: "topic",
          title: "Pricing Notes",
          slug: "pricing-notes",
          entityTypeSlug: " ",
          sections: [
            {
              slug: "summary",
              heading: "Summary",
              body_md: "Pricing was discussed.",
              facetSlug: "",
            },
          ],
        },
      ],
    });

    expect(() => validatePlannerResult(plan)).not.toThrow();
    expect(
      (plan.newPages as Array<Record<string, unknown>>)[0],
    ).not.toHaveProperty("entityTypeSlug");
    expect(
      (plan.newPages as Array<{ sections: Array<Record<string, unknown>> }>)[0]
        .sections[0],
    ).not.toHaveProperty("facetSlug");
  });

  it("still rejects non-string optional ontology fields", () => {
    const plan = basePlan({
      newPages: [
        {
          type: "topic",
          title: "Pricing Notes",
          slug: "pricing-notes",
          entityTypeSlug: 7,
          sections: [],
        },
      ],
    });

    expect(() => validatePlannerResult(plan)).toThrow(
      "newPages.entityTypeSlug must be a non-empty string when present",
    );
  });

  it("normalizes ontology entity slugs that arrive in the page type field", () => {
    const plan = basePlan({
      newPages: [
        {
          type: "opportunity",
          title: "Pipeline Notes",
          slug: "pipeline-notes",
          sections: [],
        },
      ],
    });

    expect(() => validatePlannerResult(plan)).not.toThrow();
    expect((plan.newPages as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: "entity",
      entityTypeSlug: "opportunity",
    });
  });
});
