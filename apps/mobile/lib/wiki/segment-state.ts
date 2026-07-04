export type WikiSegmentViewMode = "list" | "graph";

export interface WikiSegmentState {
  viewMode: WikiSegmentViewMode;
  searchQuery: string;
}

export function setWikiSegmentViewMode(
  state: WikiSegmentState,
  viewMode: WikiSegmentViewMode,
): WikiSegmentState {
  return { ...state, viewMode };
}

export function setWikiSegmentSearchQuery(
  state: WikiSegmentState,
  searchQuery: string,
): WikiSegmentState {
  return { ...state, searchQuery };
}
