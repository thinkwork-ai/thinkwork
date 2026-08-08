import { ScrollView, View } from "react-native";
import { useColorScheme } from "nativewind";
import { Moon, Sun } from "lucide-react-native";
import { Pressable } from "react-native";
import type { ChartMessagePart } from "@thinkwork/chart-renderer";
import { ChartCard } from "@/components/chat/ChartCard";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

/**
 * Dev-only fixture gallery for the inline analytics ChartCard (THINK-677).
 * Deep link: thinkwork:///dev-charts — renders the approved mockup funnel
 * first, then every house chart kind through the real card component. Not
 * linked from any navigation surface; same convention as demo.tsx.
 */

const FIXTURES: ChartMessagePart[] = [
  {
    type: "data-chart",
    id: "chart:mockup-funnel",
    data: {
      type: "funnel",
      title: "Deal Pipeline",
      qualifier: "open deals by stage",
      series: [
        { label: "Contacted", value: 12 },
        { label: "Qualified", value: 8 },
        { label: "Proposal", value: 5 },
        { label: "Negotiation", value: 4 },
        { label: "Won", value: 3 },
      ],
      caption: "Numo ($50k) is the highest-value deal in Negotiation",
    },
  },
  {
    type: "data-chart",
    id: "chart:bar",
    data: {
      type: "bar",
      title: "Deals created by month",
      qualifier: "count of new deals",
      series: [
        { label: "Mar", value: 14 },
        { label: "Apr", value: 22 },
        { label: "May", value: 18 },
        { label: "Jun", value: 31 },
        { label: "Jul", value: 27 },
        { label: "Aug", value: 9 },
      ],
      caption: "June was the strongest month for new pipeline.",
    },
  },
  {
    type: "data-chart",
    id: "chart:line",
    data: {
      type: "line",
      title: "Weekly active agents",
      qualifier: "unique agents per week",
      series: [
        { label: "W1", value: 42 },
        { label: "W2", value: 55 },
        { label: "W3", value: 51 },
        { label: "W4", value: 68 },
        { label: "W5", value: 74 },
        { label: "W6", value: 89 },
      ],
      caption: "Active agents have doubled in six weeks.",
    },
  },
  {
    type: "data-chart",
    id: "chart:donut",
    data: {
      type: "donut",
      title: "Deals by region",
      series: [
        { label: "West", value: 18 },
        { label: "East", value: 12 },
        { label: "Central", value: 8 },
        { label: "International", value: 4 },
      ],
      caption: "West accounts for the largest share of open deals.",
    },
  },
  {
    type: "data-chart",
    id: "chart:stat-strip",
    data: {
      type: "stat-strip",
      title: "Pipeline health",
      qualifier: "this quarter",
      series: [
        { label: "Open deals", value: 42 },
        { label: "Total value ($k)", value: 1280 },
        { label: "Avg days in stage", value: 11.5 },
        { label: "Win rate %", value: 24 },
      ],
    },
  },
  {
    type: "data-chart",
    id: "chart:sparkline",
    data: {
      type: "sparkline",
      title: "Daily messages",
      series: [
        { label: "Mon", value: 120 },
        { label: "Tue", value: 132 },
        { label: "Wed", value: 101 },
        { label: "Thu", value: 154 },
        { label: "Fri", value: 189 },
      ],
      caption: "Message volume peaked Friday.",
    },
  },
  {
    type: "data-chart",
    id: "chart:meter",
    data: {
      type: "meter",
      title: "Quarterly quota attainment",
      series: [{ label: "Attained", value: 820 }],
      max: 1000,
      caption: "82% to quota with three weeks left.",
    },
  },
];

export default function DevChartsScreen() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  return (
    <ScrollView
      className="flex-1 bg-neutral-50 dark:bg-black"
      contentContainerStyle={{ padding: 16, paddingTop: 72, paddingBottom: 48 }}
    >
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
          Chart fixtures
        </Text>
        <Pressable
          onPress={() => setColorScheme(isDark ? "light" : "dark")}
          className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800"
          accessibilityLabel="Toggle color scheme"
        >
          {isDark ? (
            <Sun size={18} color={colors.mutedForeground} />
          ) : (
            <Moon size={18} color={colors.mutedForeground} />
          )}
        </Pressable>
      </View>
      {FIXTURES.map((part) => (
        <View key={part.id} className="mb-4">
          <ChartCard part={part} />
        </View>
      ))}
    </ScrollView>
  );
}
