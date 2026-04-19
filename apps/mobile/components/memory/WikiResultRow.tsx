import React from "react";
import { Pressable, View } from "react-native";
import { Building2, Lightbulb, CheckCircle2 } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import type { MemorySearchHit, WikiPageRef } from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";

const TYPE_LABELS: Record<WikiPageRef["type"], string> = {
	ENTITY: "Entity",
	TOPIC: "Topic",
	DECISION: "Decision",
};

const TYPE_HUES: Record<WikiPageRef["type"], string> = {
	ENTITY: "#0ea5e9",
	TOPIC: "#f59e0b",
	DECISION: "#8b5cf6",
};

const TYPE_ICONS: Record<
	WikiPageRef["type"],
	React.ComponentType<{ size?: number; color?: string }>
> = {
	ENTITY: Building2,
	TOPIC: Lightbulb,
	DECISION: CheckCircle2,
};

interface WikiResultRowProps {
	hit: MemorySearchHit;
	colors: (typeof COLORS)["dark"];
	onPressWiki?: (page: WikiPageRef) => void;
}

export function WikiResultRow({ hit, colors, onPressWiki }: WikiResultRowProps) {
	const primaryPage = hit.wikiPages[0] ?? null;

	if (primaryPage) {
		const hue = TYPE_HUES[primaryPage.type];
		const Icon = TYPE_ICONS[primaryPage.type];
		return (
			<Pressable
				onPress={onPressWiki ? () => onPressWiki(primaryPage) : undefined}
				style={({ pressed }) => ({
					paddingHorizontal: 16,
					paddingVertical: 14,
					backgroundColor: pressed ? colors.secondary : "transparent",
				})}
			>
				<View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 8 }}>
					<Icon size={14} color={hue} />
					<Text
						style={{
							color: hue,
							fontSize: 11,
							fontWeight: "600",
							letterSpacing: 0.5,
							textTransform: "uppercase",
						}}
					>
						{TYPE_LABELS[primaryPage.type]}
					</Text>
				</View>
				<Text
					numberOfLines={1}
					style={{ color: colors.foreground, fontSize: 17, fontWeight: "600", marginBottom: 2 }}
				>
					{primaryPage.title}
				</Text>
				{primaryPage.summary ? (
					<Muted numberOfLines={2} style={{ fontSize: 14, lineHeight: 18 }}>
						{primaryPage.summary}
					</Muted>
				) : null}
			</Pressable>
		);
	}

	// Raw memory record — no wiki page compiled for this unit yet.
	return (
		<View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
			<View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 8 }}>
				<Text
					style={{
						color: colors.mutedForeground,
						fontSize: 11,
						fontWeight: "600",
						letterSpacing: 0.5,
						textTransform: "uppercase",
					}}
				>
					Memory
				</Text>
			</View>
			<Text numberOfLines={3} style={{ color: colors.foreground, fontSize: 15, lineHeight: 20 }}>
				{hit.content}
			</Text>
		</View>
	);
}
