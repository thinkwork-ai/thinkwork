import React, { useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, RefreshControl, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import {
  useContextQuery,
  type ContextEngineHit,
  type ContextProviderStatus,
} from "@thinkwork/react-native-sdk";
import { Muted } from "@/components/ui/typography";
import type { COLORS } from "@/lib/theme";
import { WikiList } from "@/components/wiki/WikiList";
import { WikiGraphView } from "@/components/wiki/graph";
import { rememberBrainMemoryHit } from "@/lib/brain-memory-detail-store";
import { BrainResultRow } from "./BrainResultRow";
import type { BrainMode } from "./types";

interface BrainSearchSurfaceProps {
  apiBaseUrl: string;
  mode: BrainMode;
  query: string;
  tenantId: string | null | undefined;
  userId: string | null | undefined;
  agentId: string | null | undefined;
  getToken?: () => Promise<string | null>;
  colors: (typeof COLORS)["dark"];
  graphFontsLoaded: boolean;
  graphShowLabels: boolean;
  onProviderStatusesChange?: (providers: ContextProviderStatus[]) => void;
}

function pageRouteForHit(hit: ContextEngineHit): string | null {
  const page = hit.metadata?.page as
    | { type?: string | null; slug?: string | null }
    | undefined;
  const provenance = hit.provenance.metadata as
    | { type?: string | null; slug?: string | null }
    | undefined;
  const type = page?.type ?? provenance?.type;
  const slug = page?.slug ?? provenance?.slug;
  if (!type || !slug) return null;
  return `/wiki/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`;
}

function isMemoryHit(hit: ContextEngineHit): boolean {
  return (hit.sourceFamily ?? hit.family) === "memory";
}

export function BrainSearchSurface({
  apiBaseUrl,
  mode,
  query,
  tenantId,
  userId,
  agentId,
  getToken,
  colors,
  graphFontsLoaded,
  graphShowLabels,
  onProviderStatusesChange,
}: BrainSearchSurfaceProps) {
  const router = useRouter();
  const providerSignatureRef = useRef("");
  const trimmedQuery = query.trim();
  const search = useContextQuery({
    apiBaseUrl,
    query: trimmedQuery,
    scope: "auto",
    depth: "quick",
    limit: 20,
  });

  const runSearch = useCallback(async () => {
    if (getToken) await getToken();
    return search.run();
  }, [getToken, search.run]);

  useEffect(() => {
    if (mode !== "search" || !trimmedQuery) return;
    void runSearch().catch((error) => {
      console.warn("[BrainSearchSurface] search failed", error);
    });
  }, [mode, runSearch, trimmedQuery]);

  const handleRefresh = useCallback(() => {
    if (mode === "search" && trimmedQuery) {
      void runSearch().catch((error) => {
        console.warn("[BrainSearchSurface] refresh failed", error);
      });
    }
  }, [mode, runSearch, trimmedQuery]);

  const handlePress = useCallback(
    (hit: ContextEngineHit) => {
      const route = pageRouteForHit(hit);
      if (route) {
        router.push(
          userId ? `${route}?userId=${encodeURIComponent(userId)}` : route,
        );
        return;
      }

      if (isMemoryHit(hit)) {
        rememberBrainMemoryHit(hit);
        router.push(`/brain/memory/${encodeURIComponent(hit.id)}`);
      }
    },
    [router, userId],
  );

  useEffect(() => {
    if (!onProviderStatusesChange) return;
    const providers = mode === "search" ? search.providers : [];
    const signature = providers
      .map((provider) =>
        [
          provider.providerId,
          provider.state,
          provider.hitCount ?? 0,
          provider.durationMs ?? 0,
          provider.error ?? "",
          provider.reason ?? "",
        ].join(":"),
      )
      .join("|");
    if (signature === providerSignatureRef.current) return;
    providerSignatureRef.current = signature;
    onProviderStatusesChange(providers);
  }, [mode, onProviderStatusesChange, search.providers]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {mode === "pages" ? (
        <WikiList
          userId={userId}
          agentId={agentId}
          colors={colors}
          searchQuery={trimmedQuery}
        />
      ) : mode === "graph" && tenantId && userId && graphFontsLoaded ? (
        <WikiGraphView
          tenantId={tenantId}
          userId={userId}
          searchQuery={trimmedQuery}
          showLabels={graphShowLabels}
        />
      ) : mode === "graph" ? (
        <View className="flex-1 items-center justify-center px-6 gap-2">
          <ActivityIndicator size="large" color={colors.primary} />
          <Muted>Loading graph…</Muted>
        </View>
      ) : !trimmedQuery ? (
        <View className="flex-1 items-center justify-center px-6 gap-2">
          <Search size={32} color={colors.mutedForeground} />
          <Muted>Search the Brain</Muted>
        </View>
      ) : search.error ? (
        <View className="flex-1 items-center justify-center px-6 gap-2">
          <Search size={32} color={colors.mutedForeground} />
          <Muted>Couldn't search Brain</Muted>
          <Muted>{search.error.message}</Muted>
        </View>
      ) : search.results.length === 0 ? (
        <View style={{ flex: 1 }}>
          <View className="flex-1 items-center justify-center px-6 gap-2">
            {search.loading ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : (
              <Search size={32} color={colors.mutedForeground} />
            )}
            <Muted>
              {search.loading
                ? `Searching for "${trimmedQuery}"…`
                : `No Brain results for "${trimmedQuery}"`}
            </Muted>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlashList
            data={search.results}
            keyExtractor={(hit) => hit.id}
            renderItem={({ item }) => (
              <BrainResultRow
                hit={item}
                colors={colors}
                onPress={
                  pageRouteForHit(item) || isMemoryHit(item)
                    ? handlePress
                    : undefined
                }
              />
            )}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
            ItemSeparatorComponent={() => (
              <View
                className="h-px bg-neutral-200 dark:bg-neutral-800"
                style={{ marginLeft: 68 }}
              />
            )}
            refreshControl={
              <RefreshControl
                refreshing={search.loading}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
              />
            }
          />
        </View>
      )}
    </View>
  );
}
