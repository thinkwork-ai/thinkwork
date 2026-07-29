import { describe, it, expect } from "vitest";
import {
  MemoryGraph,
  MemoryGraphQuery,
  deriveGraphClassification,
  MEMORY_COLOR,
  ENTITY_COLOR,
  MEMORY_TYPE_COLORS,
} from "./index.js";

describe("@thinkwork/graph public API", () => {
  it("exports the ForceGraph components", () => {
    expect(MemoryGraph).toBeDefined();
  });

  it("exports gql query documents with the right operation names", () => {
    const memOp = (MemoryGraphQuery as any).definitions[0];
    expect(memOp.operation).toBe("query");
    expect(memOp.name.value).toBe("MemoryGraph");
  });

  it("exposes the memory palette", () => {
    expect(MEMORY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ENTITY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(MEMORY_TYPE_COLORS).length).toBeGreaterThan(0);
  });

  it("re-exports the shared graph classification helpers", () => {
    const classification = deriveGraphClassification(new Set(["a"]), [
      { source: "a", target: "b" },
    ]);
    expect(classification?.neighborIds.has("b")).toBe(true);
    expect(classification?.neighborIds.has("orphan")).toBe(false);
  });
});
