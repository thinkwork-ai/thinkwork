import { describe, expect, it } from "vitest";

import {
  normalizeSectionBody,
  normalizeSectionHeading,
  renderBodyMarkdown,
} from "./repository.js";

describe("normalizeSectionHeading", () => {
  it("keeps a non-empty planner heading", () => {
    expect(normalizeSectionHeading("  Places to revisit  ", "overview")).toBe(
      "Places to revisit",
    );
  });

  it("falls back to a readable heading from the section slug", () => {
    expect(normalizeSectionHeading(null, "favorite_places")).toBe(
      "Favorite Places",
    );
    expect(normalizeSectionHeading("", "trip-notes")).toBe("Trip Notes");
  });

  it("uses Overview when both heading and slug are empty", () => {
    expect(normalizeSectionHeading(undefined, "")).toBe("Overview");
  });
});

describe("normalizeSectionBody", () => {
  it("returns an empty body for nullish or malformed planner values", () => {
    expect(normalizeSectionBody(null)).toBe("");
    expect(normalizeSectionBody(undefined)).toBe("");
    expect(normalizeSectionBody({ body: "not markdown" })).toBe("");
  });

  it("strips wikilink bracket syntax before persistence", () => {
    expect(normalizeSectionBody("Visit [[Paris|the city]] soon.")).toBe(
      "Visit the city soon.",
    );
  });
});

describe("renderBodyMarkdown", () => {
  it("normalizes missing headings and bodies while rendering sections", () => {
    const out = renderBodyMarkdown([
      {
        section_slug: "trip-notes",
        heading: "",
        body_md: null,
        position: 1,
      },
    ]);

    expect(out).toBe("## Trip Notes");
  });
});
