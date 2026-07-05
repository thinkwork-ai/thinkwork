import { describe, expect, it } from "vitest";
import { resolveSourceRows, shouldShowSourcesAffordance } from "./source-rows";

describe("wiki source rows", () => {
  it("keeps one row per source id and marks missing records unavailable", () => {
    expect(
      resolveSourceRows(
        ["mem-1", "purged", "mem-2"],
        [
          {
            memoryRecordId: "mem-2",
            content: { text: "Second source" },
            createdAt: "2026-07-04T12:00:00.000Z",
          },
          {
            memoryRecordId: "mem-1",
            content: { text: "First source" },
            createdAt: "2026-07-04T11:00:00.000Z",
          },
        ],
      ),
    ).toEqual([
      {
        kind: "resolved",
        id: "mem-1",
        record: expect.objectContaining({ memoryRecordId: "mem-1" }),
      },
      { kind: "unavailable", id: "purged" },
      {
        kind: "resolved",
        id: "mem-2",
        record: expect.objectContaining({ memoryRecordId: "mem-2" }),
      },
    ]);
  });

  it("hides the sources affordance for zero or absent source counts", () => {
    expect(shouldShowSourcesAffordance(0)).toBe(false);
    expect(shouldShowSourcesAffordance(null)).toBe(false);
    expect(shouldShowSourcesAffordance(undefined)).toBe(false);
    expect(shouldShowSourcesAffordance(1)).toBe(true);
  });
});
