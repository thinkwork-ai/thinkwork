import { View, Switch } from "react-native";
import { useColorScheme } from "nativewind";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useAppMode } from "@/lib/hooks/use-app-mode";

export default function AdvancedModeScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { mode, setMode, isAdmin } = useAppMode();

  return (
    <DetailLayout title="Advanced Mode">
      <WebContent>
        <View className="px-4 pt-4 gap-6">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-medium">Advanced Mode</Text>
            <Switch
              value={isAdmin}
              onValueChange={(v) => setMode(v ? "admin" : "user")}
              trackColor={{ false: "#d4d4d4", true: "#f8841d" }}
              thumbColor="#ffffff"
            />
          </View>

          <View className="gap-3">
            <Muted className="text-sm leading-5">
              When enabled, Advanced Mode shows additional technical details throughout the app:
            </Muted>
            <View className="gap-2 pl-2">
              <Muted className="text-sm leading-5">
                {"\u2022"} Agent turn rows in thread conversations (status, duration, token counts, cost)
              </Muted>
              <Muted className="text-sm leading-5">
                {"\u2022"} Model selection and skill configuration in Settings
              </Muted>
              <Muted className="text-sm leading-5">
                {"\u2022"} Usage and cost breakdowns
              </Muted>
              <Muted className="text-sm leading-5">
                {"\u2022"} Memory file management
              </Muted>
            </View>
            <Muted className="text-sm leading-5">
              This is useful for debugging agent behavior, monitoring costs, and fine-tuning your setup.
            </Muted>
          </View>
        </View>
      </WebContent>
    </DetailLayout>
  );
}
