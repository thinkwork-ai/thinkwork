/**
 * Camera scale bounds + a nominal disc radius for fit-padding.
 *
 * Node fill color and per-node radius are no longer decided here: the graph
 * now colors nodes by **Louvain community** and sizes them by **degree**,
 * both via `@thinkwork/graph-core` (shared with the web renderer). The old
 * color-by-entity-type palette was retired in THINK-235.
 */
export type ColorScheme = "light" | "dark";

/** Upper bound of `degreeRadius` (10 + 14) — used only to pad the fit
 *  bounds so the largest disc never clips at the viewport edge. */
export function getNodeRadius(): number {
  return 24;
}

export const SCALE_MIN = 0.2;
export const SCALE_MAX = 5;
