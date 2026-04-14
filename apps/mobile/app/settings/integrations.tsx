import { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, RefreshControl, Alert } from "react-native";
import { useColorScheme } from "nativewind";
import * as WebBrowser from "expo-web-browser";
import { Mail, Calendar, Link2, Link2Off, AlertTriangle, RefreshCw, ListChecks } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { COLORS } from "@/lib/theme";
import { useMe } from "@/lib/hooks/use-users";
import { useTenant } from "@/lib/hooks/use-tenants";
const API_BASE = "https://api.thinkwork.ai";
const GRAPHQL_API_KEY = process.env.EXPO_PUBLIC_GRAPHQL_API_KEY || "";

type ConnectionRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  provider_id: string;
  status: string;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  connected_at: string | null;
  provider_name: string;
  provider_display_name: string;
  provider_type: string;
};

const PROVIDER_ICONS: Record<string, typeof Mail> = {
  google_productivity: Mail,
  microsoft_365: Calendar,
  lastmile: ListChecks,
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/20 text-green-400",
  expired: "bg-yellow-500/20 text-yellow-400",
  pending: "bg-blue-500/20 text-blue-400",
  inactive: "bg-neutral-500/20 text-neutral-400",
};

export default function IntegrationsScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [meResult] = useMe();
  const user = meResult.data?.me ?? undefined;
  const [tenantResult] = useTenant(user?.tenantId);
  const tenant = tenantResult.data?.tenant ?? undefined;

  const [connections, setConnections] = useState<ConnectionRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchConnections = useCallback(async () => {
    if (!tenant?.id || !user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/api/connections`, {
        headers: {
          "x-api-key": GRAPHQL_API_KEY,
          "x-tenant-id": tenant.id,
          "x-principal-id": user.id,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setConnections(data);
      }
    } catch (err) {
      console.error("[integrations] Failed to fetch connections:", err);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, user?.id]);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchConnections();
    setRefreshing(false);
  };

  const handleConnectGoogle = async () => {
    if (!tenant?.id || !user?.id) return;
    const url = `${API_BASE}/api/oauth/authorize?provider=google_productivity&userId=${user.id}&tenantId=${tenant.id}`;
    await WebBrowser.openBrowserAsync(url);
    // Refresh connections after OAuth flow completes
    await fetchConnections();
  };

  const handleConnectMicrosoft = async () => {
    if (!tenant?.id || !user?.id) return;
    const url = `${API_BASE}/api/oauth/authorize?provider=microsoft_365&userId=${user.id}&tenantId=${tenant.id}`;
    await WebBrowser.openBrowserAsync(url);
    await fetchConnections();
  };

  const handleConnectLastmile = async () => {
    if (!tenant?.id || !user?.id) return;
    const url = `${API_BASE}/api/oauth/authorize?provider=lastmile&userId=${user.id}&tenantId=${tenant.id}`;
    await WebBrowser.openBrowserAsync(url);
    await fetchConnections();
  };

  const handleDisconnect = async (connectionId: string, providerName: string) => {
    Alert.alert(
      "Disconnect",
      `Remove your ${providerName} connection? Your agent will no longer be able to access this account.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await fetch(`${API_BASE}/api/connections/${connectionId}`, {
                method: "DELETE",
                headers: {
                  "x-api-key": GRAPHQL_API_KEY,
                  "x-tenant-id": tenant?.id || "",
                },
              });
              await fetchConnections();
            } catch (err) {
              console.error("[integrations] Disconnect failed:", err);
            }
          },
        },
      ],
    );
  };

  const handleReconnect = async (providerName: string) => {
    if (providerName === "google_productivity") {
      await handleConnectGoogle();
    } else if (providerName === "microsoft_365") {
      await handleConnectMicrosoft();
    } else if (providerName === "lastmile") {
      await handleConnectLastmile();
    }
  };

  // Filter to only active/expired connections
  const activeConnections = (connections || []).filter(
    (c) => c.status === "active" || c.status === "expired",
  );

  // Check which providers are already connected
  const connectedProviders = new Set(activeConnections.map((c) => c.provider_name));

  if (loading || !tenant) {
    return (
      <DetailLayout title="Integrations">
        <View className="flex-1 p-4" style={{ maxWidth: 600 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl mb-3" />
          ))}
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout title="Integrations">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ maxWidth: 600, gap: 16 }}>
          {/* Connected accounts */}
          {activeConnections.length > 0 && (
            <View>
              <Text className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-2 px-1">
                Connected Accounts
              </Text>
              <View className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
                {activeConnections.map((conn, idx) => {
                  const Icon = PROVIDER_ICONS[conn.provider_name] || Link2;
                  const lastSync = conn.metadata?.gmail_last_sync_at || conn.metadata?.gcal_last_sync_at;
                  const isExpired = conn.status === "expired";

                  return (
                    <View
                      key={conn.id}
                      className={`px-4 py-3 ${idx < activeConnections.length - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center gap-3 flex-1">
                          <View className="w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 items-center justify-center">
                            <Icon size={18} color={isExpired ? colors.destructive : colors.primary} />
                          </View>
                          <View className="flex-1">
                            <Text className="font-medium text-neutral-900 dark:text-neutral-100">
                              {conn.provider_display_name}
                            </Text>
                            {conn.external_id && (
                              <Muted className="text-xs">{conn.external_id}</Muted>
                            )}
                          </View>
                        </View>
                        <View className="flex-row items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`px-2 py-0.5 ${isExpired ? "border-yellow-500/30" : "border-green-500/30"}`}
                            textClassName={`text-xs ${isExpired ? "text-yellow-400" : "text-green-400"}`}
                          >
                            {isExpired ? "Expired" : "Active"}
                          </Badge>
                        </View>
                      </View>

                      {/* Expired banner */}
                      {isExpired && (
                        <Pressable
                          onPress={() => handleReconnect(conn.provider_name)}
                          className="mt-2 flex-row items-center gap-2 rounded-lg bg-yellow-500/10 px-3 py-2"
                        >
                          <AlertTriangle size={14} color={colors.destructive} />
                          <Text className="text-xs text-yellow-400 flex-1">
                            Connection expired. Tap to reconnect.
                          </Text>
                          <RefreshCw size={14} color={colors.destructive} />
                        </Pressable>
                      )}

                      {/* Last sync + disconnect */}
                      <View className="mt-2 flex-row items-center justify-between">
                        {lastSync ? (
                          <Muted className="text-xs">
                            Last sync: {new Date(lastSync as string).toLocaleString()}
                          </Muted>
                        ) : (
                          <Muted className="text-xs">Not synced yet</Muted>
                        )}
                        <Pressable
                          onPress={() => handleDisconnect(conn.id, conn.provider_display_name)}
                          className="flex-row items-center gap-1"
                        >
                          <Link2Off size={12} color={colors.mutedForeground} />
                          <Muted className="text-xs">Disconnect</Muted>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Available integrations */}
          <View>
            <Text className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-2 px-1">
              {activeConnections.length > 0 ? "Add More" : "Available Integrations"}
            </Text>
            <View className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              {/* Google Workspace */}
              {!connectedProviders.has("google_productivity") && (
                <Pressable
                  onPress={handleConnectGoogle}
                  className="flex-row items-center px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 active:bg-neutral-50 dark:active:bg-neutral-800"
                >
                  <View className="w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 items-center justify-center">
                    <Mail size={18} color={colors.primary} />
                  </View>
                  <View className="flex-1 ml-3">
                    <Text className="font-medium text-neutral-900 dark:text-neutral-100">
                      Google Workspace
                    </Text>
                    <Muted className="text-xs">Gmail + Google Calendar</Muted>
                  </View>
                  <Badge variant="outline" className="px-2 py-0.5" textClassName="text-xs">
                    Connect
                  </Badge>
                </Pressable>
              )}

              {/* Microsoft 365 */}
              {!connectedProviders.has("microsoft_365") && (
                <Pressable
                  onPress={handleConnectMicrosoft}
                  className="flex-row items-center px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800"
                >
                  <View className="w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 items-center justify-center">
                    <Calendar size={18} color={colors.primary} />
                  </View>
                  <View className="flex-1 ml-3">
                    <Text className="font-medium text-neutral-900 dark:text-neutral-100">
                      Microsoft 365
                    </Text>
                    <Muted className="text-xs">Outlook + Calendar</Muted>
                  </View>
                  <Badge variant="outline" className="px-2 py-0.5" textClassName="text-xs">
                    Connect
                  </Badge>
                </Pressable>
              )}

              {/* LastMile Tasks */}
              {!connectedProviders.has("lastmile") && (
                <Pressable
                  onPress={handleConnectLastmile}
                  className="flex-row items-center px-4 py-3 border-t border-neutral-100 dark:border-neutral-800 active:bg-neutral-50 dark:active:bg-neutral-800"
                >
                  <View className="w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 items-center justify-center">
                    <ListChecks size={18} color={colors.primary} />
                  </View>
                  <View className="flex-1 ml-3">
                    <Text className="font-medium text-neutral-900 dark:text-neutral-100">
                      LastMile Tasks
                    </Text>
                    <Muted className="text-xs">Work tasks assigned to you in LastMile</Muted>
                  </View>
                  <Badge variant="outline" className="px-2 py-0.5" textClassName="text-xs">
                    Connect
                  </Badge>
                </Pressable>
              )}

              {/* All connected */}
              {connectedProviders.has("google_productivity") &&
                connectedProviders.has("microsoft_365") &&
                connectedProviders.has("lastmile") && (
                <View className="px-4 py-3">
                  <Muted className="text-sm">All available integrations connected.</Muted>
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </DetailLayout>
  );
}
