import React, { useCallback, useEffect } from "react";
import { ActivityIndicator, RefreshControl, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { IconBrain } from "@tabler/icons-react-native";
import { Text, Muted } from "@/components/ui/typography";
import {
	useMobileMemorySearch,
	useRecentWikiPages,
	type WikiSearchHit,
} from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import { WikiResultRow } from "./WikiResultRow";

interface WikiListProps {
	userId: string | null | undefined;
	/** @deprecated Use userId. */
	agentId?: string | null | undefined;
	colors: (typeof COLORS)["dark"];
	searchQuery?: string;
}

export function WikiList({ userId, agentId, colors, searchQuery }: WikiListProps) {
	const router = useRouter();
	const scopeUserId = userId ?? agentId;
	const trimmedQuery = (searchQuery || "").trim();
	const isSearching = trimmedQuery.length > 0;

	const search = useMobileMemorySearch({ userId: scopeUserId, agentId, query: trimmedQuery });
	const recent = useRecentWikiPages({ userId: scopeUserId, agentId, limit: 50 });

	const { results, loading, error, refetch } = isSearching ? search : recent;

	// A new query means a new list — remount FlashList so it starts from
	// offset 0 instead of inheriting the previous list's scroll position.
	// scrollToOffset on the existing list ran too early (before FlashList
	// swapped its data) and left the old offset in place.
	const listKey = isSearching ? `search:${trimmedQuery}` : "recent";

	useEffect(() => {
		if (!error) return;
		console.warn(
			`[WikiList] ${isSearching ? "search" : "recent"} error query=${JSON.stringify(trimmedQuery)} userId=${scopeUserId} error=${error.message}`,
			error,
		);
	}, [error, isSearching, trimmedQuery, scopeUserId]);

	const handlePress = useCallback(
		(hit: WikiSearchHit) => {
			const path = `/wiki/${encodeURIComponent(hit.type)}/${encodeURIComponent(hit.slug)}`;
			router.push(scopeUserId ? `${path}?userId=${encodeURIComponent(scopeUserId)}` : path);
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
				<View className="flex-1 items-center justify-center px-6 gap-2">
					{loading ? (
						<ActivityIndicator size="large" color={colors.primary} />
					) : (
						<Search size={32} color={colors.mutedForeground} />
					)}
					<Muted>
						{loading ? `Searching for "${trimmedQuery}"…` : `No wiki pages matching "${trimmedQuery}"`}
					</Muted>
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
				data={results}
				keyExtractor={(hit) => hit.id}
				renderItem={({ item }) => (
					<WikiResultRow hit={item} colors={colors} onPress={handlePress} />
				)}
				contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
				ItemSeparatorComponent={() => (
					<View className="h-px bg-neutral-200 dark:bg-neutral-800" style={{ marginLeft: 68 }} />
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
						<Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "500" }}>
							Searching…
						</Text>
					</View>
				</View>
			) : null}
		</View>
	);
}
