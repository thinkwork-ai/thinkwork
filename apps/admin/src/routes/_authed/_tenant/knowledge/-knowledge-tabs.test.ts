import { describe, expect, it } from "vitest";
import { currentKnowledgeTab } from "../knowledge";

describe("currentKnowledgeTab", () => {
  it("selects memory for the root and memory tab", () => {
    expect(currentKnowledgeTab("/knowledge")).toBe("memory");
    expect(currentKnowledgeTab("/knowledge/memory")).toBe("memory");
  });

  it("selects the matching child tab", () => {
    expect(currentKnowledgeTab("/knowledge/wiki")).toBe("wiki");
    expect(currentKnowledgeTab("/knowledge/knowledge-bases")).toBe(
      "knowledge-bases",
    );
    expect(currentKnowledgeTab("/knowledge/context-engine")).toBe(
      "context-engine",
    );
  });
});
