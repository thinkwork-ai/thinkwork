import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Markdown from "react-native-markdown-display";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/lib/auth-context";
import { useMe } from "@/lib/hooks/use-users";
import {
	useWikiBacklinks,
	useWikiPage,
	type WikiPageType,
} from "@thinkwork/react-native-sdk";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { Building2, Lightbulb, CheckCircle2 } from "lucide-react-native";

const TYPE_LABELS: Record<WikiPageType, string> = {
	ENTITY: "Entity",
	TOPIC: "Topic",
	DECISION: "Decision",
};

const TYPE_HUES: Record<WikiPageType, string> = {
	ENTITY: "#0ea5e9",
	TOPIC: "#f59e0b",
	DECISION: "#8b5cf6",
};

const TYPE_ICONS: Record<
	WikiPageType,
	React.ComponentType<{ size?: number; color?: string }>
> = {
	ENTITY: Building2,
	TOPIC: Lightbulb,
	DECISION: CheckCircle2,
};

function isWikiPageType(v: string | undefined): v is WikiPageType {
	return v === "ENTITY" || v === "TOPIC" || v === "DECISION";
}

export default function WikiPageScreen() {
	const router = useRouter();
	const params = useLocalSearchParams<{ type?: string; slug?: string }>();
	const type = isWikiPageType(params.type) ? params.type : undefined;
	const slug = params.slug ? decodeURIComponent(params.slug) : undefined;

	const { user } = useAuth();
	const tenantId = user?.tenantId;
	const [{ data: meData }] = useMe();
	const ownerId = meData?.me?.id;

	const { colorScheme } = useColorScheme();
	const isDark = colorScheme === "dark";
	const colors = isDark ? COLORS.dark : COLORS.light;

	const { page, loading } = useWikiPage({ tenantId, ownerId, type, slug });
	const { backlinks } = useWikiBacklinks(page?.id);

	const markdownStyles = useMemo(
		() => buildMarkdownStyles(colors, isDark),
		[colors, isDark],
	);

	const TypeIcon = type ? TYPE_ICONS[type] : null;
	const hue = type ? TYPE_HUES[type] : colors.foreground;

	const title = (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
			{TypeIcon ? <TypeIcon size={16} color={hue} /> : null}
			<Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "600" }} numberOfLines={1}>
				{page?.title || (loading ? "Loading..." : "Not found")}
			</Text>
		</View>
	);

	return (
		<DetailLayout title={title}>
			<ScrollView
				style={{ flex: 1 }}
				contentContainerStyle={{ paddingBottom: 48 }}
				showsVerticalScrollIndicator={false}
			>
				{loading && !page ? (
					<View className="items-center justify-center py-10">
						<ActivityIndicator color={colors.mutedForeground} />
					</View>
				) : !page ? (
					<View className="items-center justify-center py-10 px-6">
						<Muted>This memory couldn't be loaded.</Muted>
					</View>
				) : (
					<View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 20 }}>
						<View style={{ gap: 8 }}>
							<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
								{TypeIcon ? <TypeIcon size={14} color={hue} /> : null}
								<Text
									style={{
										color: hue,
										fontSize: 11,
										fontWeight: "600",
										letterSpacing: 0.5,
										textTransform: "uppercase",
									}}
								>
									{type ? TYPE_LABELS[type] : "Memory"}
								</Text>
							</View>
							<Text style={{ color: colors.foreground, fontSize: 26, fontWeight: "700", lineHeight: 32 }}>
								{page.title}
							</Text>
							{page.summary ? (
								<Muted style={{ fontSize: 15, lineHeight: 22 }}>{page.summary}</Muted>
							) : null}
							{page.aliases.length > 0 ? (
								<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
									{page.aliases.map((alias) => (
										<View
											key={alias}
											style={{
												paddingHorizontal: 8,
												paddingVertical: 2,
												borderRadius: 999,
												backgroundColor: colors.secondary,
											}}
										>
											<Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{alias}</Text>
										</View>
									))}
								</View>
							) : null}
						</View>

						{page.sections.map((section) => (
							<View key={section.id} style={{ gap: 8 }}>
								<Text
									style={{
										color: colors.foreground,
										fontSize: 17,
										fontWeight: "600",
									}}
								>
									{section.heading}
								</Text>
								<Markdown style={markdownStyles}>{section.bodyMd}</Markdown>
							</View>
						))}

						{backlinks.length > 0 ? (
							<View style={{ gap: 8, marginTop: 12 }}>
								<Text
									style={{
										color: colors.mutedForeground,
										fontSize: 12,
										fontWeight: "600",
										letterSpacing: 0.5,
										textTransform: "uppercase",
									}}
								>
									Referenced by
								</Text>
								{backlinks.map((b) => {
									const BackIcon = TYPE_ICONS[b.type];
									const backHue = TYPE_HUES[b.type];
									return (
										<Pressable
											key={b.id}
											onPress={() =>
												router.push(
													`/wiki/${encodeURIComponent(b.type)}/${encodeURIComponent(b.slug)}`,
												)
											}
											style={({ pressed }) => ({
												paddingHorizontal: 12,
												paddingVertical: 10,
												borderRadius: 12,
												borderWidth: 1,
												borderColor: colors.border,
												backgroundColor: pressed ? colors.secondary : "transparent",
												gap: 4,
											})}
										>
											<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
												<BackIcon size={12} color={backHue} />
												<Text
													style={{
														color: backHue,
														fontSize: 10,
														fontWeight: "600",
														textTransform: "uppercase",
														letterSpacing: 0.5,
													}}
												>
													{TYPE_LABELS[b.type]}
												</Text>
											</View>
											<Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, fontWeight: "500" }}>
												{b.title}
											</Text>
											{b.summary ? (
												<Muted numberOfLines={1} style={{ fontSize: 13 }}>
													{b.summary}
												</Muted>
											) : null}
										</Pressable>
									);
								})}
							</View>
						) : null}
					</View>
				)}
			</ScrollView>
		</DetailLayout>
	);
}

function buildMarkdownStyles(colors: (typeof COLORS)["dark"], _isDark: boolean) {
	return {
		body: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
		heading1: { color: colors.foreground, fontSize: 22, fontWeight: "700", marginTop: 8 },
		heading2: { color: colors.foreground, fontSize: 18, fontWeight: "600", marginTop: 6 },
		heading3: { color: colors.foreground, fontSize: 16, fontWeight: "600", marginTop: 4 },
		strong: { color: colors.foreground, fontWeight: "600" },
		em: { fontStyle: "italic" },
		link: { color: colors.primary, textDecorationLine: "underline" },
		bullet_list: { marginVertical: 4 },
		ordered_list: { marginVertical: 4 },
		list_item: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
		code_inline: {
			backgroundColor: colors.secondary,
			color: colors.foreground,
			paddingHorizontal: 4,
			borderRadius: 4,
			fontSize: 14,
		},
		fence: {
			backgroundColor: colors.secondary,
			color: colors.foreground,
			padding: 12,
			borderRadius: 8,
			fontSize: 13,
		},
		blockquote: {
			backgroundColor: colors.secondary,
			borderLeftWidth: 3,
			borderLeftColor: colors.border,
			paddingLeft: 12,
			paddingVertical: 6,
			marginVertical: 4,
		},
		hr: { backgroundColor: colors.border, height: 1, marginVertical: 12 },
	} as const;
}
