import React from "react";
import { Pressable, View } from "react-native";
import { Text, Muted } from "@/components/ui/typography";
import type { WikiSearchHit } from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";

interface WikiResultRowProps {
	hit: WikiSearchHit;
	colors: (typeof COLORS)["dark"];
	onPress?: (hit: WikiSearchHit) => void;
}

export function WikiResultRow({ hit, colors, onPress }: WikiResultRowProps) {
	return (
		<Pressable
			onPress={onPress ? () => onPress(hit) : undefined}
			style={({ pressed }) => ({
				paddingHorizontal: 16,
				paddingVertical: 12,
				backgroundColor: pressed ? colors.secondary : "transparent",
			})}
		>
			<Text
				className="text-base font-semibold"
				numberOfLines={1}
				style={{ lineHeight: 20, marginBottom: 2 }}
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

