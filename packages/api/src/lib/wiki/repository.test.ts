import { describe, expect, it } from "vitest";

import { normalizeSectionHeading } from "./repository.js";

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
