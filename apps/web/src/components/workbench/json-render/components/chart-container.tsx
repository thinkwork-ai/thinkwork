import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@thinkwork/ui";

/**
 * GenUI chart palette. The strict validator forbids free-form color/fill/stroke
 * props, so a chart series references a palette token via `colorKey` (an enum,
 * NOT a raw color string). This module is the single place that maps a token to
 * a concrete themed color; nothing downstream ever sees a caller-supplied color.
 *
 * The look is a blue-scale ramp (with two cyan accents for separation) tuned for
 * both light and dark themes — `ChartContainer`/`ChartStyle` inject one
 * `--color-<dataKey>: <themed color>` CSS var per series and the recharts marks
 * read `var(--color-<dataKey>)`.
 */
export const CHART_COLOR_KEYS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
] as const;

export type ChartColorKey = (typeof CHART_COLOR_KEYS)[number];

const CHART_PALETTE: Record<ChartColorKey, { light: string; dark: string }> = {
  "chart-1": { light: "hsl(217, 91%, 60%)", dark: "hsl(213, 94%, 68%)" },
  "chart-2": { light: "hsl(221, 83%, 53%)", dark: "hsl(217, 91%, 60%)" },
  "chart-3": { light: "hsl(224, 76%, 48%)", dark: "hsl(221, 83%, 63%)" },
  "chart-4": { light: "hsl(226, 71%, 40%)", dark: "hsl(224, 76%, 58%)" },
  "chart-5": { light: "hsl(199, 89%, 48%)", dark: "hsl(199, 89%, 60%)" },
  "chart-6": { light: "hsl(188, 86%, 40%)", dark: "hsl(187, 85%, 53%)" },
};

const DEFAULT_COLOR_KEY: ChartColorKey = "chart-1";

export interface ChartSeries {
  dataKey: string;
  label?: string | null;
  colorKey: ChartColorKey;
}

export function chartColorVar(dataKey: string): string {
  return `var(--color-${dataKey})`;
}

/**
 * Build a shadcn `ChartConfig` keyed by each series' `dataKey`, resolving its
 * palette token to a themed color. Guards against a missing/invalid token so a
 * partial or malformed frame never throws.
 */
export function buildChartConfig(series: ChartSeries[]): ChartConfig {
  const config: ChartConfig = {};
  for (const item of series) {
    if (!item || typeof item.dataKey !== "string" || !item.dataKey) continue;
    const palette =
      CHART_PALETTE[item.colorKey] ?? CHART_PALETTE[DEFAULT_COLOR_KEY];
    config[item.dataKey] = {
      label: item.label ?? item.dataKey,
      theme: { light: palette.light, dark: palette.dark },
    };
  }
  return config;
}

/**
 * Config entries for the raw palette tokens (`chart-1`..`chart-N`), used by pie
 * charts where each slice is colored by position rather than by a named series.
 * Injecting these makes `--color-chart-N` CSS vars available for `<Cell fill>`.
 */
export function buildPaletteConfig(count: number): ChartConfig {
  const config: ChartConfig = {};
  const limit = Math.min(Math.max(count, 0), CHART_COLOR_KEYS.length);
  for (let index = 0; index < limit; index += 1) {
    const key = CHART_COLOR_KEYS[index]!;
    const palette = CHART_PALETTE[key];
    config[key] = {
      label: key,
      theme: { light: palette.light, dark: palette.dark },
    };
  }
  return config;
}

export {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
};
