import { useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import { useColorScheme } from "nativewind";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Trash2, Shield, Activity, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { Skeleton } from "@/components/ui/skeleton";
import { COLORS } from "@/lib/theme";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";

// TODO: Replace Convex queries with GraphQL equivalents
// Previously: useQuery(api.teamConnect.listProviders)
// Previously: useQuery(api.teamConnect.listConnections)
// Previously: useQuery(api.teamConnect.getAuditLog, { providerId })
// Previously: useMutation(api.teamConnect.revokeConnection)

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (hrs < 24) return `${hrs} hr ago`;
  return `${days}d ago`;
}

function humanizeScope(scope: string): string {
  return scope
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatusIcon({ code }: { code?: number }) {
  if (!code) return <AlertCircle size={14} color="#a3a3a3" />;
  if (code >= 200 && code < 300) return <CheckCircle size={14} color="#22c55e" />;
  return <XCircle size={14} color="#ef4444" />;
}

export default function CredentialDetailScreen() {
  const { providerId, connectionId } = useLocalSearchParams<{ providerId: string; connectionId: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();
  const isLargeScreen = useIsLargeScreen();

  // TODO: Replace with GraphQL queries
  const providers: any[] | undefined = undefined; // TODO: implement listProviders via GraphQL
  const connections: any[] | undefined = undefined; // TODO: implement listConnections via GraphQL
  const auditLog: any[] | undefined = undefined; // TODO: implement getAuditLog via GraphQL
  const revokeConnection = async (_args: { connectionId: string }) => {
    throw new Error("TODO: implement revokeConnection via GraphQL");
  };

  const [revoking, setRevoking] = useState(false);

  const provider = providers?.find((p: any) => p.providerId === providerId);
  const connection = connectionId
    ? connections?.find((c: any) => c.id === connectionId)
    : connections?.find((c: any) => c.providerId === providerId);

  const handleDisconnect = async () => {
    const doRevoke = async () => {
      setRevoking(true);
      try {
        await revokeConnection({ connectionId: connection!.id });
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/settings/connectors");
        }
      } catch (e) {
        console.error("Revoke failed:", e);
      } finally {
        setRevoking(false);
      }
    };

    if (Platform.OS === "web") {
      if (confirm("Disconnect this OAuth integration? This will revoke access.")) {
        await doRevoke();
      }
    } else {
      Alert.alert(
        "Disconnect OAuth Integration",
        "This will revoke access. Are you sure?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Disconnect", style: "destructive", onPress: doRevoke },
        ],
      );
    }
  };

  if (!providers || !connections) {
    return (
      <DetailLayout title="OAuth Integration">
        <View className="flex-1 p-4" style={{ maxWidth: 600 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md mb-3" />
          ))}
        </View>
      </DetailLayout>
    );
  }

  if (!provider || !connection) {
    return (
      <DetailLayout title="OAuth Integration">
        <View className="flex-1 items-center justify-center p-4">
          <Muted>OAuth integration not found.</Muted>
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout title={provider.name}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 }}
      >
        <View style={{ maxWidth: 600 }}>
          {/* Provider Info */}
          <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 mb-6">
            <View className="flex-row items-center mb-4">
              <View className="items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30 w-12 h-12">
                <Text style={{ fontSize: 24 }}>{provider.icon || "🔗"}</Text>
              </View>
              <View className="flex-1 ml-3">
                <View className="flex-row items-center gap-2">
                  <View className="w-2 h-2 rounded-full bg-green-500" />
                  <Text className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Connected
                  </Text>
                </View>
                {provider.description && (
                  <Muted className="text-sm mt-0.5">{provider.description}</Muted>
                )}
              </View>
            </View>

            {/* Details */}
            <View className="gap-3">
              {connection.connectedEmail && (
                <View className="flex-row justify-between">
                  <Muted className="text-sm">Account</Muted>
                  <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                    {connection.connectedEmail}
                  </Text>
                </View>
              )}
              {connection.connectedAt && (
                <View className="flex-row justify-between">
                  <Muted className="text-sm">Connected</Muted>
                  <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                    {formatDate(connection.connectedAt)}
                  </Text>
                </View>
              )}
              {connection.lastUsedAt && (
                <View className="flex-row justify-between">
                  <Muted className="text-sm">Last Used</Muted>
                  <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                    {relativeTime(connection.lastUsedAt)}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Permissions */}
          {provider.oauthScopes && provider.oauthScopes.length > 0 && (
            <View className="mb-6">
              <View className="flex-row items-center gap-2 mb-3">
                <Shield size={16} color={colors.mutedForeground} />
                <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  Permissions
                </Text>
              </View>
              <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                {provider.oauthScopes.map((scope: string, idx: number) => (
                  <View
                    key={scope}
                    className={`flex-row items-center px-4 py-2.5 ${
                      idx < provider.oauthScopes.length - 1
                        ? "border-b border-neutral-100 dark:border-neutral-800"
                        : ""
                    }`}
                  >
                    <CheckCircle size={14} color="#22c55e" />
                    <Text className="text-sm text-neutral-900 dark:text-neutral-100 ml-2.5">
                      {humanizeScope(scope)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Recent Activity */}
          <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-3">
              <Activity size={16} color={colors.mutedForeground} />
              <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Recent Activity
              </Text>
            </View>
            {auditLog === undefined ? (
              <View className="gap-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </View>
            ) : auditLog.length === 0 ? (
              <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-4 py-6 items-center">
                <Muted className="text-sm">No recent activity</Muted>
              </View>
            ) : (
              <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                {auditLog.map((entry: any, idx: number) => (
                  <View
                    key={entry.id || idx}
                    className={`flex-row items-center px-4 py-2.5 ${
                      idx < auditLog.length - 1
                        ? "border-b border-neutral-100 dark:border-neutral-800"
                        : ""
                    }`}
                  >
                    <StatusIcon code={entry.statusCode} />
                    <View className="flex-1 ml-2.5">
                      <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                        {entry.action}
                      </Text>
                      <View className="flex-row items-center gap-2 mt-0.5">
                        {entry.statusCode && (
                          <Muted className="text-xs">{entry.statusCode}</Muted>
                        )}
                        {entry.duration && (
                          <Muted className="text-xs">{entry.duration}ms</Muted>
                        )}
                      </View>
                    </View>
                    {entry.timestamp && (
                      <Muted className="text-xs">{relativeTime(entry.timestamp)}</Muted>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Disconnect */}
          <View className="pt-4 border-t border-neutral-200 dark:border-neutral-800">
            <Pressable
              onPress={handleDisconnect}
              disabled={revoking}
              className="flex-row items-center justify-center py-3 px-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
              style={{ opacity: revoking ? 0.5 : 1 }}
            >
              {revoking ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <Trash2 size={18} color="#ef4444" />
              )}
              <Text className="ml-2 text-red-600 dark:text-red-400 font-medium">
                {revoking ? "Disconnecting..." : "Disconnect OAuth Integration"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </DetailLayout>
  );
}
