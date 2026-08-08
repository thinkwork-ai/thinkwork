import React, { useCallback, useMemo, useState } from "react";
import {
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { X } from "lucide-react-native";
import { SvgXml } from "react-native-svg";
import { Circle, matchFont, Rect } from "@shopify/react-native-skia";
import { useAnimatedReaction, runOnJS } from "react-native-reanimated";
import {
  Bar,
  CartesianChart,
  Line,
  Pie,
  PolarChart,
  useChartPressState,
} from "victory-native";
import {
  chartNarration,
  HOUSE_DARK,
  HOUSE_LIGHT,
  renderChart,
  validateChartMessagePart,
  type ChartDirectiveData,
  type ChartMessagePart,
} from "@thinkwork/chart-renderer";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import {
  chartTableRows,
  formatChartValue,
  svgViewBoxSize,
} from "@/lib/chart-parts";
import {
  inspectorKindFor,
  toCartesianData,
  toPieData,
  type PieSlice,
} from "@/lib/chart-inspector";

/**
 * Interactive chart inspector (THINK-683).
 *
 * Presented as a modal from `ChartCard`'s tap target. It is fed the *same*
 * `ChartMessagePart` the inline card already rendered — serialized through the
 * router param, re-validated here — so there is never a second payload or a
 * second fetch.
 *
 * bar / line / sparkline / donut get a real Victory Native XL (Skia) chart with
 * scrub-to-inspect. The kinds VNXL has no equivalent for (funnel, meter,
 * stat-strip) get the house SVG enlarged to sheet width with the data table
 * always open — an honest detail view rather than a forced re-shape.
 */

/**
 * Axis label font. The app bundles no font files, so match a system face
 * rather than `useFont(require(...))`. Resolved lazily and cached — calling
 * into Skia at module scope would run on import of the route, before the
 * native module is guaranteed ready.
 */
let axisFont: ReturnType<typeof matchFont> | null = null;
function getAxisFont() {
  if (!axisFont) {
    axisFont = matchFont({
      fontFamily: Platform.select({ ios: "Helvetica", default: "sans-serif" }),
      fontSize: 12,
    });
  }
  return axisFont;
}

function clampedFontScale(): number {
  const scale = PixelRatio.getFontScale();
  if (!Number.isFinite(scale)) return 1;
  return Math.min(1.6, Math.max(1, scale));
}

export default function ChartInspectorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const params = useLocalSearchParams<{ part?: string | string[] }>();

  const part = useMemo(() => parsePartParam(params.part), [params.part]);

  return (
    <View
      className="flex-1 bg-white dark:bg-neutral-900"
      style={{ paddingTop: 8, paddingBottom: insets.bottom }}
    >
      {/* Grab-handle affordance — the sheet is dismissible by the OS gesture. */}
      <View className="items-center pb-2">
        <View className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
      </View>

      {part ? (
        <InspectorBody data={part.data} isDark={isDark} onClose={router.back} />
      ) : (
        <View className="flex-1 px-6 pt-10">
          <View className="flex-row items-start justify-between">
            <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 flex-1 pr-3">
              This chart can&apos;t be opened
            </Text>
            <CloseButton onPress={router.back} color={colors.mutedForeground} />
          </View>
          <Text size="sm" variant="muted" className="mt-2">
            The chart data didn&apos;t survive the hand-off. Close this sheet —
            the chart in the conversation is still readable.
          </Text>
        </View>
      )}
    </View>
  );
}

/** Router params arrive as `string | string[]`; take the first entry. */
function parsePartParam(
  raw: string | string[] | undefined,
): ChartMessagePart | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    return validateChartMessagePart(JSON.parse(value));
  } catch {
    return null;
  }
}

function CloseButton({
  onPress,
  color,
}: {
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Close chart"
      className="p-1 -mr-1"
    >
      <X size={22} color={color} />
    </Pressable>
  );
}

