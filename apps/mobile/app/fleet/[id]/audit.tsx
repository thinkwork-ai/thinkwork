import { View, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Text, Muted } from "@/components/ui/typography";
import { AuditLogTable } from "@/components/fleet/audit-log-table";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

// TODO: Replace with GraphQL query
// Previously: useQuery(api.agentcoreAdmin.getAuditLog, { assistantId, limit: 100 })

export default function FleetAuditLogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // TODO: implement via GraphQL query
  const auditLog: any[] | undefined = undefined; // TODO: getAuditLog via GraphQL

  if (auditLog === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <Stack.Screen options={{ title: "Audit Log" }} />

      <ScrollView className="flex-1 px-4 pt-4">
        {auditLog.length === 0 ? (
          <View className="items-center py-16">
            <Muted>No audit events recorded yet.</Muted>
          </View>
        ) : (
          <AuditLogTable entries={auditLog} />
        )}
      </ScrollView>
    </View>
  );
}
