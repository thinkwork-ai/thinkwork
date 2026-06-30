import { describe, expect, it } from "vitest";
import {
  MEMORY_COLOR,
  ENTITY_COLOR,
  AGENT_COLOR,
  MEMORY_TYPE_COLORS,
} from "./memory-palette.js";

describe("memory palette constants", () => {
  it("defines MEMORY_COLOR as a valid hex color", () => {
    expect(MEMORY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("defines ENTITY_COLOR as a valid hex color", () => {
    expect(ENTITY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("defines AGENT_COLOR as a valid hex color", () => {
    expect(AGENT_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("maps ontology types to hex colors", () => {
    const expectedTypes = [
      "Person",
      "Company",
      "Org",
      "Location",
      "Restaurant",
      "Product",
      "Software",
      "System",
      "Event",
      "Decision",
      "Concept",
      "Document",
      "Project",
      "BusinessConcept",
      "Tool",
    ];
    for (const type of expectedTypes) {
      expect(MEMORY_TYPE_COLORS[type]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("uses the same color for related software types", () => {
    expect(MEMORY_TYPE_COLORS.Product).toBe(MEMORY_TYPE_COLORS.Software);
    expect(MEMORY_TYPE_COLORS.Software).toBe(MEMORY_TYPE_COLORS.System);
  });

  it("uses the same color for Company and Org", () => {
    expect(MEMORY_TYPE_COLORS.Company).toBe(MEMORY_TYPE_COLORS.Org);
  });
});
