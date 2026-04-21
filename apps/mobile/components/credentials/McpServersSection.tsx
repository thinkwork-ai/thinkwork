/**
 * MCP Servers section of the Credentials Locker — external Model Context
 * Protocol servers connected per-user via OAuth 2.1 / DCR (WorkOS) or tenant
 * API keys.
 *
 * This used to be a standalone screen at `apps/mobile/app/settings/mcp-servers.tsx`.
 * It's now a pure section rendered inside `apps/mobile/app/settings/credentials.tsx`,
 * with the ScrollView + pull-to-refresh owned by the parent. The section refreshes
 * via the `refreshSignal` prop. Per-server detail lives in `mcp-server-detail.tsx`
 * (unchanged).
 */

import { useCallback, useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Cable, ChevronRight } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { COLORS } from "@/lib/theme";
import { useMe } from "@/lib/hooks/use-users";

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

type Props = {
  /** Parent increments this to force a refetch (pull-to-refresh). */
  refreshSignal: number;
};

export function McpServersSection({ refreshSignal }: Props) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();

  const [meResult] = useMe();
  const user = meResult.data?.me ?? undefined;
  const tenantId = user?.tenantId ?? undefined;

  const [servers, setServers] = useState<McpServerRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchServers = useCallback(async () => {
    // Don't hang on skeleton if tenant/user aren't resolved yet — release
    // the gate and let the effect re-fire when they are.
    if (!tenantId || !user?.id) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/skills/user-mcp-servers`, {
        headers: {
          "x-api-key": GRAPHQL_API_KEY,
          "x-tenant-id": tenantId,
          "x-principal-id": user.id,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers || []);
      }
    } catch (err) {
      console.error("[mcp-servers-section] Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void fetchServers();
    }, [fetchServers]),
  );

  // Re-fetch when parent bumps the refresh signal (pull-to-refresh).
  useEffect(() => {
    if (refreshSignal > 0) void fetchServers();
  }, [refreshSignal, fetchServers]);

  if (loading) {
    return (
      <View>
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl mb-3" />
        ))}
      </View>
    );
  }

  const oauthServers = (servers || []).filter((s) => s.authType === "oauth");
  const readyServers = (servers || []).filter((s) => s.authType !== "oauth" || s.authStatus === "active");
  const needsAction = oauthServers.filter((s) => s.authStatus !== "active");

  return (
    <View style={{ gap: 16 }}>
      <Text className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-1">
        MCP Servers
      </Text>

      {(!servers || servers.length === 0) && (
        <View className="items-center py-8 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
          <Cable size={32} color={colors.mutedForeground} />
          <Muted className="mt-3 text-center px-6">
            No MCP servers assigned to your agents yet. Ask your admin to set up MCP tool connectors.
          </Muted>
        </View>
      )}

      {needsAction.length > 0 && (
        <View>
          <Text className="text-xs font-medium text-yellow-500 mb-2 px-1">Needs Connection</Text>
          <View className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
            {needsAction.map((server, idx) => (
              <Pressable
                key={server.id}
                onPress={() => router.push({ pathname: "/settings/mcp-server-detail", params: { id: server.id } })}
                className={`flex-row items-center px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${idx < needsAction.length - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
              >
                <View className="flex-1">
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

      {readyServers.length > 0 && (
        <View>
          <Text className="text-xs font-medium text-green-500 mb-2 px-1">Active</Text>
          <View className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
            {readyServers.map((server, idx) => (
              <Pressable
                key={server.id}
                onPress={() => router.push({ pathname: "/settings/mcp-server-detail", params: { id: server.id } })}
                className={`flex-row items-center px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${idx < readyServers.length - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
              >
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
                <Badge
                  variant="outline"
                  className="px-2 py-0.5 border-green-500/30 mr-2"
                  textClassName="text-xs text-green-400"
                >
                  Active
                </Badge>
                <ChevronRight size={16} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
