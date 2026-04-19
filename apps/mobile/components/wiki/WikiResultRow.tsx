import React from "react";
import { Pressable, View } from "react-native";
import { ChevronRight, AtSign, Lightbulb, BookOpen, type LucideIcon } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import type { WikiSearchHit } from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";

const TYPE_CONFIG: Record<WikiSearchHit["type"], { label: string; icon: LucideIcon; bg: string; fg: string }> = {
	ENTITY:   { label: "ENTITY",   icon: AtSign,   bg: "rgba(14,165,233,0.15)",  fg: "#0ea5e9" },
	TOPIC:    { label: "TOPIC",    icon: BookOpen,  bg: "rgba(139,92,246,0.15)",  fg: "#8b5cf6" },
	DECISION: { label: "DECISION", icon: Lightbulb, bg: "rgba(245,158,11,0.15)",  fg: "#f59e0b" },
};

function formatRelativeTime(dateStr: string | null | undefined): string {
	if (!dateStr) return "";
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

interface WikiResultRowProps {
	hit: WikiSearchHit;
	colors: (typeof COLORS)["dark"];
	isUnread?: boolean;
	onPress?: (hit: WikiSearchHit) => void;
}

export function WikiResultRow({ hit, colors, isUnread, onPress }: WikiResultRowProps) {
	const type = TYPE_CONFIG[hit.type];
	const Icon = type.icon;
	const timeStr = formatRelativeTime(hit.updatedAt ?? hit.lastCompiledAt);

	return (
		<Pressable
			onPress={onPress ? () => onPress(hit) : undefined}
			className="flex-row items-start py-2 pr-4 active:bg-neutral-50 dark:active:bg-neutral-900"
			style={{ backgroundColor: colors.background }}
		>
			<View style={{ flexDirection: "row", alignItems: "center", width: 56 }}>
				<View style={{ width: 16, alignItems: "center", justifyContent: "center" }}>
					{isUnread && <View className="w-2 h-2 rounded-full" style={{ backgroundColor: "#3b82f6" }} />}
				</View>
				<View
					style={{
						width: 40,
						height: 40,
						borderRadius: 20,
						backgroundColor: type.bg,
						borderWidth: 0.25,
						borderColor: type.fg,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Icon size={20} color={type.fg} />
				</View>
			</View>

			<View className="flex-1 ml-3">
				<View className="flex-row items-center justify-between">
					<Text className="text-xs font-mono text-primary" style={{ lineHeight: 14 }}>
						{type.label}
					</Text>
					<View className="flex-row items-center gap-1">
						{timeStr ? <Muted className="text-xs">{timeStr}</Muted> : null}
						<ChevronRight size={14} color={colors.mutedForeground} />
					</View>
				</View>
				<Text
					className={`text-base ${isUnread ? "font-semibold" : ""}`}
					style={{ lineHeight: 20, marginTop: -1, marginBottom: 2 }}
					numberOfLines={1}
				>
					{hit.title}
				</Text>
				{hit.summary ? (
					<Muted style={{ fontSize: 14, lineHeight: 18 }} numberOfLines={2}>
						{hit.summary}
					</Muted>
				) : null}
			</View>
		</Pressable>
	);
}
