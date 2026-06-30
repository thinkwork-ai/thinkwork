import { describe, expect, it } from "vitest";
import {
  PAGE_TYPES,
  PAGE_TYPE_LABELS,
  PAGE_TYPE_BADGE_CLASSES,
  PAGE_TYPE_BORDER_CLASSES,
  PAGE_TYPE_FORCE_COLORS,
  PAGE_TYPE_DEFAULT_FORCE_COLOR,
  pageTypeLabel,
} from "./wiki-palette.js";

describe("wiki palette constants", () => {
  it("defines three page types in the canonical order", () => {
    expect(PAGE_TYPES).toEqual(["ENTITY", "TOPIC", "DECISION"]);
  });

  it("has a label for each page type", () => {
    for (const pageType of PAGE_TYPES) {
      expect(PAGE_TYPE_LABELS[pageType]).toBeTruthy();
    }
  });

  it("has badge classes for each page type", () => {
    for (const pageType of PAGE_TYPES) {
      expect(PAGE_TYPE_BADGE_CLASSES[pageType]).toBeTruthy();
    }
  });

  it("has border classes for each page type", () => {
    for (const pageType of PAGE_TYPES) {
      expect(PAGE_TYPE_BORDER_CLASSES[pageType]).toBeTruthy();
    }
  });

  it("has force colors (hex) for each page type", () => {
    for (const pageType of PAGE_TYPES) {
      expect(PAGE_TYPE_FORCE_COLORS[pageType]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("defines a default force color", () => {
    expect(PAGE_TYPE_DEFAULT_FORCE_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("pageTypeLabel", () => {
  it("returns the human-readable label for known page types", () => {
    expect(pageTypeLabel("ENTITY")).toBe("Entity");
    expect(pageTypeLabel("TOPIC")).toBe("Topic");
    expect(pageTypeLabel("DECISION")).toBe("Decision");
  });

  it("returns 'Page' for null or undefined", () => {
    expect(pageTypeLabel(null)).toBe("Page");
    expect(pageTypeLabel(undefined)).toBe("Page");
  });

  it("returns the raw string for unknown page types", () => {
    expect(pageTypeLabel("CUSTOM")).toBe("CUSTOM");
  });

  it("returns 'Page' for empty string", () => {
    expect(pageTypeLabel("")).toBe("Page");
  });
});
