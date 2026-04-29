import React, { useCallback, useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import {
  BookOpen,
  Brain,
  Cable,
  ChevronRight,
  Database,
  FolderSearch,
  Search,
} from "lucide-react-native";
import { IconBrain } from "@tabler/icons-react-native";
import { Text, Muted } from "@/components/ui/typography";
import {
  useContextQuery,
  useRecentWikiPages,
  type ContextEngineHit,
  type ContextProviderStatus,
  type WikiSearchHit,
} from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import { WikiResultRow } from "./WikiResultRow";

type WikiListItem = WikiSearchHit | ContextEngineHit;

interface WikiListProps {
  userId: string | null | undefined;
  /** @deprecated Use userId. */
  agentId?: string | null | undefined;
  colors: (typeof COLORS)["dark"];
  searchQuery?: string;
  apiBaseUrl?: string;
}

export function WikiList({
  userId,
  agentId,
  colors,
  searchQuery,
  apiBaseUrl,
}: WikiListProps) {
  const router = useRouter();
  const scopeUserId = userId ?? agentId;
  const trimmedQuery = (searchQuery || "").trim();
  const isSearching = trimmedQuery.length > 0;

  const recent = useRecentWikiPages({
    userId: scopeUserId,
    agentId,
    limit: 50,
  });
  const contextArgs = useMemo(
    () => ({
      apiBaseUrl: apiBaseUrl || "",
      query: trimmedQuery,
      mode: "results" as const,
      scope: "auto" as const,
      depth: "quick" as const,
      limit: 20,
    }),
    [apiBaseUrl, trimmedQuery],
  );
  const contextSearch = useContextQuery(contextArgs);

  const results = isSearching ? contextSearch.results : recent.results;
  const loading = isSearching ? contextSearch.loading : recent.loading;
  const error = isSearching ? contextSearch.error : recent.error;
  const refetch = isSearching
    ? () => {
        void contextSearch.run().catch(() => undefined);
      }
    : recent.refetch;

  // A new query means a new list — remount FlashList so it starts from
  // offset 0 instead of inheriting the previous list's scroll position.
  // scrollToOffset on the existing list ran too early (before FlashList
  // swapped its data) and left the old offset in place.
  const listKey = isSearching ? `search:${trimmedQuery}` : "recent";

  useEffect(() => {
    if (!error) return;
    console.warn(
      `[WikiList] ${isSearching ? "context search" : "recent"} error query=${JSON.stringify(trimmedQuery)} userId=${scopeUserId} error=${error.message}`,
      error,
    );
  }, [error, isSearching, trimmedQuery, scopeUserId]);

  useEffect(() => {
    if (!isSearching || !apiBaseUrl) return;
    void contextSearch.run().catch(() => undefined);
  }, [apiBaseUrl, contextSearch.run, isSearching]);

  const handlePress = useCallback(
    (hit: WikiSearchHit) => {
      const path = `/wiki/${encodeURIComponent(hit.type)}/${encodeURIComponent(hit.slug)}`;
      router.push(
        scopeUserId
          ? `${path}?userId=${encodeURIComponent(scopeUserId)}`
          : path,
      );
    },
    [router, scopeUserId],
  );

  const handleContextPress = useCallback(
    (hit: ContextEngineHit) => {
      const metadata = hit.provenance?.metadata ?? {};
      const slug = typeof metadata.slug === "string" ? metadata.slug : "";
      const type = typeof metadata.type === "string" ? metadata.type : "";
      if (hit.family !== "wiki" || !slug || !type) return;
      const path = `/wiki/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`;
      router.push(
        scopeUserId
          ? `${path}?userId=${encodeURIComponent(scopeUserId)}`
          : path,
      );
    },
    [router, scopeUserId],
  );

  const showSearchOverlay = isSearching && loading;

  if (!scopeUserId) {
    return (
      <View className="flex-1 items-center justify-center px-6 gap-2">
        <ActivityIndicator size="large" color={colors.primary} />
        <Muted>Loading wiki…</Muted>
      </View>
    );
  }

  if (results.length === 0) {
    if (isSearching) {
      return (
        <View className="flex-1">
          <ProviderStatusStrip
            providers={contextSearch.providers}
            colors={colors}
          />
          <View className="flex-1 items-center justify-center px-6 gap-2">
            {loading ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : (
              <Search size={32} color={colors.mutedForeground} />
            )}
            <Muted>
              {loading
                ? `Searching context for "${trimmedQuery}"…`
                : `No context matching "${trimmedQuery}"`}
            </Muted>
          </View>
        </View>
      );
    }
    return (
      <View className="flex-1 items-center justify-center px-6 gap-2">
        <IconBrain size={32} color={colors.mutedForeground} />
        <Muted>{loading ? "Loading wiki…" : "No wiki pages yet"}</Muted>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlashList
        key={listKey}
        data={results as WikiListItem[]}
        keyExtractor={(hit) => hit.id}
        renderItem={({ item }) =>
          isSearching ? (
            <ContextResultRow
              hit={item as unknown as ContextEngineHit}
              colors={colors}
              onPress={handleContextPress}
            />
          ) : (
            <WikiResultRow
              hit={item as WikiSearchHit}
              colors={colors}
              onPress={handlePress}
            />
          )
        }
        ListHeaderComponent={
          isSearching ? (
            <ProviderStatusStrip
              providers={contextSearch.providers}
              colors={colors}
            />
          ) : null
        }
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
        ItemSeparatorComponent={() => (
          <View
            className="h-px bg-neutral-200 dark:bg-neutral-800"
            style={{ marginLeft: 68 }}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={loading && !isSearching}
            onRefresh={refetch}
            tintColor={colors.mutedForeground}
          />
        }
      />
      {showSearchOverlay ? (
        <View
          pointerEvents="auto"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.45)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 20,
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: colors.secondary,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <ActivityIndicator color={colors.primary} />
            <Text
              style={{
                color: colors.foreground,
                fontSize: 15,
                fontWeight: "500",
              }}
            >
              Searching context…
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ProviderStatusStrip({
  providers,
  colors,
}: {
  providers: ContextProviderStatus[];
  colors: (typeof COLORS)["dark"];
}) {
  if (providers.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      {providers.map((provider) => (
        <View
          key={provider.providerId}
          style={{
            borderWidth: 1,
            borderColor: providerColor(provider.state),
            backgroundColor: colors.secondary,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <Text
            style={{
              color: colors.foreground,
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            {provider.displayName}
          </Text>
          <Muted style={{ fontSize: 11 }}>
            {provider.state}
            {typeof provider.hitCount === "number"
              ? ` · ${provider.hitCount}`
              : ""}
          </Muted>
        </View>
      ))}
    </ScrollView>
  );
}

function ContextResultRow({
  hit,
  colors,
  onPress,
}: {
  hit: ContextEngineHit;
  colors: (typeof COLORS)["dark"];
  onPress: (hit: ContextEngineHit) => void;
}) {
  const config = familyConfig(hit.family);
  const Icon = config.icon;
  const canOpen =
    hit.family === "wiki" && typeof hit.provenance?.metadata?.slug === "string";
  return (
    <Pressable
      onPress={canOpen ? () => onPress(hit) : undefined}
      className="flex-row items-start py-2 pr-4 active:bg-neutral-50 dark:active:bg-neutral-900"
      style={{ backgroundColor: colors.background }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", width: 56 }}>
        <View style={{ width: 16 }} />
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: config.bg,
            borderWidth: 0.25,
            borderColor: config.fg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={20} color={config.fg} />
        </View>
      </View>
      <View className="flex-1 ml-3">
        <View className="flex-row items-center justify-between">
          <Text
            className="text-xs font-mono text-primary"
            style={{ lineHeight: 14 }}
          >
            {config.label}
          </Text>
          <View className="flex-row items-center gap-1">
            <Muted className="text-xs">
              {hit.provenance?.label || hit.providerId}
            </Muted>
            {canOpen ? (
              <ChevronRight size={14} color={colors.mutedForeground} />
            ) : null}
          </View>
        </View>
        <Text
          className="text-base"
          style={{ lineHeight: 20, marginTop: -1, marginBottom: 2 }}
          numberOfLines={1}
        >
          {hit.title}
        </Text>
        <Muted style={{ fontSize: 14, lineHeight: 18 }} numberOfLines={2}>
          {hit.snippet}
        </Muted>
      </View>
    </Pressable>
  );
}

function providerColor(state: ContextProviderStatus["state"]) {
  switch (state) {
    case "ok":
      return "rgba(34,197,94,0.45)";
    case "skipped":
      return "rgba(148,163,184,0.35)";
    case "timeout":
      return "rgba(245,158,11,0.55)";
    case "error":
      return "rgba(239,68,68,0.55)";
  }
}

function familyConfig(family: ContextEngineHit["family"]) {
  switch (family) {
    case "memory":
      return {
        label: "MEMORY",
        icon: Brain,
        bg: "rgba(14,165,233,0.15)",
        fg: "#0ea5e9",
      };
    case "wiki":
      return {
        label: "WIKI",
        icon: BookOpen,
        bg: "rgba(139,92,246,0.15)",
        fg: "#8b5cf6",
      };
    case "workspace":
      return {
        label: "FILES",
        icon: FolderSearch,
        bg: "rgba(16,185,129,0.15)",
        fg: "#10b981",
      };
    case "knowledge-base":
      return {
        label: "KB",
        icon: Database,
        bg: "rgba(245,158,11,0.15)",
        fg: "#f59e0b",
      };
    case "mcp":
      return {
        label: "MCP",
        icon: Cable,
        bg: "rgba(236,72,153,0.15)",
        fg: "#ec4899",
      };
  }
}
