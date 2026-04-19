import React from "react";
import { Pressable, View } from "react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { COLORS } from "@/lib/theme";

export type CaptureRowItem = {
	id: string;
	content: string;
	factType: "FACT" | "PREFERENCE" | "EXPERIENCE" | "OBSERVATION";
	capturedAt: string;
	status: "synced";
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
}

export function CaptureRow({ item, colors }: CaptureRowProps) {
	const relativeTime = formatRelative(item.capturedAt);
	return (
		<Pressable
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
		</Pressable>
	);
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
