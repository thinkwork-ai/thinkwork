import { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, Alert, RefreshControl } from "react-native";
import { useColorScheme } from "nativewind";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  Cable,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wrench,
  Trash2,
  RefreshCw,
  LogOut,
  LogIn,
  Power,
  PowerOff,
} from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
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
  transport?: string;
};

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View className="flex-row items-center justify-between py-2.5 border-b border-neutral-100 dark:border-neutral-800">
      <Muted className="text-sm">{label}</Muted>
      <Text className="text-sm" style={color ? { color } : undefined}>{value}</Text>
    </View>
  );
}

export default function McpServerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [meResult] = useMe();
  const user = meResult.data?.me ?? undefined;
  const [tenantResult] = useTenant(user?.tenantId);
  const tenant = tenantResult.data?.tenant ?? undefined;

  const [server, setServer] = useState<McpServerRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showTools, setShowTools] = useState(false);

  const fetchServer = useCallback(async () => {
    if (!tenant?.id || !user?.id || !id) return;
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
        const found = (data.servers || []).find((s: McpServerRow) => s.id === id);
        setServer(found || null);
      }
    } catch (err) {
      console.error("[mcp-detail] Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, user?.id, id]);

  useEffect(() => {
    void fetchServer();
  }, [fetchServer]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchServer();
    setRefreshing(false);
  };

  const handleAuthenticate = async () => {
    if (!server || !tenant?.id || !user?.id) return;
    const url = `${API_BASE}/api/skills/mcp-oauth/authorize?mcpServerId=${server.id}&userId=${user.id}&tenantId=${tenant.id}`;
    await WebBrowser.openBrowserAsync(url);
    await fetchServer();
  };

  const [clearing, setClearing] = useState(false);

  const handleClearAuth = () => {
    Alert.alert(
      "Clear Authentication",
      `Remove your stored credentials for ${server?.name}? You'll need to re-authenticate to use this server.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            if (!tenant?.id || !user?.id || !server) return;
            setClearing(true);
            try {
              const res = await fetch(`${API_BASE}/api/skills/user-mcp-tokens/${server.id}`, {
                method: "DELETE",
                headers: {
                  "x-api-key": GRAPHQL_API_KEY,
                  "x-tenant-id": tenant.id,
                  "x-principal-id": user.id,
                },
              });
              if (res.ok) {
                setServer({ ...server, authStatus: "not_connected" });
                Alert.alert("Cleared", "Authentication removed. Tap Authenticate to reconnect.");
              } else {
                const body = await res.text();
                Alert.alert("Error", `Failed to clear: ${res.status} ${body}`);
              }
            } catch (err) {
              Alert.alert("Error", "Failed to clear authentication. Check your connection.");
            } finally {
              setClearing(false);
            }
          },
        },
      ],
    );
  };

  if (loading || !tenant) {
    return (
      <DetailLayout title="MCP Server">
        <View className="flex-1 p-4" style={{ maxWidth: 600 }}>
          <Skeleton className="h-10 w-48 rounded-lg mb-4" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </View>
      </DetailLayout>
    );
  }

  if (!server) {
    return (
      <DetailLayout title="MCP Server">
        <View className="flex-1 items-center justify-center p-4">
          <XCircle size={40} color={colors.mutedForeground} />
          <Muted className="mt-3">Server not found</Muted>
        </View>
      </DetailLayout>
    );
  }

  const isConnected = server.authStatus === "active" || server.authType === "none";
  const isOAuth = server.authType === "oauth";
  const toolCount = server.tools?.length ?? 0;
  const statusColor = isConnected ? "#22c55e" : server.authStatus === "expired" ? "#eab308" : colors.mutedForeground;
  const statusLabel = isConnected
    ? "Connected"
    : server.authStatus === "expired"
      ? "Expired"
      : "Not connected";
  const authLabel = isOAuth ? "OAuth" : server.authType === "tenant_api_key" ? "API Key" : "None";

  return (
    <DetailLayout title={server.name}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ maxWidth: 600, gap: 20 }}>
          {/* Status card */}
          <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3">
            <View className="flex-row items-center gap-3 mb-3">
              <View className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 items-center justify-center">
                {isConnected
                  ? <CheckCircle2 size={20} color="#22c55e" />
                  : server.authStatus === "expired"
                    ? <AlertTriangle size={20} color="#eab308" />
                    : <Cable size={20} color={colors.mutedForeground} />}
              </View>
              <View className="flex-1">
                <Text className="font-semibold text-base">{server.name}</Text>
                <Text className="text-xs" style={{ color: statusColor }}>{statusLabel}</Text>
              </View>
            </View>

            <InfoRow label="Status" value={statusLabel} color={statusColor} />
            <InfoRow label="Auth" value={authLabel} />
            <InfoRow label="URL" value={server.url} />
            {server.transport && <InfoRow label="Transport" value={server.transport} />}
            <InfoRow label="Tools" value={`${toolCount} tool${toolCount !== 1 ? "s" : ""}`} />
            <InfoRow label="Enabled" value={server.enabled ? "Yes" : "No"} />
          </View>

          {/* Tools list */}
          {toolCount > 0 && (
            <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
              <Pressable
                onPress={() => setShowTools(!showTools)}
                className="flex-row items-center justify-between px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800"
              >
                <View className="flex-row items-center gap-2">
                  <Wrench size={16} color={colors.mutedForeground} />
                  <Text className="font-medium text-sm">Tools ({toolCount})</Text>
                </View>
                <Muted className="text-xs">{showTools ? "Hide" : "Show"}</Muted>
              </Pressable>
              {showTools && server.tools?.map((tool, idx) => (
                <View
                  key={tool.name}
                  className={`px-4 py-2.5 ${idx < (server.tools?.length ?? 0) - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
                >
                  <Text className="font-mono text-xs font-medium">{tool.name}</Text>
                  {tool.description && (
                    <Muted className="text-xs mt-0.5">{tool.description}</Muted>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Actions */}
          <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
            {/* Reconnect / Test */}
            <Pressable
              onPress={onRefresh}
              className="flex-row items-center gap-3 px-4 py-3.5 active:bg-neutral-50 dark:active:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-800"
            >
              <RefreshCw size={18} color={colors.primary} />
              <Text className="text-sm" style={{ color: colors.primary }}>Reconnect</Text>
            </Pressable>

            {/* Authenticate (OAuth only) */}
            {isOAuth && (
              <Pressable
                onPress={handleAuthenticate}
                className="flex-row items-center gap-3 px-4 py-3.5 active:bg-neutral-50 dark:active:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-800"
              >
                <LogIn size={18} color={colors.primary} />
                <Text className="text-sm" style={{ color: colors.primary }}>
                  {isConnected ? "Re-authenticate" : "Authenticate"}
                </Text>
              </Pressable>
            )}

            {/* Clear auth (OAuth only, when connected) */}
            {isOAuth && isConnected && (
              <Pressable
                onPress={handleClearAuth}
                className="flex-row items-center gap-3 px-4 py-3.5 active:bg-neutral-50 dark:active:bg-neutral-800"
              >
                <LogOut size={18} color={colors.destructive} />
                <Text className="text-sm" style={{ color: colors.destructive }}>Clear Authentication</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </DetailLayout>
  );
}
