/**
 * Color palette for the Hindsight memory force-graph. Memory nodes are pink,
 * untyped entity nodes are sky blue, and typed entity nodes use TYPE_COLORS
 * keyed off the Hindsight ontology label.
 */

export const MEMORY_COLOR = "#e879a0";
export const ENTITY_COLOR = "#7dd3fc";
export const AGENT_COLOR = "#34d399";

/** Ontology entity-type → hex color mapping for ForceGraph3D sphere materials. */
export const MEMORY_TYPE_COLORS: Record<string, string> = {
  Person: "#34d399", // green
  Company: "#60a5fa", // blue
  Org: "#60a5fa", // blue
  Location: "#fbbf24", // amber
  Restaurant: "#f97316", // orange
  Product: "#a78bfa", // purple
  Software: "#a78bfa", // purple
  System: "#a78bfa", // purple
  Event: "#f472b6", // pink
  Decision: "#fb923c", // orange
  Concept: "#94a3b8", // slate
  Document: "#67e8f9", // cyan
  Project: "#4ade80", // lime
  BusinessConcept: "#94a3b8", // slate
  Tool: "#a78bfa", // purple
};
