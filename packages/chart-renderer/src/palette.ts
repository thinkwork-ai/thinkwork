/**
 * Resolved chart colors. The document/plate path renders into an HTML page
 * that already declares the house custom properties, so its palette is the
 * CSS-variable references. Native clients (React Native SVG) cannot resolve
 * `var(--x)`, so they pass the resolved house hexes instead.
 */
export interface ChartPalette {
  ink: string;
  muted: string;
  accent: string;
  line: string;
  card: string;
  info: string;
  warn: string;
  bad: string;
}

/** Default: CSS custom-property references — the document/plate path. */
export const CSS_VAR_PALETTE: ChartPalette = {
  ink: "var(--ink)",
  muted: "var(--muted)",
  accent: "var(--accent)",
  line: "var(--line)",
  card: "var(--card)",
  info: "var(--info)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

/** House light palette — same hexes as the plate template's `:root` block. */
export const HOUSE_LIGHT: ChartPalette = {
  ink: "#1e2126",
  muted: "#5c6470",
  accent: "#0f6b5c",
  line: "#e3ded6",
  card: "#ffffff",
  info: "#2b5aa0",
  warn: "#9a5b00",
  bad: "#a03030",
};

/** House dark palette — same hexes as the plate template's dark block. */
export const HOUSE_DARK: ChartPalette = {
  ink: "#e6e3dd",
  muted: "#9aa2ad",
  accent: "#4cc2ab",
  line: "#2c3037",
  card: "#1d2025",
  info: "#7aa7e0",
  warn: "#e0a44a",
  bad: "#e08585",
};
