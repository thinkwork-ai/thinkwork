/**
 * Inline analytics card for a `data-chart` message part (THINK-686).
 *
 * The SVG comes from the shared house renderer (`@thinkwork/chart-renderer`),
 * the same one mobile's `ChartCard` and the document plate path use, so every
 * surface draws identical marks. The palette must be the resolved house hexes
 * — `CSS_VAR_PALETTE` references `--ink`/`--line`/`--info`/`--warn`/`--bad`,
 * which the web theme (`packages/ui/src/theme.css`) does not define, and the
 * tokens it does define (`--muted`, `--accent`) carry shadcn surface semantics
 * rather than the ink/accent roles the renderer expects.
 *
 * The renderer escapes every model-authored string (see its security tests),
 * so its output is safe to inject via `dangerouslySetInnerHTML`.
 */

import { useMemo, useState } from "react";
import {
  chartNarration,
  renderChart,
  HOUSE_DARK,
  HOUSE_LIGHT,
  type ChartDirectiveData,
  type ChartMessagePart,
} from "@thinkwork/chart-renderer";
import { useTheme } from "@thinkwork/ui";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Logical frame width handed to the renderer. The emitted SVG carries only a
 * `viewBox`, so the card scales it responsively with `w-full h-auto` — the
 * number sets the mark proportions, not the rendered size.
 */
const FRAME_WIDTH = 640;

export interface ChartTableRow {
  label: string;
  value: string;
}

/** Mirrors the renderer's `fmt`: grouped integers, ≤2 decimals. */
export function formatChartValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded =
    Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  const [int, frac] = String(rounded).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Rows for the card's collapsible "Chart data" table. */
export function chartTableRows(data: ChartDirectiveData): ChartTableRow[] {
  return data.series.map((point) => ({
    label: point.label,
    value: formatChartValue(point.value),
  }));
}

export interface ChartCardProps {
  part: ChartMessagePart;
}

export function ChartCard({ part }: ChartCardProps) {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const [dataExpanded, setDataExpanded] = useState(false);

  const data = part.data;

  const svg = useMemo(
    () =>
      renderChart(data, {
        width: FRAME_WIDTH,
        palette: isDark ? HOUSE_DARK : HOUSE_LIGHT,
        // The card owns the title/qualifier header; the SVG renders marks only.
        header: false,
      }),
    [data, isDark],
  );
  const rows = useMemo(() => chartTableRows(data), [data]);
  const narration = useMemo(() => chartNarration(data), [data]);

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-testid="chart-card"
    >
      <div className="px-4 pt-3 pb-2">
        <div className="text-base font-semibold text-foreground">
          {data.title}
        </div>
        {data.qualifier ? (
          <div className="mt-0.5 text-sm text-muted-foreground">
            {data.qualifier}
          </div>
        ) : null}
      </div>

      {/* role="img" + the narration sentence makes the mark area a single
          accessible object; the data table below is the readable fallback. */}
      <div
        role="img"
        aria-label={narration}
        className="px-3 [&>svg]:h-auto [&>svg]:w-full [&>svg]:max-w-full"
        data-testid="chart-card-svg"
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {data.caption ? (
        <div className="px-4 pt-2 text-sm text-foreground">{data.caption}</div>
      ) : null}

      <div className="mt-3 border-t border-border">
        <button
          type="button"
          aria-expanded={dataExpanded}
          onClick={() => setDataExpanded((open) => !open)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Chart data
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              dataExpanded && "rotate-180",
            )}
          />
        </button>
        {dataExpanded ? (
          <table className="w-full border-t border-border text-sm">
            <caption className="sr-only">{data.title}</caption>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={`${row.label}-${index}`}
                  className={cn(
                    index === rows.length - 1
                      ? ""
                      : "border-b border-border/60",
                  )}
                >
                  <th
                    scope="row"
                    className="px-4 py-2 text-left font-normal text-muted-foreground"
                  >
                    {row.label}
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums text-foreground">
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
