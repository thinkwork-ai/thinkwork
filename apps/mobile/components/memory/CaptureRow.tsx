import React from "react";
import { Alert, ActivityIndicator, Pressable, View } from "react-native";
import { CloudOff, AlertCircle } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { COLORS } from "@/lib/theme";
import type { CaptureQueueStatus } from "@/lib/offline/capture-queue";

export type CaptureRowItem = {
	id: string;                 // synced Hindsight id OR clientCaptureId for local-only
	clientCaptureId?: string;   // present when row has a local queue entry
	content: string;
	factType: "FACT" | "PREFERENCE" | "EXPERIENCE" | "OBSERVATION";
	capturedAt: string;         // ISO 8601
	status: CaptureQueueStatus; // "synced" for server-only rows
};

const FACT_TYPE_LABELS: Record<CaptureRowItem["factType"], string> = {
	FACT: "Fact",
	PREFERENCE: "Preference",
	EXPERIENCE: "Experience",
	OBSERVATION: "Observation",
};

interface CaptureRowProps {
	item: CaptureRowItem;
	colors: (typeof COLORS)["dark"];
	onRetry?: (clientCaptureId: string) => void;
	onDelete?: (item: CaptureRowItem) => void;
}

export function CaptureRow({ item, colors, onRetry, onDelete }: CaptureRowProps) {
	const relativeTime = formatRelative(item.capturedAt);

	const handleLongPress = () => {
		if (!onDelete) return;
		Alert.alert(
			"Delete this memory?",
			item.content.length > 80 ? `${item.content.slice(0, 80)}…` : item.content,
			[
				{ text: "Cancel", style: "cancel" },
				{ text: "Delete", style: "destructive", onPress: () => onDelete(item) },
			],
		);
	};

	const handlePress = () => {
		if (item.status === "failed" && item.clientCaptureId && onRetry) {
			onRetry(item.clientCaptureId);
		}
	};

	return (
		<Pressable
			onPress={handlePress}
			onLongPress={handleLongPress}
			style={({ pressed }) => ({
				paddingHorizontal: 16,
				paddingVertical: 12,
				backgroundColor: pressed ? colors.secondary : "transparent",
				borderBottomWidth: 1,
				borderBottomColor: colors.border,
				flexDirection: "row",
				alignItems: "flex-start",
				gap: 12,
			})}
		>
			<View style={{ flex: 1, gap: 4 }}>
				<Text numberOfLines={2} style={{ fontSize: 15, lineHeight: 20, color: colors.foreground }}>
					{item.content}
				</Text>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Badge variant="secondary">
						<Text style={{ fontSize: 11, color: colors.mutedForeground }}>
							{FACT_TYPE_LABELS[item.factType]}
						</Text>
					</Badge>
					<Muted style={{ fontSize: 12 }}>{relativeTime}</Muted>
				</View>
			</View>
			<StatusIndicator status={item.status} colors={colors} />
		</Pressable>
	);
}

function StatusIndicator({
	status,
	colors,
}: {
	status: CaptureQueueStatus;
	colors: (typeof COLORS)["dark"];
}) {
	if (status === "saving") {
		return <ActivityIndicator size="small" color={colors.mutedForeground} />;
	}
	if (status === "sync_pending") {
		return <CloudOff size={16} color={colors.mutedForeground} />;
	}
	if (status === "failed") {
		return <AlertCircle size={16} color={colors.destructive} />;
	}
	return null;
}

function formatRelative(iso: string): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return "";
	const diff = Date.now() - t;
	const abs = Math.abs(diff);
	const min = 60_000;
	const hr = 60 * min;
	const day = 24 * hr;
	if (abs < min) return "just now";
	if (abs < hr) return `${Math.round(abs / min)}m ago`;
	if (abs < day) return `${Math.round(abs / hr)}h ago`;
	if (abs < 7 * day) return `${Math.round(abs / day)}d ago`;
	return new Date(t).toLocaleDateString();
}
