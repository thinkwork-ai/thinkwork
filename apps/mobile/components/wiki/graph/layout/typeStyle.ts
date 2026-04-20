import { COLORS } from "@/lib/theme";
import type { WikiPageType } from "../types";

export type ColorScheme = "light" | "dark";

export function getNodeColor(
  pageType: WikiPageType,
  scheme: ColorScheme = "dark",
): string {
  const palette = COLORS[scheme];
  switch (pageType) {
    case "ENTITY":
      return palette.wikiEntity;
    case "TOPIC":
      return palette.wikiTopic;
    case "DECISION":
      return palette.wikiDecision;
  }
}

export function getEdgeColor(scheme: ColorScheme = "dark"): string {
  return COLORS[scheme].mutedForeground;
}

export function getNodeRadius(): number {
  return 14;
}

export const SCALE_MIN = 0.2;
export const SCALE_MAX = 5;
