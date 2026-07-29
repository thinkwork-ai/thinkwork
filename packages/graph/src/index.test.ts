import { describe, it, expect } from "vitest";
import { deriveGraphClassification } from "./index.js";

describe("@thinkwork/graph public API", () => {
  it("re-exports the shared graph classification helpers", () => {
    const classification = deriveGraphClassification(new Set(["a"]), [
      { source: "a", target: "b" },
    ]);
    expect(classification?.neighborIds.has("b")).toBe(true);
    expect(classification?.neighborIds.has("orphan")).toBe(false);
  });
});
