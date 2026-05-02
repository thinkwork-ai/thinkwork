import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { Router } from "expo-router";
import Markdown from "react-native-markdown-display";
import { useColorScheme } from "nativewind";
import {
	IconAlignLeft,
	IconLayoutRows,
	IconTopologyStar3,
} from "@tabler/icons-react-native";
import { Sparkles } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import {
	useWikiBacklinks,
	useWikiConnectedPages,
	useWikiPage,
	type WikiPageType,
} from "@thinkwork/react-native-sdk";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { WikiDetailSubgraph } from "@/components/wiki/graph";
import { BrainEnrichmentSheet } from "@/components/brain/BrainEnrichmentSheet";

/**
 * Intercept markdown link taps inside a wiki body. Rollup sections are
 * rendered as `[**Title**](/wiki/<type>/<slug>) — summary`; tapping one
 * should route to that page inside the app, not hit the external Linking
 * handler. Returns `false` to tell react-native-markdown-display to stop
 * its default behaviour once we've handled the link.
 *
 * Links that don't match `/wiki/<type>/<slug>` (plain http links, mailto,
 * etc.) fall through — return `true` to let the renderer open them via
 * the OS Linking API as usual.
 *
 * The api writes page types in lowercase (`entity`); the mobile router
 * expects uppercase (`ENTITY`). We normalise here so the bodies don't
 * have to track that.
 */
function buildWikiLinkHandler(
	router: Router,
	userId: string | undefined,
): (url: string) => boolean {
	return (url: string): boolean => {
		const path = extractWikiPath(url);
		if (!path) return true; // not a wiki link; let Linking handle it
		const route = `/wiki/${encodeURIComponent(path.type)}/${encodeURIComponent(path.slug)}`;
		router.push(userId ? `${route}?userId=${encodeURIComponent(userId)}` : route);
		return false;
	};
}

