/**
 * Integrations section of the Credential Locker — per-user OAuth providers
 * (Google Workspace, Microsoft 365) that feed the built-in agent skills.
 *
 * One flat "Connected Accounts" list, one row per provider. No leading icons.
 * The status badge carries the action:
 *   - "Connect" (outline) → taps fire the OAuth authorize flow
 *   - "Active"  (green)   → taps open the disconnect confirmation
 *   - "Expired" (yellow)  → taps fire reconnect
 *
 * Parent (`apps/mobile/app/settings/credentials.tsx`) owns the ScrollView +
 * RefreshControl. Pull-to-refresh signals via the `refreshSignal` prop.
 */

import { useEffect } from "react";
import { View, Pressable, Alert } from "react-native";
import { useColorScheme } from "nativewind";
import * as WebBrowser from "expo-web-browser";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { COLORS } from "@/lib/theme";
import { useMe } from "@/lib/hooks/use-users";
import { useConnections } from "@/lib/hooks/use-connections";

const API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(/\/graphql$/, "");
const GRAPHQL_API_KEY = process.env.EXPO_PUBLIC_GRAPHQL_API_KEY || "";

// Deep-link scheme used as `returnUrl` so `oauth-callback` redirects back into
// the app at the end of consent. `openAuthSessionAsync` auto-closes the in-app
// browser when this URL fires. NEVER pass `preferEphemeralSession: true` — per
// feedback_mobile_oauth_ephemeral_session it kills iOS credential prefills.
const RETURN_SCHEME = "thinkwork://settings/credentials";

type Props = {
  refreshSignal: number;
};

export function IntegrationsSection({ refreshSignal }: Props) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [meResult] = useMe();
  const user = meResult.data?.me ?? undefined;
  const tenantId = user?.tenantId ?? undefined;

  const { connections, loading, refetch: refetchConnections } = useConnections();

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

  const handleDisconnect = (connectionId: string, providerName: string) => {
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

  const handleReconnect = (providerName: string) => {
    if (providerName === "google_productivity") return handleConnectGoogle();
    if (providerName === "microsoft_365") return handleConnectMicrosoft();
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

  const connByProvider = new Map(
    (connections || [])
      .filter((c) => c.status === "active" || c.status === "expired")
      .map((c) => [c.provider_name, c]),
  );

  const PROVIDERS = [
    {
      name: "google_productivity",
      displayName: "Google Workspace",
      subtitle: "Gmail + Google Calendar",
      onConnect: handleConnectGoogle,
    },
    {
      name: "microsoft_365",
      displayName: "Microsoft 365",
      subtitle: "Outlook + Calendar",
      onConnect: handleConnectMicrosoft,
    },
  ] as const;

  return (
    <View style={{ gap: 16 }}>
      <Text className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-1">
        Connected Accounts
      </Text>
      <View className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        {PROVIDERS.map((provider, idx) => {
          const conn = connByProvider.get(provider.name);
          const isConnected = !!conn;
          const isExpired = conn?.status === "expired";
          const subtitle = conn?.external_id || provider.subtitle;

          // Badge action: Active → disconnect dialog; Expired → reconnect; otherwise → connect.
          const onBadgePress = () => {
            if (isExpired) return handleReconnect(provider.name);
            if (isConnected && conn) return handleDisconnect(conn.id, conn.provider_display_name);
            return provider.onConnect();
          };
          const badgeLabel = isExpired ? "Expired" : isConnected ? "Active" : "Connect";
          // Active/Expired use filled badges for stronger visual weight; Connect stays outline.
          const badgeContainer = isConnected
            ? `px-2.5 py-1 rounded-full ${isExpired ? "bg-yellow-500/20" : "bg-green-500/20"}`
            : "";
          const badgeText = isExpired
            ? "text-yellow-400 font-medium"
            : isConnected
              ? "text-green-400 font-medium"
              : "";

          return (
            <View
              key={provider.name}
              className={`px-4 py-3 flex-row items-center ${idx < PROVIDERS.length - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
            >
              <View className="flex-1">
                <Text className="font-medium text-neutral-900 dark:text-neutral-100">
                  {provider.displayName}
                </Text>
                <Muted className="text-xs">{subtitle}</Muted>
              </View>
              <Pressable onPress={onBadgePress} hitSlop={8}>
                {isConnected ? (
                  <View className={badgeContainer}>
                    <Text className={`text-xs ${badgeText}`}>{badgeLabel}</Text>
                  </View>
                ) : (
                  <Badge variant="outline" className="px-2 py-0.5" textClassName="text-xs">
                    {badgeLabel}
                  </Badge>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
