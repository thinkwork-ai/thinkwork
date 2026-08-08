// AUTO-GENERATED from packages/api DEFAULT_REGISTRY — do not edit; regenerate with pnpm --filter @thinkwork/api generate:directive-kinds

/** Directive kinds a plate may make available to documents. */
export const PLATE_DIRECTIVE_KINDS = [
  "stats",
  "verdict-grid",
  "chart",
  "timeline",
] as const;

export type PlateDirectiveKind = (typeof PLATE_DIRECTIVE_KINDS)[number];
