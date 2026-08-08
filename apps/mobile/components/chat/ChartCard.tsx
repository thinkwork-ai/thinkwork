import React, { useMemo, useState } from "react";
import { PixelRatio, Pressable, View } from "react-native";
import { useColorScheme } from "nativewind";
import { useRouter } from "expo-router";
import { ChevronDown, ChevronUp, Maximize2 } from "lucide-react-native";
import { SvgXml } from "react-native-svg";
import {
  chartFitsWidth,
  chartNarration,
  HOUSE_DARK,
  HOUSE_LIGHT,
  renderChart,
  type ChartMessagePart,
} from "@thinkwork/chart-renderer";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { chartTableRows, svgViewBoxSize } from "@/lib/chart-parts";

interface ChartCardProps {
  part: ChartMessagePart;
}

/** Keep the frame readable at large accessibility type without exploding it. */
function clampedFontScale(): number {
  const scale = PixelRatio.getFontScale();
  if (!Number.isFinite(scale)) return 1;
  return Math.min(1.6, Math.max(1, scale));
}

/**
 * Inline analytics card for a `data-chart` message part (THINK-677).
 *
 * The SVG comes from the shared house renderer (`@thinkwork/chart-renderer`)
 * so mobile, web, and the document plate path all draw the same marks. The
 * palette must be the resolved hexes — react-native-svg cannot resolve the
 * CSS `var()` references the document path uses.
 */
export function ChartCard({ part }: ChartCardProps) {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const [width, setWidth] = useState(0);
  const [dataExpandedState, setDataExpanded] = useState<boolean | null>(null);

  const data = part.data;
  const fontScale = clampedFontScale();

  // Takeaway-first degradation (THINK-678): a kind that can't survive this
  // width renders as caption + auto-expanded data table, not a squeezed mark.
  const fits = width <= 0 || chartFitsWidth(data, width);
  const dataExpanded = dataExpandedState ?? !fits;

  const svg = useMemo(() => {
    if (width <= 0 || !chartFitsWidth(data, width)) return null;
    return renderChart(data, {
      width,
      fontScale,
      palette: isDark ? HOUSE_DARK : HOUSE_LIGHT,
      // The card owns the title/qualifier header; the SVG renders marks only.
      header: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, fontScale, isDark]);

  const size = useMemo(() => (svg ? svgViewBoxSize(svg) : null), [svg]);
  const rows = useMemo(() => chartTableRows(data), [data]);
  const narration = useMemo(() => chartNarration(data), [data]);

  return (
    <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      <View className="px-4 pt-3 pb-2">
        <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {data.title}
        </Text>
        {data.qualifier ? (
          <Text size="sm" variant="muted" className="mt-0.5">
            {data.qualifier}
          </Text>
        ) : null}
      </View>

      {/* Tapping the chart body opens the interactive inspector (THINK-683).
          Only the mark area is a tap target — the "Chart data" disclosure and
          the caption keep their own behavior. */}
      <Pressable
        className="px-3"
        onPress={() =>
          router.push({
            pathname: "/chart-inspector",
            params: { part: JSON.stringify(part) },
          })
        }
        accessibilityRole="button"
        accessibilityLabel={narration}
        accessibilityHint="Opens interactive chart"
      >
        {/* Measure the unpadded inner box — handing the padded width to the
            renderer overflows the card and clips the right edge. */}
        <View
          onLayout={(event) => {
            const next = Math.floor(event.nativeEvent.layout.width);
            if (next > 0 && next !== width) setWidth(next);
          }}
        >
          {svg && size ? (
            <SvgXml xml={svg} width={size.width} height={size.height} />
          ) : null}
        </View>
        {/* Discoverability affordance — the tap itself is the interaction. */}
        <View className="absolute top-0 right-3" pointerEvents="none">
          <Maximize2 size={16} color={colors.mutedForeground} />
        </View>
      </Pressable>

      {data.caption ? (
        <Text
          size="sm"
          className="px-4 pt-2 text-neutral-900 dark:text-neutral-100"
        >
          {data.caption}
        </Text>
      ) : null}

      <View className="mt-3 border-t border-neutral-200 dark:border-neutral-800">
        <Pressable
          onPress={() => setDataExpanded(!dataExpanded)}
          className="flex-row items-center justify-between px-4 py-3"
        >
          <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
            Chart data
          </Text>
          {dataExpanded ? (
            <ChevronUp size={18} color={colors.mutedForeground} />
          ) : (
            <ChevronDown size={18} color={colors.mutedForeground} />
          )}
        </Pressable>
        {dataExpanded && (
          <View className="px-4 pb-2 border-t border-neutral-200 dark:border-neutral-800">
            {rows.map((row, index) => (
              <View
                key={`${row.label}-${index}`}
                className={`flex-row items-center justify-between py-2 ${
                  index === rows.length - 1
                    ? ""
                    : "border-b border-neutral-100 dark:border-neutral-800"
                }`}
              >
                <Text size="sm" variant="muted" className="flex-1 pr-3">
                  {row.label}
                </Text>
                <Text
                  size="sm"
                  className="text-neutral-900 dark:text-neutral-100 tabular-nums text-right"
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
