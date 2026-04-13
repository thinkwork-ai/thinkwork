import { useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useRoutines } from "@/lib/hooks/use-routines";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { MobileRow } from "@/components/ui/mobile-row";
import { TabHeader } from "@/components/layout/tab-header";
import { WebContent } from "@/components/layout/web-content";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { RoutineRow, type Routine } from "@/components/routines/routine-row";
import { Hammer, RefreshCw, Plus, ChevronUp, ChevronDown, ChevronRight } from "lucide-react-native";
// Plus is used in the empty-state CTA below

export default function SkillsScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [skillsExpanded, setSkillsExpanded] = useState(true);
  const [routinesExpanded, setRoutinesExpanded] = useState(true);

  // TODO: Migrate api.assistantSkills.listCatalog to GraphQL
  const catalog = undefined as any[] | undefined; // Stub
  const [{ data: routinesData }] = useRoutines(tenantId);
  const routines = routinesData?.routines;

  const skillsEmpty = catalog !== undefined && catalog.length === 0;
  const routinesEmpty = routines !== undefined && routines.length === 0;

  const headerMenu = (
    <HeaderContextMenu
      items={[
        {
          label: "New Routine",
          icon: RefreshCw,
          onPress: () => router.push("/routines/new"),
        },
      ]}
    />
  );

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <TabHeader title="Skills" right={headerMenu} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <WebContent bordered>
          {/* -- Skills Section -- */}
          <Pressable
            onPress={() => setSkillsExpanded(!skillsExpanded)}
            className="flex-row items-center justify-between px-4 py-3"
          >
            <View className="flex-row items-center gap-2">
              <Hammer size={16} color={colors.mutedForeground} />
              <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                Skills
              </Text>
            </View>
            {skillsExpanded ? (
              <ChevronUp size={18} color={colors.mutedForeground} />
            ) : (
              <ChevronDown size={18} color={colors.mutedForeground} />
            )}
          </Pressable>

          {skillsExpanded && (
            catalog === undefined ? null : skillsEmpty ? (
              <View className="items-center py-10 px-6">
                <View className="bg-neutral-100 dark:bg-neutral-800 rounded-full p-4 mb-3">
                  <Hammer size={28} color={colors.mutedForeground} />
                </View>
                <Muted className="text-center">No skills available</Muted>
              </View>
            ) : (
              <View className="bg-neutral-50 dark:bg-neutral-900">
                {catalog.map((skill, idx) => (
                  <MobileRow
                    key={skill.id}
                    isLast={idx === catalog.length - 1}
                    onPress={() =>
                      router.push({
                        pathname: "/skills/[skillId]",
                        params: { skillId: skill.skillId },
                      })
                    }
                    line1Left={
                      <Text weight="medium" className="text-neutral-900 dark:text-neutral-100">
                        {skill.name}
                      </Text>
                    }
                    line1Right={
                      <ChevronRight size={16} color={colors.mutedForeground} />
                    }
                    line2Left={
                      <Muted className="text-sm" numberOfLines={2}>
                        {skill.description}
                      </Muted>
                    }
                  />
                ))}
              </View>
            )
          )}

          {/* -- Routines Section -- */}
          <Pressable
            onPress={() => setRoutinesExpanded(!routinesExpanded)}
            className="flex-row items-center justify-between px-4 py-3"
          >
            <View className="flex-row items-center gap-2">
              <RefreshCw size={16} color={colors.mutedForeground} />
              <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                Routines
              </Text>
            </View>
            {routinesExpanded ? (
              <ChevronUp size={18} color={colors.mutedForeground} />
            ) : (
              <ChevronDown size={18} color={colors.mutedForeground} />
            )}
          </Pressable>

          {routinesExpanded && (
            routines === undefined ? null : routinesEmpty ? (
              <View className="items-center py-10 px-6">
                <View className="bg-neutral-100 dark:bg-neutral-800 rounded-full p-4 mb-3">
                  <RefreshCw size={28} color={colors.mutedForeground} />
                </View>
                <Muted className="text-center mb-4">No routines yet</Muted>
                <Pressable
                  onPress={() => router.push("/routines/new")}
                  className="bg-sky-500 px-5 py-2 rounded-xl flex-row items-center gap-2"
                >
                  <Plus size={16} color="#fff" />
                  <Text weight="medium" className="text-white">
                    New Routine
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="bg-neutral-50 dark:bg-neutral-900">
                {(routines as Routine[]).map(
                  (rt: Routine, idx: number, arr: Routine[]) => (
                    <RoutineRow
                      key={rt.id}
                      routine={rt}
                      isLast={idx === arr.length - 1}
                      onPress={() => {
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
            )
          )}
        </WebContent>
      </ScrollView>
    </View>
  );
}
