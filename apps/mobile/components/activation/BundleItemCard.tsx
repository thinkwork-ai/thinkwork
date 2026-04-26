import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Text, Muted } from "@/components/ui/typography";
import { EpistemicStateBadge } from "./EpistemicStateBadge";

export type BundleItem = {
  id: string;
  layer: string;
  title: string;
  summary: string;
  epistemicState?: string;
  target?: string;
};

export function BundleItemCard({
  item,
  action,
  onAction,
}: {
  item: BundleItem;
  action: "apply" | "defer" | "dismiss";
  onAction: (action: "apply" | "defer" | "dismiss") => void;
}) {
  return (
    <Card className="rounded-lg">
      <CardContent className="gap-3">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-base font-semibold">{item.title}</Text>
            <Muted>{item.summary}</Muted>
          </View>
          <EpistemicStateBadge state={item.epistemicState ?? "confirmed"} />
        </View>
        <View className="flex-row gap-2">
          {(["apply", "defer", "dismiss"] as const).map((next) => (
            <Button
              key={next}
              size="sm"
              variant={action === next ? "default" : "outline"}
              onPress={() => onAction(next)}
            >
              {next}
            </Button>
          ))}
        </View>
      </CardContent>
    </Card>
  );
}
