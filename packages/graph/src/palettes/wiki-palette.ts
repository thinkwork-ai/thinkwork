/**
 * Canonical palette for compiled wiki pages. Single source of truth so the
 * Wiki list badge, the graph legend, and the force-graph sphere all show
 * the same color for the same page type.
 *
 * Entity → blue, Topic → purple, Decision → yellow (matches the existing
 * Hindsight "Summaries" badge tone so the family visual language stays
 * coherent).
 *
 * Originally defined at apps/admin/src/lib/wiki-palette.ts; moved here in
 * U2 of the apps/computer Memory port (plan
 * docs/plans/2026-05-09-003-feat-computer-memory-ui-port-plan.md) so admin
 * and computer share one palette.
 */

export type WikiPageType = "ENTITY" | "TOPIC" | "DECISION";

export const PAGE_TYPES: readonly WikiPageType[] = ["ENTITY", "TOPIC", "DECISION"];

export const PAGE_TYPE_LABELS: Record<WikiPageType, string> = {
  ENTITY: "Entity",
  TOPIC: "Topic",
  DECISION: "Decision",
};

/** Tailwind classes for filled badges (list Type column, sheet header). */
export const PAGE_TYPE_BADGE_CLASSES: Record<WikiPageType, string> = {
  ENTITY: "bg-blue-500/20 text-blue-400",
  TOPIC: "bg-purple-500/20 text-purple-400",
  DECISION: "bg-yellow-500/20 text-yellow-400",
};

/** Tailwind classes for outline badges (sheet "Connected pages" rows). */
export const PAGE_TYPE_BORDER_CLASSES: Record<WikiPageType, string> = {
  ENTITY: "border-blue-500/30 text-blue-400",
  TOPIC: "border-purple-500/30 text-purple-400",
  DECISION: "border-yellow-500/30 text-yellow-400",
};

/** Hex values for ForceGraph3D sphere materials and legend swatches. */
export const PAGE_TYPE_FORCE_COLORS: Record<WikiPageType, string> = {
  ENTITY: "#60a5fa", // blue-400
  TOPIC: "#a78bfa", // purple-400
  DECISION: "#facc15", // yellow-400
};

/** Fallback color when entityType is missing or not one of the three. */
export const PAGE_TYPE_DEFAULT_FORCE_COLOR = "#94a3b8"; // slate-400

export function pageTypeLabel(t: string | undefined | null): string {
  if (!t) return "Page";
  return PAGE_TYPE_LABELS[t as WikiPageType] ?? t;
}
