import React from "react";
import { Pressable, View } from "react-native";
import { Building2, Lightbulb, CheckCircle2 } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import type { WikiSearchHit } from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";

const TYPE_LABELS: Record<WikiSearchHit["type"], string> = {
	ENTITY: "Entity",
	TOPIC: "Topic",
	DECISION: "Decision",
};

const TYPE_HUES: Record<WikiSearchHit["type"], string> = {
	ENTITY: "#0ea5e9",
	TOPIC: "#f59e0b",
	DECISION: "#8b5cf6",
};

const TYPE_ICONS: Record<
	WikiSearchHit["type"],
	React.ComponentType<{ size?: number; color?: string }>
> = {
	ENTITY: Building2,
	TOPIC: Lightbulb,
	DECISION: CheckCircle2,
};

interface WikiResultRowProps {
	hit: WikiSearchHit;
	colors: (typeof COLORS)["dark"];
	onPress?: (hit: WikiSearchHit) => void;
}

export function WikiResultRow({ hit, colors, onPress }: WikiResultRowProps) {
	const hue = TYPE_HUES[hit.type];
	const Icon = TYPE_ICONS[hit.type];
	return (
		<Pressable
			onPress={onPress ? () => onPress(hit) : undefined}
			style={({ pressed }) => ({
				paddingHorizontal: 16,
				paddingVertical: 14,
				backgroundColor: pressed ? colors.secondary : "transparent",
				borderBottomWidth: 1,
				borderBottomColor: colors.border,
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
					{TYPE_LABELS[hit.type]}
				</Text>
			</View>
			<Text
				numberOfLines={1}
				style={{
					color: colors.foreground,
					fontSize: 17,
					fontWeight: "600",
					marginBottom: 2,
				}}
			>
				{hit.title}
			</Text>
			{hit.summary ? (
				<Muted numberOfLines={2} style={{ fontSize: 14, lineHeight: 18 }}>
					{hit.summary}
				</Muted>
			) : null}
		</Pressable>
	);
}
