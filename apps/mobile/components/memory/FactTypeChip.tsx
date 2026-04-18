import React from "react";
import { Pressable, View } from "react-native";
import { X } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import type { COLORS } from "@/lib/theme";

export type FactType = "FACT" | "PREFERENCE" | "EXPERIENCE" | "OBSERVATION";

export const FACT_TYPE_LABELS: Record<FactType, string> = {
	FACT: "Fact",
	PREFERENCE: "Preference",
	EXPERIENCE: "Experience",
	OBSERVATION: "Observation",
};

export const FACT_TYPE_DESCRIPTIONS: Record<FactType, string> = {
	FACT: "Durable facts about the world. Default.",
	PREFERENCE: "Preferences, constraints, or rules.",
	EXPERIENCE: "Episodes — things that happened.",
	OBSERVATION: "Patterns or impressions you noticed.",
};

// Hue per type for badge tint — kept subtle against the composer chrome.
const FACT_TYPE_HUE: Record<FactType, string> = {
	FACT: "#0ea5e9",
	PREFERENCE: "#f59e0b",
	EXPERIENCE: "#14b8a6",
	OBSERVATION: "#8b5cf6",
};

interface FactTypeChipProps {
	type: FactType;
	colors: (typeof COLORS)["dark"];
	onClear?: () => void;
	onPress?: () => void;
}

export function FactTypeChip({ type, colors, onClear, onPress }: FactTypeChipProps) {
	const hue = FACT_TYPE_HUE[type];
	return (
		<Pressable
			onPress={onPress}
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: 6,
				paddingLeft: 10,
				paddingRight: onClear ? 4 : 10,
				paddingVertical: 4,
				borderRadius: 999,
				borderWidth: 1,
				borderColor: hue,
				backgroundColor: `${hue}22`,
				alignSelf: "flex-start",
			}}
		>
			<View
				style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hue }}
			/>
			<Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>
				{FACT_TYPE_LABELS[type]}
			</Text>
			{onClear ? (
				<Pressable
					onPress={onClear}
					hitSlop={8}
					style={{ padding: 2 }}
				>
					<X size={14} color={colors.mutedForeground} />
				</Pressable>
			) : null}
		</Pressable>
	);
}