function InspectorBody({
  data,
  isDark,
  onClose,
}: {
  data: ChartDirectiveData;
  isDark: boolean;
  onClose: () => void;
}) {
  const colors = isDark ? COLORS.dark : COLORS.light;
  const palette = isDark ? HOUSE_DARK : HOUSE_LIGHT;
  const kind = inspectorKindFor(data.type);
  const narration = useMemo(() => chartNarration(data), [data]);
  const rows = useMemo(() => chartTableRows(data), [data]);
  const { height } = useWindowDimensions();
  // ~60% of the viewport for the interactive area, bounded so a small phone
  // still shows the caption and a table row or two below the fold line.
  const chartHeight = Math.max(220, Math.min(420, Math.round(height * 0.6)));

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="px-5 pb-2 flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {data.title}
          </Text>
          {data.qualifier ? (
            <Text size="sm" variant="muted" className="mt-0.5">
              {data.qualifier}
            </Text>
          ) : null}
        </View>
        <CloseButton onPress={onClose} color={colors.mutedForeground} />
      </View>

      {kind === "svg-detail" ? (
        <SvgDetail data={data} isDark={isDark} />
      ) : kind === "polar-pie" ? (
        <PieInspector
          data={data}
          palette={palette}
          height={chartHeight}
          narration={narration}
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
        />
      ) : (
        <CartesianInspector
          data={data}
          kind={kind}
          palette={palette}
          height={chartHeight}
          narration={narration}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
        />
      )}

      {data.caption ? (
        <Text
          size="sm"
          className="px-5 pt-3 text-neutral-900 dark:text-neutral-100"
        >
          {data.caption}
        </Text>
      ) : null}

      <View className="mt-4 border-t border-neutral-200 dark:border-neutral-800">
        <View className="px-5 pt-3">
          <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
            Chart data
          </Text>
        </View>
        <View className="px-5 pb-2">
          {rows.map((row, index) => {
            const selected = index === activeIndex;
            return (
              <Pressable
                key={`${row.label}-${index}`}
                onPress={() => setActiveIndex(selected ? null : index)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${row.label}, ${row.value}`}
                className={`flex-row items-center justify-between py-2 pl-2 border-l-2 ${
                  selected ? "border-l-sky-500" : "border-l-transparent"
                } ${
                  index === rows.length - 1
                    ? ""
                    : "border-b border-b-neutral-100 dark:border-b-neutral-800"
                }`}
              >
                <Text
                  size="sm"
                  variant={selected ? "default" : "muted"}
                  className={`flex-1 pr-3 ${selected ? "font-semibold" : ""}`}
                >
                  {row.label}
                </Text>
                <Text
                  size="sm"
                  className={`text-neutral-900 dark:text-neutral-100 tabular-nums text-right ${
                    selected ? "font-semibold" : ""
                  }`}
                >
                  {row.value}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

/** Scrub readout above the chart — label + value for the active mark. */
function Readout({
  label,
  value,
  hint,
}: {
  label: string | null;
  value: string | null;
  hint: string;
}) {
  return (
    <View className="px-5 pb-2 flex-row items-baseline justify-between min-h-[24px]">
      {label ? (
        <>
          <Text size="sm" variant="muted" className="flex-1 pr-3">
            {label}
          </Text>
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
            {value}
          </Text>
        </>
      ) : (
        <Text size="xs" variant="muted">
          {hint}
        </Text>
      )}
    </View>
  );
}

function CartesianInspector({
  data,
  kind,
  palette,
  height,
  narration,
  activeIndex,
  onActiveIndexChange,
}: {
  data: ChartDirectiveData;
  kind: "cartesian-bar" | "cartesian-line";
  palette: typeof HOUSE_DARK;
  height: number;
  narration: string;
  activeIndex: number | null;
  onActiveIndexChange: (index: number | null) => void;
}) {
  const rows = useMemo(() => toCartesianData(data), [data]);
  const font = useMemo(() => getAxisFont(), []);
  const { state, isActive } = useChartPressState({ x: 0, y: { y: 0 } });

  // The press state lives on the UI thread; mirror the matched index back to JS
  // so the readout and the data table (plain RN Text) can react to the scrub.
  const publish = useCallback(
    (index: number | null) => onActiveIndexChange(index),
    [onActiveIndexChange],
  );
  useAnimatedReaction(
    () => (state.isActive.value ? state.matchedIndex.value : -1),
    (next, previous) => {
      if (next === previous) return;
      runOnJS(publish)(next >= 0 ? next : null);
    },
    [publish],
  );

  const active = activeIndex != null ? rows[activeIndex] : undefined;

  return (
    <View>
      <Readout
        label={active?.label ?? null}
        value={active ? formatChartValue(active.y) : null}
        hint="Touch and drag across the chart to inspect a point"
      />
      <View
        style={{ height }}
        className="px-3"
        accessibilityRole="image"
        accessibilityLabel={narration}
      >
        <CartesianChart
          data={rows}
          xKey="x"
          yKeys={["y"]}
          chartPressState={state}
          domainPadding={{ left: 24, right: 24, top: 24 }}
          padding={{ bottom: 4 }}
          xAxis={{
            font,
            labelColor: palette.muted,
            lineColor: palette.line,
            tickCount: Math.min(rows.length, 6),
            formatXLabel: (value: number) => rows[value]?.label ?? "",
          }}
          yAxis={[
            {
              font,
              labelColor: palette.muted,
              lineColor: palette.line,
              formatYLabel: (value: number) => formatChartValue(value),
            },
          ]}
        >
          {({ points, chartBounds }) => (
            <>
              {activeIndex != null && points.y[activeIndex] ? (
                <ActiveColumn
                  centerX={points.y[activeIndex]!.x}
                  firstX={points.y[0]?.x ?? 0}
                  secondX={points.y[1]?.x}
                  bounds={chartBounds}
                  color={palette.line}
                />
              ) : null}
              {kind === "cartesian-bar" ? (
                <Bar
                  points={points.y}
                  chartBounds={chartBounds}
                  color={palette.accent}
                  roundedCorners={{ topLeft: 6, topRight: 6 }}
                />
              ) : (
                <Line
                  points={points.y}
                  color={palette.accent}
                  strokeWidth={2.5}
                  curveType="linear"
                />
              )}
              {kind === "cartesian-line" &&
              isActive &&
              activeIndex != null &&
              points.y[activeIndex]?.y != null ? (
                <Circle
                  cx={points.y[activeIndex]!.x}
                  cy={points.y[activeIndex]!.y as number}
                  r={6}
                  color={palette.accent}
                />
              ) : null}
            </>
          )}
        </CartesianChart>
      </View>
    </View>
  );
}

/** Translucent full-height band behind the scrubbed mark. */
function ActiveColumn({
  centerX,
  firstX,
  secondX,
  bounds,
  color,
}: {
  centerX: number;
  firstX: number;
  secondX: number | undefined;
  bounds: { left: number; right: number; top: number; bottom: number };
  color: string;
}) {
  const step =
    secondX != null && secondX !== firstX
      ? Math.abs(secondX - firstX)
      : bounds.right - bounds.left;
  const width = Math.max(8, step * 0.7);
  return (
    <Rect
      x={centerX - width / 2}
      y={bounds.top}
      width={width}
      height={Math.max(0, bounds.bottom - bounds.top)}
      color={color}
      opacity={0.55}
    />
  );
}

function PieInspector({
  data,
  palette,
  height,
  narration,
  activeIndex,
  onSelect,
}: {
  data: ChartDirectiveData;
  palette: typeof HOUSE_DARK;
  height: number;
  narration: string;
  activeIndex: number | null;
  onSelect: (index: number | null) => void;
}) {
  const slices = useMemo(() => toPieData(data, palette), [data, palette]);
  const active = activeIndex != null ? slices[activeIndex] : undefined;

  return (
    <View>
      <Readout
        label={active ? active.label : null}
        value={
          active ? `${formatChartValue(active.value)} · ${active.share}%` : null
        }
        hint="Tap a slice's row below to highlight it"
      />
      <View
        style={{ height: Math.round(height * 0.62) }}
        className="px-3"
        accessibilityRole="image"
        accessibilityLabel={narration}
      >
        <PolarChart
          data={slices}
          labelKey="label"
          valueKey="value"
          colorKey="color"
        >
          <Pie.Chart innerRadius="55%">
            {({ slice }) => (
              <Pie.Slice
                opacity={
                  activeIndex == null || slice.label === active?.label ? 1 : 0.3
                }
              />
            )}
          </Pie.Chart>
        </PolarChart>
      </View>
      <View className="px-5 pt-2">
        {slices.map((slice, index) => (
          <PieLegendRow
            key={`${slice.label}-${index}`}
            slice={slice}
            selected={index === activeIndex}
            onPress={() => onSelect(index === activeIndex ? null : index)}
          />
        ))}
      </View>
    </View>
  );
}

function PieLegendRow({
  slice,
  selected,
  onPress,
}: {
  slice: PieSlice;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${slice.label}, ${formatChartValue(slice.value)}, ${slice.share} percent of total`}
      className="flex-row items-center py-2"
    >
      <View
        style={{ backgroundColor: slice.color }}
        className="h-3 w-3 rounded-sm mr-3"
      />
      <Text
        size="sm"
        variant={selected ? "default" : "muted"}
        className={`flex-1 pr-3 ${selected ? "font-semibold" : ""}`}
      >
        {slice.label}
      </Text>
      <Text
        size="sm"
        className={`text-neutral-900 dark:text-neutral-100 tabular-nums ${
          selected ? "font-semibold" : ""
        }`}
      >
        {formatChartValue(slice.value)} · {slice.share}%
      </Text>
    </Pressable>
  );
}

/**
 * funnel / meter / stat-strip: no VNXL equivalent, so draw the house SVG at
 * sheet width. Interaction lives in the always-open data table below.
 */
function SvgDetail({
  data,
  isDark,
}: {
  data: ChartDirectiveData;
  isDark: boolean;
}) {
  const [width, setWidth] = useState(0);
  const fontScale = clampedFontScale();
  const svg = useMemo(() => {
    if (width <= 0) return null;
    return renderChart(data, {
      width,
      fontScale,
      palette: isDark ? HOUSE_DARK : HOUSE_LIGHT,
      header: false,
    });
  }, [data, width, fontScale, isDark]);
  const size = useMemo(() => (svg ? svgViewBoxSize(svg) : null), [svg]);
  const narration = useMemo(() => chartNarration(data), [data]);

  return (
    <View className="px-3">
      <View
        onLayout={(event) => {
          const next = Math.floor(event.nativeEvent.layout.width);
          if (next > 0 && next !== width) setWidth(next);
        }}
        accessibilityRole="image"
        accessibilityLabel={narration}
      >
        {svg && size ? (
          <SvgXml xml={svg} width={size.width} height={size.height} />
        ) : null}
      </View>
    </View>
  );
}
