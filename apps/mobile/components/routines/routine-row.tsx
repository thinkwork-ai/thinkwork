import { View } from "react-native";
import { useColorScheme } from "nativewind";
import { ChevronRight } from "lucide-react-native";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { MobileRow } from "@/components/ui/mobile-row";

export type RoutineListTriggerType = "manual" | "schedule" | "webhook" | "event";
export type RoutineStatus = "active" | "inactive" | "running" | "draft" | "building";
export type Routine = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  triggerType?: string;
  triggerTypes?: RoutineListTriggerType[];
  status?: RoutineStatus;
  buildStatus?: string;
  builderThreadId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

const TRIGGER_LABELS: Record<RoutineListTriggerType, string> = {
  manual: "Manual",
  schedule: "Scheduled",
  webhook: "Webhook",
  event: "Event",
};

export function TriggerText({ triggerTypes }: { triggerTypes: RoutineListTriggerType[] }) {
  if (triggerTypes.length === 0) return <Muted className="text-sm">No triggers</Muted>;
  return (
    <Muted className="text-sm">
      {triggerTypes.map((type) => TRIGGER_LABELS[type]).join(" + ")}
    </Muted>
  );
}

export function RoutineStatusBadge({ status }: { status: RoutineStatus }) {
  const variant =
    status === "building"
      ? "warning"
      : status === "running"
        ? "warning"
        : status === "active"
          ? "success"
          : "outline"; // draft + inactive
  return <Badge variant={variant}>{status}</Badge>;
}

export function RoutineRow({
  routine,
  isLast,
  onPress,
}: {
  routine: Routine;
  isLast: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  return (
    <MobileRow
      isLast={isLast}
      onPress={onPress}
      line1Left={
        <View className="flex-row items-center gap-2 flex-1">
          <Text weight="medium" className="text-neutral-900 dark:text-neutral-100">
            {routine.name}
          </Text>
        </View>
      }
      line1Right={
        <>
          <RoutineStatusBadge
            status={routine.status ?? (routine.enabled ? "active" : "inactive")}
          />
          <ChevronRight size={16} color={colors.mutedForeground} />
        </>
      }
      line2Left={<TriggerText triggerTypes={routine.triggerTypes ?? []} />}
    />
  );
}
