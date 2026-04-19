import React, { useCallback, useEffect } from "react";
import { RefreshControl, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { IconBrain } from "@tabler/icons-react-native";
import { Muted } from "@/components/ui/typography";
import {
	useMobileMemorySearch,
	useRecentWikiPages,
	type WikiSearchHit,
} from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import { WikiResultRow } from "./WikiResultRow";

interface CapturesListProps {
	agentId: string | null | undefined;
	colors: (typeof COLORS)["dark"];
	searchQuery?: string;
}

export function CapturesList({ agentId, colors, searchQuery }: CapturesListProps) {
	const router = useRouter();
	const trimmedQuery = (searchQuery || "").trim();
	const isSearching = trimmedQuery.length > 0;

	const search = useMobileMemorySearch({ agentId, query: trimmedQuery });
	const recent = useRecentWikiPages({ agentId, limit: 50 });

	const { results, loading, error, refetch } = isSearching ? search : recent;

	useEffect(() => {
		if (!error) return;
		console.warn(
			`[CapturesList] ${isSearching ? "search" : "recent"} error query=${JSON.stringify(trimmedQuery)} agentId=${agentId} error=${error.message}`,
			error,
		);
	}, [error, isSearching, trimmedQuery, agentId]);

	const handlePress = useCallback(
		(hit: WikiSearchHit) => {
			const path = `/wiki/${encodeURIComponent(hit.type)}/${encodeURIComponent(hit.slug)}`;
			router.push(agentId ? `${path}?agentId=${encodeURIComponent(agentId)}` : path);
		},
		[router, agentId],
	);

	if (results.length === 0) {
		if (isSearching) {
			return (
				<View className="flex-1 items-center justify-center px-6 gap-2">
					<Search size={32} color={colors.mutedForeground} />
					<Muted>
						{loading ? "Searching..." : `No memories matching "${trimmedQuery}"`}
					</Muted>
				</View>
			);
		}
		return (
			<View className="flex-1 items-center justify-center px-6 gap-2">
				<IconBrain size={32} color={colors.mutedForeground} />
				<Muted>{loading ? "Loading memories..." : "No memories yet"}</Muted>
			</View>
		);
	}

	return (
		<FlashList
			data={results}
			keyExtractor={(hit) => hit.id}
			renderItem={({ item }) => (
				<WikiResultRow hit={item} colors={colors} onPress={handlePress} />
			)}
			ItemSeparatorComponent={() => (
				<View className="h-px bg-neutral-200 dark:bg-neutral-800" />
			)}
			refreshControl={
				<RefreshControl
					refreshing={loading}
					onRefresh={refetch}
					tintColor={colors.mutedForeground}
				/>
			}
		/>
	);
}
