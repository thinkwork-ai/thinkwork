import { describe, expect, it } from "vitest";
import {
  setWikiSegmentSearchQuery,
  setWikiSegmentViewMode,
  type WikiSegmentState,
} from "./segment-state";

describe("wiki segment state", () => {
  it("does not reset search when toggling view mode", () => {
    const state: WikiSegmentState = {
      viewMode: "list",
      searchQuery: "quarterly planning",
    };

    expect(setWikiSegmentViewMode(state, "graph")).toEqual({
      viewMode: "graph",
      searchQuery: "quarterly planning",
    });
  });

  it("does not reset view mode when search changes", () => {
    const state: WikiSegmentState = {
      viewMode: "graph",
      searchQuery: "",
    };

    expect(setWikiSegmentSearchQuery(state, "roadmap")).toEqual({
      viewMode: "graph",
      searchQuery: "roadmap",
    });
  });
});
