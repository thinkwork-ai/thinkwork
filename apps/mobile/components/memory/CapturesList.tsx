import React, { useEffect } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Search } from "lucide-react-native";
import { IconBrain } from "@tabler/icons-react-native";
import { Muted } from "@/components/ui/typography";
import { useMobileMemorySearch } from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import { WikiResultRow } from "./WikiResultRow";

interface CapturesListProps {
	tenantId: string | null | undefined;
	ownerId: string | null | undefined;
	colors: (typeof COLORS)["dark"];
	/**
	 * Debounced search query. Empty → "search your memories" empty state.
	 * Non-empty → wikiSearch hits scoped to (tenantId, ownerId).
	 */
	searchQuery?: string;
}

export function CapturesList({ tenantId, ownerId, colors, searchQuery }: CapturesListProps) {
	const trimmedQuery = (searchQuery || "").trim();
	const isSearching = trimmedQuery.length > 0;

	const { results, loading, error, refetch } = useMobileMemorySearch({
		tenantId,
		ownerId,
		query: trimmedQuery,
	});

	useEffect(() => {
		if (!error) return;
		console.warn(
			`[CapturesList] wikiSearch error query=${JSON.stringify(trimmedQuery)} tenantId=${tenantId} ownerId=${ownerId} error=${error.message}`,
			error,
		);
	}, [error, trimmedQuery, tenantId, ownerId]);

	if (!isSearching) {
		return (
			<View className="flex-1 items-center justify-center px-6 gap-2">
				<IconBrain size={32} color={colors.mutedForeground} />
				<Muted>Search your memories</Muted>
			</View>
		);
	}

	if (results.length === 0) {
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
		<FlatList
			data={results}
			keyExtractor={(hit) => hit.id}
			renderItem={({ item }) => <WikiResultRow hit={item} colors={colors} />}
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
