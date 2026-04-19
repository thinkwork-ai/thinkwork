import React, { useEffect } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Search } from "lucide-react-native";
import { IconBrain } from "@tabler/icons-react-native";
import { Muted } from "@/components/ui/typography";
import { useMobileMemorySearch } from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import { CaptureRow, type CaptureRowItem } from "./CaptureRow";

interface CapturesListProps {
	agentId: string | null | undefined;
	colors: (typeof COLORS)["dark"];
	/**
	 * Debounced search query. When empty, the list renders an empty
	 * "search your memories" state. When non-empty, it hits the
	 * mobileMemorySearch resolver (Hindsight recall scoped to the
	 * active agent's bank).
	 *
	 * Raw quick-capture rows are never surfaced here — they write
	 * through to Hindsight and appear only via search.
	 */
	searchQuery?: string;
}

export function CapturesList({ agentId, colors, searchQuery }: CapturesListProps) {
	const trimmedQuery = (searchQuery || "").trim();
	const isSearching = trimmedQuery.length > 0;

	const { results, loading, error, refetch } = useMobileMemorySearch({
		agentId,
		query: trimmedQuery,
	});

	// Surface search errors in Metro logs so we can diagnose "empty but
	// actually a network/auth failure" vs "genuinely zero hits".
	useEffect(() => {
		if (!error) return;
		console.warn(
			`[CapturesList] search error query=${JSON.stringify(trimmedQuery)} agentId=${agentId} error=${error.message}`,
			error,
		);
	}, [error, trimmedQuery, agentId]);

	const rows: CaptureRowItem[] = isSearching
		? results.map((r) => ({
				id: r.id,
				content: r.content,
				factType: r.factType,
				capturedAt: r.capturedAt,
				status: "synced" as const,
			}))
		: [];

	if (!isSearching) {
		return (
			<View className="flex-1 items-center justify-center px-6 gap-2">
				<IconBrain size={32} color={colors.mutedForeground} />
				<Muted>Search your memories</Muted>
			</View>
		);
	}

	if (rows.length === 0) {
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
			data={rows}
			keyExtractor={(item) => item.id}
			renderItem={({ item }) => (
				<CaptureRow item={item} colors={colors} />
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
