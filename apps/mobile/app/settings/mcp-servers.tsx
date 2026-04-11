import { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useColorScheme } from "nativewind";
import * as WebBrowser from "expo-web-browser";
import { Cable, CheckCircle2, AlertTriangle, Link2, RefreshCw } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { COLORS } from "@/lib/theme";
import { useMe } from "@/lib/hooks/use-users";
import { useTenant } from "@/lib/hooks/use-tenants";

const API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(/\/graphql$/, "");
const GRAPHQL_API_KEY = process.env.EXPO_PUBLIC_GRAPHQL_API_KEY || "";

type McpServerRow = {
  id: string;
  name: string;
  slug: string;
  url: string;
  authType: string;
  oauthProvider: string | null;
  tools: Array<{ name: string; description?: string }> | null;
  enabled: boolean;
  authStatus: "active" | "not_connected" | "expired";
  agentName?: string;
};

export default function McpServersScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [meResult] = useMe();
  const user = meResult.data?.me ?? undefined;
  const [tenantResult] = useTenant(user?.tenantId);
  const tenant = tenantResult.data?.tenant ?? undefined;

  const [servers, setServers] = useState<McpServerRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchServers = useCallback(async () => {
    if (!tenant?.id || !user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/api/skills/user-mcp-servers`, {
        headers: {
          "x-api-key": GRAPHQL_API_KEY,
          "x-tenant-id": tenant.id,
          "x-principal-id": user.id,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers || []);
      }
    } catch (err) {
      console.error("[mcp-servers] Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, user?.id]);

  useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchServers();
    setRefreshing(false);
  };

  const handleConnect = async (mcpServer: McpServerRow) => {
    if (!tenant?.id || !user?.id) return;
    // RFC 9728 OAuth flow — the API handles discovery, registration, and token exchange.
    // We just open the authorize URL which redirects through the MCP server's OAuth proxy.
    const url = `${API_BASE}/api/skills/mcp-oauth/authorize?mcpServerId=${mcpServer.id}&userId=${user.id}&tenantId=${tenant.id}`;
    await WebBrowser.openBrowserAsync(url);
    await fetchServers();
  };

  if (loading || !tenant) {
    return (
      <DetailLayout title="MCP Servers">
        <View className="flex-1 p-4" style={{ maxWidth: 600 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl mb-3" />
          ))}
        </View>
      </DetailLayout>
    );
  }

  const oauthServers = (servers || []).filter((s) => s.authType === "oauth");
  const readyServers = (servers || []).filter((s) => s.authType !== "oauth" || s.authStatus === "active");
  const needsAction = oauthServers.filter((s) => s.authStatus !== "active");

  return (
    <DetailLayout title="MCP Servers">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ maxWidth: 600, gap: 16 }}>
          {(!servers || servers.length === 0) && (
            <View className="items-center py-12">
              <Cable size={40} color={colors.mutedForeground} />
              <Muted className="mt-3 text-center">
                No MCP servers assigned to your agents yet. Ask your admin to set up MCP tool connectors.
              </Muted>
            </View>
          )}

          {/* Servers needing OAuth connection */}
          {needsAction.length > 0 && (
            <View>
              <Text className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-2 px-1">
                Needs Connection
              </Text>
              <View className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
                {needsAction.map((server, idx) => (
                  <Pressable
                    key={server.id}
                    onPress={() => handleConnect(server)}
                    className={`flex-row items-center px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${idx < needsAction.length - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
                  >
                    <View className="w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 items-center justify-center">
                      {server.authStatus === "expired" ? (
                        <AlertTriangle size={18} color={colors.destructive} />
                      ) : (
                        <Cable size={18} color={colors.primary} />
                      )}
                    </View>
                    <View className="flex-1 ml-3">
                      <Text className="font-medium text-neutral-900 dark:text-neutral-100">
                        {server.name}
                      </Text>
                      <Muted className="text-xs">
                        {server.authStatus === "expired"
                          ? "Connection expired. Tap to reconnect."
                          : "Tap to connect your account"}
                      </Muted>
                    </View>
                    <Badge
                      variant="outline"
                      className={`px-2 py-0.5 ${server.authStatus === "expired" ? "border-yellow-500/30" : ""}`}
                      textClassName={`text-xs ${server.authStatus === "expired" ? "text-yellow-400" : ""}`}
                    >
                      {server.authStatus === "expired" ? "Reconnect" : "Connect"}
                    </Badge>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Active / ready servers */}
          {readyServers.length > 0 && (
            <View>
              <Text className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-2 px-1">
                Active
              </Text>
              <View className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
                {readyServers.map((server, idx) => (
                  <View
                    key={server.id}
                    className={`px-4 py-3 ${idx < readyServers.length - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-3 flex-1">
                        <View className="w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 items-center justify-center">
                          <CheckCircle2 size={18} color="#22c55e" />
                        </View>
                        <View className="flex-1">
                          <Text className="font-medium text-neutral-900 dark:text-neutral-100">
                            {server.name}
                          </Text>
                          <Muted className="text-xs">
                            {server.tools?.length
                              ? `${server.tools.length} tools available`
                              : server.authType === "none"
                                ? "No auth required"
                                : "Connected"}
                          </Muted>
                        </View>
                      </View>
                      <Badge
                        variant="outline"
                        className="px-2 py-0.5 border-green-500/30"
                        textClassName="text-xs text-green-400"
                      >
                        Active
                      </Badge>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </DetailLayout>
  );
}