function extractWikiPath(
	url: string,
): { type: string; slug: string } | null {
	// Accept both relative `/wiki/…` paths and absolute URLs pointing at any
	// host. Anything not shaped like `/wiki/<type>/<slug>` falls through.
	let pathOnly = url;
	try {
		// Absolute URL (has a scheme)
		const parsed = new URL(url);
		pathOnly = parsed.pathname;
	} catch {
		// Not a valid URL — treat as a path.
	}
	const m = pathOnly.match(/^\/wiki\/([^/]+)\/([^/?#]+)/);
	if (!m) return null;
	const typeRaw = decodeURIComponent(m[1] ?? "").toLowerCase();
	const slug = decodeURIComponent(m[2] ?? "");
	const type =
		typeRaw === "entity"
			? "ENTITY"
			: typeRaw === "topic"
				? "TOPIC"
				: typeRaw === "decision"
					? "DECISION"
					: null;
	if (!type || !slug) return null;
	return { type, slug };
}

const TYPE_LABELS: Record<WikiPageType, string> = {
	ENTITY: "Entity",
	TOPIC: "Topic",
	DECISION: "Decision",
};

function isWikiPageType(v: string | undefined): v is WikiPageType {
	return v === "ENTITY" || v === "TOPIC" || v === "DECISION";
}

export default function WikiPageScreen() {
	const router = useRouter();
	const params = useLocalSearchParams<{ type?: string; slug?: string; userId?: string; agentId?: string }>();
	const type = isWikiPageType(params.type) ? params.type : undefined;
	const slug = params.slug ? decodeURIComponent(params.slug) : undefined;

	const { user } = useAuth();
	const tenantId = user?.tenantId;
	const userId = params.userId
		? decodeURIComponent(params.userId)
		: params.agentId
			? decodeURIComponent(params.agentId)
			: undefined;

	const { colorScheme } = useColorScheme();
	const isDark = colorScheme === "dark";
	const colors = isDark ? COLORS.dark : COLORS.light;

	const { page, loading, refetch } = useWikiPage({ tenantId, userId, type, slug });
	const { backlinks } = useWikiBacklinks(page?.id);
	const { connectedPages } = useWikiConnectedPages(page?.id);
	const [viewMode, setViewMode] = useState<"wiki" | "split" | "graph">(
		"wiki",
	);
	const [enrichmentOpen, setEnrichmentOpen] = useState(false);

	const markdownStyles = useMemo(
		() => buildMarkdownStyles(colors, isDark),
		[colors, isDark],
	);

	const onLinkPress = useCallback(
		(url: string) => buildWikiLinkHandler(router, userId)(url),
		[router, userId],
	);

	useFocusEffect(
		useCallback(() => {
			if (!tenantId || !userId || !type || !slug) return;
			refetch();
		}, [tenantId, userId, type, slug, refetch]),
	);

	const headerTitle = page?.title || (loading ? "Loading..." : "Not found");

	const canToggleGraph = !!page && !!tenantId && !!userId;
	const canEnrich = !!page && !!tenantId && !!userId && !!process.env.EXPO_PUBLIC_GRAPHQL_URL;
	const cycleView = () =>
		setViewMode((m) =>
			m === "wiki" ? "split" : m === "split" ? "graph" : "wiki",
		);
	const viewIcon =
		viewMode === "wiki"
			? IconAlignLeft
			: viewMode === "split"
				? IconLayoutRows
				: IconTopologyStar3;
	const ViewIcon = viewIcon;
	const headerRight = canToggleGraph || canEnrich ? (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
			{canEnrich ? (
				<Pressable
					onPress={() => setEnrichmentOpen(true)}
					className="p-2"
					accessibilityRole="button"
					accessibilityLabel="Enrich page"
				>
					<Sparkles size={21} color={colors.foreground} strokeWidth={2} />
				</Pressable>
			) : null}
			{canToggleGraph ? (
				<Pressable
					onPress={cycleView}
					className="p-2"
					accessibilityRole="button"
					accessibilityLabel={
						viewMode === "wiki"
							? "Switch to split view"
							: viewMode === "split"
								? "Switch to graph view"
								: "Switch to wiki view"
					}
				>
					<ViewIcon
						size={22}
						color={viewMode === "wiki" ? colors.foreground : colors.primary}
						strokeWidth={2}
					/>
				</Pressable>
			) : null}
		</View>
	) : undefined;

	const showAnyGraph =
		(viewMode === "split" || viewMode === "graph") &&
		page &&
		tenantId &&
		userId;
	const graphFullscreen = viewMode === "graph";

	return (
		<DetailLayout title={headerTitle} headerRight={headerRight}>
			{showAnyGraph ? (
				<View
					style={{
						// 50/50 split in split mode; full flex in graph mode.
						height: graphFullscreen ? undefined : "50%",
						flex: graphFullscreen ? 1 : undefined,
						borderBottomWidth: graphFullscreen ? 0 : 1,
						borderBottomColor: colors.border,
					}}
				>
					<WikiDetailSubgraph
						tenantId={tenantId as string}
						userId={userId as string}
						pageId={page.id}
					/>
				</View>
			) : null}
			<ScrollView
				style={{
					flex: 1,
					display: graphFullscreen ? "none" : undefined,
				}}
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
					<View style={{ paddingHorizontal: 24, paddingTop: 16, gap: 20 }}>
						{page.promotedFromSection ? (
							<Pressable
								onPress={() => {
									const parent = page.promotedFromSection!.parentPage;
									const path = `/wiki/${encodeURIComponent(parent.type)}/${encodeURIComponent(parent.slug)}`;
									router.push(
										userId
											? `${path}?userId=${encodeURIComponent(userId)}`
											: path,
									);
								}}
								style={({ pressed }) => ({
									paddingHorizontal: 12,
									paddingVertical: 8,
									borderRadius: 10,
									backgroundColor: pressed ? colors.secondary : "transparent",
									borderWidth: 1,
									borderColor: colors.border,
									alignSelf: "flex-start",
								})}
							>
								<Muted style={{ fontSize: 11, fontWeight: "600", letterSpacing: 0.4 }}>
									PROMOTED FROM
								</Muted>
								<Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "500" }}>
									{page.promotedFromSection.parentPage.title} → {page.promotedFromSection.sectionHeading}
								</Text>
							</Pressable>
						) : page.parent ? (
							<Pressable
								onPress={() => {
									const parent = page.parent!;
									const path = `/wiki/${encodeURIComponent(parent.type)}/${encodeURIComponent(parent.slug)}`;
									router.push(
										userId
											? `${path}?userId=${encodeURIComponent(userId)}`
											: path,
									);
								}}
								style={({ pressed }) => ({
									paddingHorizontal: 12,
									paddingVertical: 8,
									borderRadius: 10,
									backgroundColor: pressed ? colors.secondary : "transparent",
									borderWidth: 1,
									borderColor: colors.border,
									alignSelf: "flex-start",
								})}
							>
								<Muted style={{ fontSize: 11, fontWeight: "600", letterSpacing: 0.4 }}>
									PARENT
								</Muted>
								<Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "500" }}>
									{page.parent.title}
								</Text>
							</Pressable>
						) : null}

						<View style={{ gap: 6 }}>
							{type ? (
								<Muted
									style={{
										fontSize: 11,
										fontWeight: "600",
										letterSpacing: 0.5,
										textTransform: "uppercase",
									}}
								>
									{TYPE_LABELS[type]}
								</Muted>
							) : null}
							{page.summary ? (
								<Muted style={{ fontSize: 15, lineHeight: 22 }}>{page.summary}</Muted>
							) : null}
							{typeof page.sourceMemoryCount === "number" && page.sourceMemoryCount > 0 ? (
								<View
									style={{
										paddingHorizontal: 8,
										paddingVertical: 3,
										borderRadius: 999,
										backgroundColor: colors.secondary,
										alignSelf: "flex-start",
										marginTop: 4,
									}}
								>
									<Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
										Based on {page.sourceMemoryCount} {page.sourceMemoryCount === 1 ? "memory" : "memories"}
									</Text>
								</View>
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
								<Markdown style={markdownStyles} onLinkPress={onLinkPress}>
									{section.bodyMd}
								</Markdown>
							</View>
						))}

						{page.children && page.children.length > 0 ? (
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
									Promoted children
								</Text>
								{page.children.map((child) => (
									<Pressable
										key={child.id}
										onPress={() => {
											const bp = `/wiki/${encodeURIComponent(child.type)}/${encodeURIComponent(child.slug)}`;
											router.push(
												userId ? `${bp}?userId=${encodeURIComponent(userId)}` : bp,
											);
										}}
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
										<Muted
											style={{
												fontSize: 10,
												fontWeight: "600",
												textTransform: "uppercase",
												letterSpacing: 0.5,
											}}
										>
											{TYPE_LABELS[child.type]}
										</Muted>
										<Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, fontWeight: "500" }}>
											{child.title}
										</Text>
										{child.summary ? (
											<Muted numberOfLines={1} style={{ fontSize: 13 }}>
												{child.summary}
											</Muted>
										) : null}
									</Pressable>
								))}
							</View>
						) : null}

						{connectedPages.length > 0 ? (
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
									Connected pages
								</Text>
								{connectedPages.map((c) => (
									<Pressable
										key={c.id}
										onPress={() => {
											const bp = `/wiki/${encodeURIComponent(c.type)}/${encodeURIComponent(c.slug)}`;
											router.push(userId ? `${bp}?userId=${encodeURIComponent(userId)}` : bp);
										}}
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
										<Muted
											style={{
												fontSize: 10,
												fontWeight: "600",
												textTransform: "uppercase",
												letterSpacing: 0.5,
											}}
										>
											{TYPE_LABELS[c.type]}
										</Muted>
										<Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, fontWeight: "500" }}>
											{c.title}
										</Text>
										{c.summary ? (
											<Muted numberOfLines={1} style={{ fontSize: 13 }}>
												{c.summary}
											</Muted>
										) : null}
									</Pressable>
								))}
							</View>
						) : null}

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
								{backlinks.map((b) => (
									<Pressable
										key={b.id}
										onPress={() => {
											const bp = `/wiki/${encodeURIComponent(b.type)}/${encodeURIComponent(b.slug)}`;
											router.push(userId ? `${bp}?userId=${encodeURIComponent(userId)}` : bp);
										}}
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
										<Muted
											style={{
												fontSize: 10,
												fontWeight: "600",
												textTransform: "uppercase",
												letterSpacing: 0.5,
											}}
										>
											{TYPE_LABELS[b.type]}
										</Muted>
										<Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, fontWeight: "500" }}>
											{b.title}
										</Text>
										{b.summary ? (
											<Muted numberOfLines={1} style={{ fontSize: 13 }}>
												{b.summary}
											</Muted>
										) : null}
									</Pressable>
								))}
							</View>
						) : null}
					</View>
				)}
			</ScrollView>
			{page && tenantId && process.env.EXPO_PUBLIC_GRAPHQL_URL ? (
				<BrainEnrichmentSheet
					visible={enrichmentOpen}
					onClose={() => setEnrichmentOpen(false)}
					graphqlUrl={process.env.EXPO_PUBLIC_GRAPHQL_URL}
					tenantId={tenantId}
					pageId={page.id}
					pageTitle={page.title}
					colors={colors}
					onOpenThread={(threadId) => router.push(`/thread/${threadId}`)}
				/>
			) : null}
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
