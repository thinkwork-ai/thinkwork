import { describe, expect, it } from "vitest";
import {
  assertionCount,
  evalStudioCategories,
  filterEvalStudioItems,
  type EvalStudioTestCaseRow,
} from "./index";

const rows: EvalStudioTestCaseRow[] = [
  {
    id: "1",
    name: "prompt injection",
    category: "red-team-prompt-injection",
    assertions: '[{"type":"llm-rubric"},{"type":"not-contains"}]',
    enabled: true,
    updatedAt: "2026-05-17T00:00:00.000Z",
  },
  {
    id: "2",
    name: "data boundary",
    category: " red-team-data-boundary ",
    assertions: "[]",
    enabled: true,
    updatedAt: "2026-05-17T00:00:00.000Z",
  },
  {
    id: "3",
    name: "uncategorized",
    category: "",
    assertions: "not-json",
    enabled: false,
    updatedAt: "2026-05-17T00:00:00.000Z",
  },
];

describe("Eval Studio filters", () => {
  it("derives sorted non-empty categories from test cases", () => {
    expect(evalStudioCategories(rows)).toEqual([
      "red-team-data-boundary",
      "red-team-prompt-injection",
    ]);
  });

  it("filters by selected category and keeps all rows when no category is selected", () => {
    expect(filterEvalStudioItems(rows, null).map((row) => row.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(
      filterEvalStudioItems(rows, "red-team-data-boundary").map(
        (row) => row.id,
      ),
    ).toEqual(["2"]);
  });

  it("counts valid assertion arrays and treats malformed assertions as empty", () => {
    expect(assertionCount(rows[0]?.assertions)).toBe(2);
    expect(assertionCount(rows[1]?.assertions)).toBe(0);
    expect(assertionCount(rows[2]?.assertions)).toBe(0);
  });
});
