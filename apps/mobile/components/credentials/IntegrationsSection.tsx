/**
 * Integrations section of the Credentials Locker — per-user OAuth providers
 * (Google Workspace, Microsoft 365) that feed the built-in agent skills.
 *
 * This used to be a standalone screen at `apps/mobile/app/settings/integrations.tsx`.
 * It's now a pure section rendered inside `apps/mobile/app/settings/credentials.tsx`,
 * with the ScrollView + pull-to-refresh owned by the parent. The section refreshes
 * via the `refreshSignal` prop: each increment triggers the Connections hook to
 * revalidate.
 */

import { useEffect } from "react";
import { View, Pressable, Alert } from "react-native";
import { useColorScheme } from "nativewind";
import * as WebBrowser from "expo-web-browser";
import { Mail, Calendar, Link2, Link2Off, AlertTriangle, RefreshCw } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { COLORS } from "@/lib/theme";
import { useMe } from "@/lib/hooks/use-users";
import { useConnections } from "@/lib/hooks/use-connections";

const API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(/\/graphql$/, "");
const GRAPHQL_API_KEY = process.env.EXPO_PUBLIC_GRAPHQL_API_KEY || "";

const PROVIDER_ICONS: Record<string, typeof Mail> = {
  google_productivity: Mail,
  microsoft_365: Calendar,
};

// Deep-link scheme used as `returnUrl` so `oauth-callback` redirects back into
// the app at the end of consent. `openAuthSessionAsync` auto-closes the in-app
// browser when this URL fires. Matches the MCP OAuth pattern in
// `apps/mobile/app/settings/mcp-server-detail.tsx`. NEVER pass
// `preferEphemeralSession: true` — per feedback_mobile_oauth_ephemeral_session
// it kills iOS credential prefills and forces a full reauth every time.
const RETURN_SCHEME = "thinkwork://settings/credentials";

type Props = {
  /** Parent increments this to force a refetch (pull-to-refresh). */
  refreshSignal: number;
};

export function IntegrationsSection({ refreshSignal }: Props) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [meResult] = useMe();
  const user = meResult.data?.me ?? undefined;
  const tenantId = user?.tenantId ?? undefined;

  const { connections, loading, refetch: refetchConnections } = useConnections();

  // Re-run the connections fetch whenever the parent bumps the refresh signal.
  useEffect(() => {
    if (refreshSignal > 0) void refetchConnections();
  }, [refreshSignal, refetchConnections]);

  const handleConnectGoogle = async () => {
    if (!tenantId || !user?.id) return;
    const url = `${API_BASE}/api/oauth/authorize?provider=google_productivity&userId=${user.id}&tenantId=${tenantId}&returnUrl=${encodeURIComponent(RETURN_SCHEME)}`;
    await WebBrowser.openAuthSessionAsync(url, RETURN_SCHEME);
    await refetchConnections();
  };

  const handleConnectMicrosoft = async () => {
    if (!tenantId || !user?.id) return;
    const url = `${API_BASE}/api/oauth/authorize?provider=microsoft_365&userId=${user.id}&tenantId=${tenantId}&returnUrl=${encodeURIComponent(RETURN_SCHEME)}`;
    await WebBrowser.openAuthSessionAsync(url, RETURN_SCHEME);
    await refetchConnections();
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
                  "x-tenant-id": tenantId || "",
                },
              });
              await refetchConnections();
            } catch (err) {
              console.error("[integrations-section] Disconnect failed:", err);
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
    }
  };

  if (loading) {
    return (
      <View>
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl mb-3" />
        ))}
      </View>
    );
  }

  // Only active / expired connections show as "connected"; filter out inactive/pending.
  const activeConnections = (connections || []).filter(
    (c) => c.status === "active" || c.status === "expired",
  );
  const connectedProviders = new Set(activeConnections.map((c) => c.provider_name));

  return (
    <View style={{ gap: 16 }}>
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

                  <View className="mt-2 flex-row items-center justify-between">
                    {lastSync ? (
                      <Muted className="text-xs">
                        Last sync: {new Date(lastSync as string).toLocaleString()}
                      </Muted>
                    ) : (
                      <View />
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

      {/* Available providers to connect. Drops out entirely once all are connected. */}
      {(!connectedProviders.has("google_productivity") || !connectedProviders.has("microsoft_365")) && (
        <View>
          <Text className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-2 px-1">
            {activeConnections.length > 0 ? "Add More" : "Integrations"}
          </Text>
          <View className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
            {!connectedProviders.has("google_productivity") && (
              <Pressable
                onPress={handleConnectGoogle}
                className={`flex-row items-center px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${!connectedProviders.has("microsoft_365") ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
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
          </View>
        </View>
      )}
    </View>
  );
}
