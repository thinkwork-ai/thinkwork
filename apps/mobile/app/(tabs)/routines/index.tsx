import { View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useRoutines } from "@/lib/hooks/use-routines";
import { Zap, Plus } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { TabHeader } from "@/components/layout/tab-header";
import { WebContent } from "@/components/layout/web-content";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";
import { RoutineRow, type Routine } from "@/components/routines/routine-row";

export default function RoutinesScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();
  const isLarge = useIsLargeScreen();
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [{ data: routinesData }] = useRoutines(tenantId);
  const routines = routinesData?.routines;
  const isEmpty = routines !== undefined && routines.length === 0;

  const borderColor = colorScheme === "dark" ? "#262626" : "#e5e5e5";
  const cardBg = colorScheme === "dark" ? "#0a0a0a" : "#ffffff";

  const handleNewRoutine = () => {
    router.push("/routines/new");
  };

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-neutral-950">
      <TabHeader
        title="Routines"
        right={
          <Pressable onPress={handleNewRoutine} className="flex-row items-center gap-1">
            <Plus size={18} color={colors.primary} />
            <Text style={{ color: colors.primary }} className="font-semibold text-base">
              New
            </Text>
          </Pressable>
        }
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={isLarge ? { paddingHorizontal: 16 } : undefined}
      >
        <WebContent bordered>
          {isEmpty ? (
            <View className="items-center justify-center py-20 px-8">
              <View className="bg-neutral-100 dark:bg-neutral-800 rounded-full p-5 mb-4">
                <Zap size={32} color={colors.mutedForeground} />
              </View>
              <Text
                weight="semibold"
                size="lg"
                className="text-neutral-900 dark:text-neutral-100 mb-2 text-center"
              >
                No routines yet
              </Text>
              <Muted className="text-center mb-6">
                Create your first durable routine to automate workflows.
              </Muted>
              <Pressable
                onPress={handleNewRoutine}
                className="bg-orange-500 px-6 py-2.5 rounded-xl flex-row items-center gap-2"
              >
                <Plus size={16} color="#fff" />
                <Text weight="medium" className="text-white">
                  New Routine
                </Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={
                isLarge
                  ? {
                      marginTop: 12,
                      marginBottom: 16,
                      borderWidth: 1,
                      borderColor,
                      borderRadius: 12,
                      overflow: "hidden",
                      backgroundColor: cardBg,
                    }
                  : undefined
              }
            >
              {(routines ?? ([] as Routine[])).map(
                (rt: Routine, idx: number, arr: Routine[]) => (
                  <RoutineRow
                    key={rt.id}
                    routine={rt}
                    isLast={idx === arr.length - 1}
                    onPress={() => {
                      // Draft routines with a builder thread -> open builder chat to continue
                      if (
                        (rt.status === "draft" || rt.buildStatus === "draft") &&
                        rt.builderThreadId
                      ) {
                        router.push({
                          pathname: "/routines/builder-chat",
                          params: {
                            routineName: rt.name,
                            routineId: rt.id,
                            existingThreadId: rt.builderThreadId,
                          },
                        });
                      } else {
                        router.push(`/routines/${rt.id}`);
                      }
                    }}
                  />
                )
              )}
            </View>
          )}
          <View className="h-8" />
        </WebContent>
      </ScrollView>
    </View>
  );
}
