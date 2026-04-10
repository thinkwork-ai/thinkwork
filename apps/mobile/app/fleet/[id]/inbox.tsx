import { View, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Text, Muted } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { CheckCircle, XCircle, Clock } from "lucide-react-native";

// TODO: Replace with GraphQL queries/mutations
// Previously: useQuery(api.agentcoreApprovals.listPendingApprovals, { assistantId })
// Previously: useQuery(api.agentcoreApprovals.listApprovalHistory, { assistantId, limit: 50 })
// Previously: useMutation(api.agentcoreApprovals.reviewApprovalRequest)

export default function FleetApprovalsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // TODO: implement via GraphQL queries
  const pending: any[] | undefined = undefined; // TODO: listPendingApprovals via GraphQL
  const history: any[] | undefined = undefined; // TODO: listApprovalHistory via GraphQL

  // TODO: implement via GraphQL mutation
  const reviewApproval = async (_args: { approvalId: string; decision: string }) => {
    throw new Error("TODO: implement reviewApproval via GraphQL");
  };

  if (pending === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const handleApprove = async (approvalId: string, decision: "approve_temporary" | "approve_persistent") => {
    await reviewApproval({ approvalId, decision });
  };

  const handleReject = async (approvalId: string) => {
    await reviewApproval({ approvalId, decision: "reject" });
  };

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <Stack.Screen options={{ title: "Inbox" }} />

      <ScrollView className="flex-1 px-4 pt-4">
        {/* Pending approvals */}
        {pending.length > 0 && (
          <View className="mb-6">
            <Text className="mb-3 text-base font-semibold">
              Pending ({pending.length})
            </Text>
            <View className="gap-3">
              {pending.map((req) => {
                const expiresIn = Math.max(
                  0,
                  Math.round((req.expiresAt - Date.now()) / 60000),
                );
                return (
                  <View
                    key={req.id}
                    className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
                  >
                    <View className="flex-row items-center gap-2">
                      <Clock size={16} color={colors.mutedForeground} />
                      <Muted className="text-xs">
                        {expiresIn}m remaining
                      </Muted>
                      {req.riskLevel && (
                        <Text className="text-xs font-medium">
                          Risk: {req.riskLevel}
                        </Text>
                      )}
                    </View>
                    <Text className="mt-2 font-semibold">
                      {req.resourceType}: {req.resource}
                    </Text>
                    <Muted className="mt-1 text-sm">{req.reason}</Muted>
                    <Muted className="mt-1 text-xs">
                      Tenant: {req.tenantId} | {req.durationType}
                      {req.suggestedDurationHours
                        ? ` (${req.suggestedDurationHours}h)`
                        : ""}
                    </Muted>

                    <View className="mt-3 flex-row gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1"
                        onPress={() =>
                          handleApprove(req.id, "approve_temporary")
                        }
                      >
                        <Text className="text-xs text-white">
                          Approve (temp)
                        </Text>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onPress={() =>
                          handleApprove(req.id, "approve_persistent")
                        }
                      >
                        <Text className="text-xs">Approve (permanent)</Text>
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onPress={() => handleReject(req.id)}
                      >
                        <Text className="text-xs text-white">Reject</Text>
                      </Button>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* History */}
        <Text className="mb-3 text-base font-semibold">History</Text>
        {(history ?? []).length === 0 ? (
          <View className="items-center py-8">
            <Muted>No approval history yet.</Muted>
          </View>
        ) : (
          <View className="gap-2 pb-8">
            {(history ?? []).map((req) => {
              const isApproved = req.status === "approved";
              const isRejected = req.status === "rejected" || req.status === "timeout";
              const isPending = req.status === "pending";
              return (
                <View
                  key={req.id}
                  className="flex-row items-center rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  {isApproved && (
                    <CheckCircle size={16} color="#16a34a" />
                  )}
                  {isRejected && <XCircle size={16} color="#dc2626" />}
                  {isPending && (
                    <Clock size={16} color={colors.mutedForeground} />
                  )}
                  <View className="ml-3 flex-1">
                    <Text className="text-sm font-medium">
                      {req.resourceType}: {req.resource}
                    </Text>
                    <Muted className="text-xs">
                      {req.tenantId} — {req.status}
                      {req.decision ? ` (${req.decision})` : ""}
                    </Muted>
                  </View>
                  <Muted className="text-xs">
                    {new Date(req.createdAt).toLocaleDateString()}
                  </Muted>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
