import React, { useCallback, useMemo } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Search } from "lucide-react-native";
import { IconBrain } from "@tabler/icons-react-native";
import { Muted } from "@/components/ui/typography";
import {
	useDeleteMobileMemoryCapture,
	useMobileMemoryCaptures,
	useMobileMemorySearch,
	type MobileMemoryCapture,
} from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import { CaptureRow, type CaptureRowItem } from "./CaptureRow";
import { captureQueue } from "@/lib/offline/capture-queue";
import { useCaptureQueue } from "@/lib/offline/use-capture-queue";
import { toast } from "@/components/ui/toast";

interface CapturesListProps {
	agentId: string | null | undefined;
	colors: (typeof COLORS)["dark"];
	/**
	 * Debounced search query. When empty (or whitespace), the list shows
	 * the captures feed. When non-empty, the list replaces captures with
	 * Hindsight recall results scoped to the agent's bank.
	 */
	searchQuery?: string;
}

export function CapturesList({ agentId, colors, searchQuery }: CapturesListProps) {
	const trimmedQuery = (searchQuery || "").trim();
	const isSearching = trimmedQuery.length > 0;

	const { captures, loading: capturesLoading, refetch: refetchCaptures } =
		useMobileMemoryCaptures({ agentId });
	const { results: searchResults, loading: searchLoading, refetch: refetchSearch } =
		useMobileMemorySearch({ agentId, query: trimmedQuery });
	const queueEntries = useCaptureQueue();
	const deleteCapture = useDeleteMobileMemoryCapture();

	const rows = useMemo<CaptureRowItem[]>(() => {
		if (isSearching) {
			return searchResults.map((r) => ({
				id: r.id,
				content: r.content,
				factType: r.factType,
				capturedAt: r.capturedAt,
				status: "synced" as const,
			}));
		}
		return mergeRows(captures, queueEntries, agentId);
	}, [isSearching, searchResults, captures, queueEntries, agentId]);

	const loading = isSearching ? searchLoading : capturesLoading;
	const refetch = isSearching ? refetchSearch : refetchCaptures;

	const handleDelete = useCallback(
		async (item: CaptureRowItem) => {
			// In search mode we surface the whole agent bank, including chat-derived
			// units. Don't wire delete on search rows — the mobile delete endpoint
			// is scoped to quick-capture entries only and would reject most of them.
			if (isSearching) return;
			// Local-only row (never made it to the server): drop from queue.
			if (item.clientCaptureId && !isSyncedServerRow(item, captures)) {
				await captureQueue.remove(item.clientCaptureId);
				return;
			}
			if (!agentId) return;
			try {
				await deleteCapture({ agentId, captureId: item.id });
				if (item.clientCaptureId) {
					await captureQueue.remove(item.clientCaptureId);
				}
				refetch();
			} catch (err) {
				const message = err instanceof Error ? err.message : "Try again in a moment.";
				toast.show({ message: `Couldn't delete: ${message}`, tone: "error", durationMs: 3000 });
			}
		},
		[isSearching, agentId, captures, deleteCapture, refetch],
	);

	const handleRetry = useCallback((clientCaptureId: string) => {
		captureQueue.retry(clientCaptureId);
	}, []);

	if (rows.length === 0) {
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
				<Muted>No memories yet</Muted>
			</View>
		);
	}

	return (
		<FlatList
			data={rows}
			keyExtractor={(item) => item.id}
			renderItem={({ item }) => (
				<CaptureRow
					item={item}
					colors={colors}
					onRetry={handleRetry}
					onDelete={handleDelete}
				/>
			)}
			refreshControl={
				<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.mutedForeground} />
			}
		/>
	);
}

function isSyncedServerRow(item: CaptureRowItem, serverCaptures: MobileMemoryCapture[]): boolean {
	if (item.status !== "synced") return false;
	return serverCaptures.some((c) => c.id === item.id);
}

function mergeRows(
	serverCaptures: MobileMemoryCapture[],
	queueEntries: ReturnType<typeof useCaptureQueue>,
	_agentId: string | null | undefined,
): CaptureRowItem[] {
	const byKey = new Map<string, CaptureRowItem>();

	// Server captures — canonical source after refetch.
	for (const c of serverCaptures) {
		const meta = parseMetadata(c.metadata);
		const cid = typeof meta.client_capture_id === "string" ? meta.client_capture_id : undefined;
		byKey.set(c.id, {
			id: c.id,
			clientCaptureId: cid,
			content: c.content,
			factType: c.factType,
			capturedAt: c.capturedAt,
			status: "synced",
		});
	}

	// Overlay queue state: pending entries show their progress, just-synced
	// entries fill in the gap while the server query catches up.
	for (const e of queueEntries) {
		if (e.status === "synced") {
			if (e.syncedId && !byKey.has(e.syncedId)) {
				byKey.set(e.syncedId, {
					id: e.syncedId,
					clientCaptureId: e.clientCaptureId,
					content: e.content,
					factType: e.factType,
					capturedAt: e.capturedAt,
					status: "synced",
				});
			}
			continue;
		}
		// Unsynced: remove any server row that already claims this clientCaptureId
		// so the pending/failed/saving state shows instead of a stale synced row.
		for (const [key, row] of byKey) {
			if (row.clientCaptureId && row.clientCaptureId === e.clientCaptureId) {
				byKey.delete(key);
			}
		}
		byKey.set(e.clientCaptureId, {
			id: e.clientCaptureId,
			clientCaptureId: e.clientCaptureId,
			content: e.content,
			factType: e.factType,
			capturedAt: e.capturedAt,
			status: e.status,
		});
	}

	return [...byKey.values()].sort(
		(a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt),
	);
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}
