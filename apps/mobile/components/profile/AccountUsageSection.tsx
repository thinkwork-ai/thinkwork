/**
 * Mobile port of the web AccountUsageSection: stat tiles, a last-180-days
 * activity heatmap, and a per-model cost breakdown, all fed by the single
 * `accountUsage` query (same document shape as apps/web settings-queries).
 */
import { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import {
  Activity,
  CircleDollarSign,
  Cpu,
  Hash,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react-native";
import { Muted, Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useColorScheme } from "nativewind";
import { AccountUsageQuery } from "@/lib/graphql-queries";

const DEFAULT_DAYS = 180;

type UsageDay = {
  day: string;
  totalUsd: number;
  conversationUsd: number;
  systemUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheUsd: number;
  eventCount: number;
};

export function AccountUsageSection({
  tenantId,
  userId,
}: {
  tenantId: string | null;
  userId: string | null;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data, fetching }] = useQuery({
    query: AccountUsageQuery,
    variables: { tenantId: tenantId!, userId: userId!, days: DEFAULT_DAYS },
    pause: !tenantId || !userId,
    requestPolicy: "cache-and-network",
  });

  const usage = data?.accountUsage ?? null;
  const summary = usage?.summary ?? null;
  const daily = useMemo(
    () => ((usage?.daily ?? []) as UsageDay[]).filter(Boolean),
    [usage?.daily],
  );
  const models = useMemo(
    () =>
      [...((usage?.models ?? []) as any[])].sort(
        (a, b) => (b?.totalUsd ?? 0) - (a?.totalUsd ?? 0),
      ),
    [usage?.models],
  );

  const activeDays = useMemo(
    () => daily.filter((d) => (d.eventCount ?? 0) > 0).length,
    [daily],
  );
  const reviewUsd = (summary?.mismatchUsd ?? 0) + (summary?.unreconciledUsd ?? 0);
  const totalTokens =
    (summary?.inputTokens ?? 0) + (summary?.outputTokens ?? 0);

  if (!tenantId || !userId) return null;
  if (!fetching && !summary) return null;

  return (
    <View className="gap-6">
      <View className="gap-3">
        <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Account Usage
        </Text>
        <View className="flex-row flex-wrap gap-3">
          <StatTile
            icon={<CircleDollarSign size={15} color={colors.muted} />}
            label="Total"
            value={formatUsd(summary?.totalUsd ?? 0)}
            detail={
              (summary?.systemUsd ?? 0) > 0
                ? `Conversation ${formatUsd(summary?.conversationUsd ?? 0)} · Background ${formatUsd(summary?.systemUsd ?? 0)}`
                : undefined
            }
          />
          <StatTile
            icon={<ShieldCheck size={15} color={colors.muted} />}
            label="Verified"
            value={formatUsd(summary?.enforcedUsd ?? 0)}
          />
          <StatTile
            icon={<TriangleAlert size={15} color={colors.muted} />}
            label="Review"
            value={formatUsd(reviewUsd)}
          />
          <StatTile
            icon={<Hash size={15} color={colors.muted} />}
            label="Tokens"
            value={formatTokens(totalTokens)}
            detail={`${formatTokens(summary?.cachedReadTokens ?? 0)} cache read · ${formatTokens(summary?.cachedWriteTokens ?? 0)} cache write · ${formatUsd(summary?.cacheUsd ?? 0)}`}
          />
          <StatTile
            icon={<Activity size={15} color={colors.muted} />}
            label="Events"
            value={formatCount(summary?.eventCount ?? 0)}
          />
          <StatTile
            icon={<Cpu size={15} color={colors.muted} />}
            label="Days"
            value={String(activeDays)}
          />
        </View>
      </View>

      <View className="gap-3">
        <View className="flex-row items-baseline gap-2">
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Daily activity
          </Text>
          <Muted className="text-xs">Last {DEFAULT_DAYS} days</Muted>
        </View>
        <ActivityHeatmap daily={daily} periodEnd={usage?.periodEnd ?? null} />
      </View>

      {models.length > 0 && (
        <View className="gap-3">
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Model breakdown
          </Text>
          <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            {models.map((m: any, index: number) => (
              <View
                key={m.model ?? index}
                className={`px-4 py-3 gap-1 ${index > 0 ? "border-t border-neutral-200 dark:border-neutral-800" : ""}`}
              >
                <Text
                  className="text-sm font-medium text-neutral-900 dark:text-neutral-100"
                  numberOfLines={1}
                >
                  {m.displayName || shortenModelId(m.model ?? "")}
                </Text>
                <View className="flex-row items-center justify-between">
                  <Muted className="text-xs">
                    {formatTokens(
                      (m.inputTokens ?? 0) + (m.outputTokens ?? 0),
                    )}{" "}
                    tokens
                  </Muted>
                  <View className="flex-row items-center gap-3">
                    <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {formatUsd(m.totalUsd ?? 0)}
                    </Text>
                    <Muted className="text-xs">
                      {formatUsd(m.enforcedUsd ?? 0)}
                    </Muted>
                    <Muted className="text-xs w-9 text-right">
                      {Math.round((m.usageShare ?? 0) * 100)}%
                    </Muted>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <View
      className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 gap-1.5"
      style={{ flexBasis: "47%", flexGrow: 1 }}
    >
      <View className="flex-row items-center gap-1.5">
        {icon}
        <Muted className="text-xs">{label}</Muted>
      </View>
      <Text className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        {value}
      </Text>
      {detail ? <Muted className="text-xs leading-4">{detail}</Muted> : null}
    </View>
  );
}

// GitHub-style heatmap: columns are weeks, rows are weekdays. Mirrors the
// web's buildCalendarCells — dayCount cells ending at periodEnd with leading
// padding to align the first cell's weekday.
function ActivityHeatmap({
  daily,
  periodEnd,
}: {
  daily: UsageDay[];
  periodEnd: string | null;
}) {
  const { cells, maxUsd, maxEvents } = useMemo(() => {
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const endUtc = Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate(),
    );
    const out: Array<UsageDay | null | undefined> = [];
    const first = new Date(endUtc - (DEFAULT_DAYS - 1) * 86_400_000);
    // Leading padding so the first real cell lands on its weekday row.
    for (let i = 0; i < first.getUTCDay(); i++) out.push(undefined);
    for (let i = DEFAULT_DAYS - 1; i >= 0; i--) {
      const date = new Date(endUtc - i * 86_400_000);
      const key = date.toISOString().slice(0, 10);
      out.push(byDay.get(key) ?? null);
    }
    return {
      cells: out,
      maxUsd: Math.max(...daily.map((d) => d.totalUsd ?? 0), 0),
      maxEvents: Math.max(...daily.map((d) => d.eventCount ?? 0), 0),
    };
  }, [daily, periodEnd]);

  const columns: Array<Array<UsageDay | null | undefined>> = [];
  for (let i = 0; i < cells.length; i += 7) {
    columns.push(cells.slice(i, i + 7));
  }

  return (
    <View className="gap-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: "row", gap: 3 }}
      >
        {columns.map((column, columnIndex) => (
          <View key={columnIndex} style={{ gap: 3 }}>
            {column.map((cell, rowIndex) => (
              <View
                key={rowIndex}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  backgroundColor:
                    cell === undefined
                      ? "transparent"
                      : INTENSITY_COLORS[
                          getIntensity(cell, maxUsd, maxEvents)
                        ],
                }}
              />
            ))}
          </View>
        ))}
      </ScrollView>
      <View className="flex-row items-center gap-1.5">
        <Muted className="text-xs mr-1">Less</Muted>
        {INTENSITY_COLORS.map((color, index) => (
          <View
            key={index}
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              backgroundColor: color,
            }}
          />
        ))}
        <Muted className="text-xs ml-1">More</Muted>
      </View>
    </View>
  );
}

const INTENSITY_COLORS = [
  "#262626", // 0 — no activity (neutral-800)
  "#93b4f0",
  "#5b8def",
  "#3b6fe0",
  "#1d4ed8",
];

function getIntensity(
  cell: UsageDay | null,
  maxUsd: number,
  maxEvents: number,
): number {
  if (!cell || (cell.eventCount ?? 0) === 0) return 0;
  const scale =
    maxUsd > 0
      ? (cell.totalUsd ?? 0) / maxUsd
      : maxEvents > 0
        ? (cell.eventCount ?? 0) / maxEvents
        : 0;
  if (scale <= 0) return 1;
  return Math.min(4, Math.max(1, Math.ceil(scale * 4)));
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function shortenModelId(model: string): string {
  const tail = model.split("/").pop() ?? model;
  return tail.replace(/^(us|eu|apac)\./, "");
}
