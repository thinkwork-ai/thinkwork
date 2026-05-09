import { describe, it, expect } from "vitest";
import {
  MemoryGraph,
  WikiGraph,
  MemoryGraphQuery,
  WikiGraphQuery,
  MEMORY_COLOR,
  ENTITY_COLOR,
  MEMORY_TYPE_COLORS,
  PAGE_TYPES,
  PAGE_TYPE_LABELS,
  PAGE_TYPE_FORCE_COLORS,
  pageTypeLabel,
} from "./index.js";

describe("@thinkwork/graph public API", () => {
  it("exports the two ForceGraph components", () => {
    expect(MemoryGraph).toBeDefined();
    expect(WikiGraph).toBeDefined();
  });

  it("exports gql query documents with the right operation names", () => {
    const memOp = (MemoryGraphQuery as any).definitions[0];
    const wikiOp = (WikiGraphQuery as any).definitions[0];
    expect(memOp.operation).toBe("query");
    expect(memOp.name.value).toBe("MemoryGraph");
    expect(wikiOp.operation).toBe("query");
    expect(wikiOp.name.value).toBe("WikiGraph");
  });

  it("exposes the memory palette", () => {
    expect(MEMORY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ENTITY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(MEMORY_TYPE_COLORS).length).toBeGreaterThan(0);
  });

  it("exposes the wiki palette with three page types", () => {
    expect(PAGE_TYPES).toEqual(["ENTITY", "TOPIC", "DECISION"]);
    expect(PAGE_TYPE_LABELS.ENTITY).toBe("Entity");
    expect(PAGE_TYPE_FORCE_COLORS.DECISION).toMatch(/^#[0-9a-f]{6}$/i);
    expect(pageTypeLabel("TOPIC")).toBe("Topic");
    expect(pageTypeLabel(undefined)).toBe("Page");
  });
});
