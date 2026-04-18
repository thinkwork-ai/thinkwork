import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	Alert,
	Keyboard,
	Platform,
	Pressable,
	ScrollView,
	TextInput,
	View,
} from "react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUp, Mic, Plus, Search, Tag, XCircle } from "lucide-react-native";
import { useDeleteMobileMemoryCapture } from "@thinkwork/react-native-sdk";
import { Text } from "@/components/ui/typography";
import { toast } from "@/components/ui/toast";
import { VoiceDictationBar } from "@/components/input/VoiceDictationBar";
import type { COLORS } from "@/lib/theme";
import { captureQueue } from "@/lib/offline/capture-queue";
import {
	newClientCaptureId,
	useCaptureQueue,
} from "@/lib/offline/use-capture-queue";
import { FactTypeChip, type FactType } from "./FactTypeChip";
import { FactTypePicker } from "./FactTypePicker";

const MAX_CHARS = 2000;
const SOFT_WARN_CHARS = 1500;

export type CaptureFooterMode = "search" | "add";

interface CaptureFooterProps {
	agentId: string | null | undefined;
	agentName: string | null | undefined;
	tenantId: string | null | undefined;
	colors: (typeof COLORS)["dark"];
	isDark: boolean;
	/**
	 * Fired whenever the effective search query changes (live while the user
	 * types in search mode; empty string otherwise). The parent should
	 * debounce this value before passing it to the search query.
	 */
	onSearchQueryChange?: (query: string) => void;
}

export function CaptureFooter({
	agentId,
	agentName,
	tenantId,
	colors,
	isDark,
	onSearchQueryChange,
}: CaptureFooterProps) {
	const [mode, setMode] = useState<CaptureFooterMode>("search");
	const [text, setText] = useState("");
	const [factType, setFactType] = useState<FactType>("FACT");
	const [pickerOpen, setPickerOpen] = useState(false);
	const [isDictating, setIsDictating] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const pendingCid = useRef<string | null>(null);
	const dictationUsedRef = useRef(false);
	const inputRef = useRef<TextInput>(null);
	const insets = useSafeAreaInsets();

	const entries = useCaptureQueue();
	const deleteCapture = useDeleteMobileMemoryCapture();

	// Keep the parent's search query in sync with text+mode. Empty in add mode.
	useEffect(() => {
		onSearchQueryChange?.(mode === "search" ? text : "");
	}, [mode, text, onSearchQueryChange]);

	// When the last-submitted capture flips to synced, show the Undo toast.
	useEffect(() => {
		const cid = pendingCid.current;
		if (!cid) return;
		const entry = entries.find((e) => e.clientCaptureId === cid);
		if (!entry) return;
		if (entry.status === "synced" && entry.syncedId && entry.agentId) {
			pendingCid.current = null;
			const label = agentName || "your agent";
			const syncedId = entry.syncedId;
			const agentForUndo = entry.agentId;
			toast.show({
				message: `Saved to ${label}'s memory`,
				actionLabel: "Undo",
				durationMs: 5000,
				onAction: async () => {
					try {
						await deleteCapture({ agentId: agentForUndo, captureId: syncedId });
						await captureQueue.remove(cid);
					} catch {
						toast.show({
							message: "Couldn't undo — tap the memory to delete it.",
							tone: "error",
							durationMs: 3000,
						});
					}
				},
			});
		}
	}, [entries, agentName, deleteCapture]);

	const charCount = text.length;
	const atHardLimit = charCount >= MAX_CHARS;
	const atSoftWarn = charCount >= SOFT_WARN_CHARS;
	const sendDisabled = !text.trim() || submitting || (mode === "add" && atHardLimit);

	const counterColor = atHardLimit
		? colors.destructive
		: atSoftWarn
			? "#f59e0b"
			: colors.mutedForeground;

	const handleChangeText = useCallback((next: string) => {
		if (next.length > MAX_CHARS) {
			setText(next.slice(0, MAX_CHARS));
			return;
		}
		setText(next);
	}, []);

	const toggleMode = useCallback(() => {
		Keyboard.dismiss();
		setMode((prev) => (prev === "search" ? "add" : "search"));
	}, []);

	const handleCapture = useCallback(async () => {
		const trimmed = text.trim();
		if (!trimmed || submitting || atHardLimit) return;
		if (!agentId || !tenantId) {
			Alert.alert("No agent selected", "Choose an agent before capturing a memory.");
			return;
		}
		setSubmitting(true);
		try {
			const cid = newClientCaptureId();
			pendingCid.current = cid;
			const capturedVia: "text" | "dictation" = dictationUsedRef.current ? "dictation" : "text";
			const appVersion =
				Constants.expoConfig?.version ??
				((Constants as unknown as { nativeAppVersion?: string }).nativeAppVersion ?? "unknown");
			await captureQueue.enqueue({
				clientCaptureId: cid,
				tenantId,
				agentId,
				content: trimmed,
				factType,
				metadata: {
					client_platform: Platform.OS,
					app_version: appVersion,
					captured_via: capturedVia,
				},
			});
			setText("");
			setFactType("FACT");
			dictationUsedRef.current = false;
			Keyboard.dismiss();
		} catch (err) {
			pendingCid.current = null;
			const message = err instanceof Error ? err.message : "Try again in a moment.";
			toast.show({ message: `Couldn't save: ${message}`, tone: "error", durationMs: 3000 });
		} finally {
			setSubmitting(false);
		}
	}, [text, submitting, atHardLimit, agentId, tenantId, factType]);

	const handleSubmit = useCallback(() => {
		if (mode === "add") {
			void handleCapture();
			return;
		}
		// Search: submit just blurs the keyboard — the query is already
		// live-fed via onSearchQueryChange; parent debounces and queries.
		Keyboard.dismiss();
	}, [mode, handleCapture]);

	const handleMicPress = useCallback(() => {
		dictationUsedRef.current = true;
		setIsDictating(true);
	}, []);

	const placeholder = mode === "search" ? "Search memories..." : "Add new memory...";
	const hasChip = mode === "add" && factType !== "FACT";
	const showCounter = mode === "add" && charCount >= SOFT_WARN_CHARS;

	return (
		<>
			<View
				className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900"
				style={{
					borderTopLeftRadius: 16,
					borderTopRightRadius: 16,
					overflow: "hidden",
					paddingBottom: insets.bottom || 4,
				}}
			>
				{hasChip ? (
					<ScrollView
						horizontal
						showsHorizontalScrollIndicator={false}
						contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
					>
						<FactTypeChip
							type={factType}
							colors={colors}
							onPress={() => setPickerOpen(true)}
							onClear={() => setFactType("FACT")}
						/>
					</ScrollView>
				) : null}

				<View className="px-4 pt-3" style={{ flexDirection: "row", alignItems: "flex-start" }}>
					<TextInput
						ref={inputRef}
						value={text}
						onChangeText={handleChangeText}
						placeholder={placeholder}
						placeholderTextColor={colors.mutedForeground}
						multiline
						className="max-h-[120px]"
						style={{
							flex: 1,
							color: colors.foreground,
							fontSize: 18,
							lineHeight: 24,
							paddingTop: 4,
							paddingBottom: 4,
							paddingRight: text.length > 0 ? 32 : 0,
						}}
						returnKeyType={mode === "search" ? "search" : "default"}
						blurOnSubmit={false}
						onSubmitEditing={Platform.OS === "web" ? handleSubmit : undefined}
					/>
					{text.length > 0 ? (
						<Pressable
							onPress={() => setText("")}
							accessibilityLabel="Clear input"
							hitSlop={8}
							style={{ paddingTop: 4, paddingLeft: 4 }}
						>
							<XCircle size={20} color={colors.mutedForeground} />
						</Pressable>
					) : null}
				</View>

				{isDictating ? (
					<VoiceDictationBar
						onInterim={(t: string) => setText(t.slice(0, MAX_CHARS))}
						onTranscript={(t: string) => {
							setText(t.slice(0, MAX_CHARS));
							setIsDictating(false);
						}}
						onCancel={() => setIsDictating(false)}
						colors={colors}
						isDark={isDark}
					/>
				) : (
					<View className="flex-row items-center justify-between px-4 pt-1 pb-2">
						<View className="flex-row items-center gap-4">
							<Pressable
								onPress={toggleMode}
								className="p-1 active:opacity-70"
								accessibilityLabel={mode === "search" ? "Switch to add memory" : "Switch to search"}
							>
								{mode === "search" ? (
									<Plus size={26} color={colors.mutedForeground} />
								) : (
									<Search size={24} color={colors.mutedForeground} />
								)}
							</Pressable>
							{mode === "add" ? (
								<Pressable
									onPress={() => {
										Keyboard.dismiss();
										setPickerOpen(true);
									}}
									className="p-1 active:opacity-70"
									accessibilityLabel="Choose memory type"
								>
									<Tag size={22} color={colors.mutedForeground} />
								</Pressable>
							) : null}
						</View>
						<View className="flex-row items-center gap-4">
							{showCounter ? (
								<View
									style={{
										paddingHorizontal: 8,
										paddingVertical: 2,
										borderRadius: 999,
										backgroundColor: atHardLimit
											? `${colors.destructive}22`
											: "transparent",
									}}
								>
									<Text style={{ color: counterColor, fontSize: 12 }}>
										{`${charCount.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`}
									</Text>
								</View>
							) : null}
							<Pressable onPress={handleMicPress} className="p-1 active:opacity-70">
								<Mic size={24} color={colors.mutedForeground} />
							</Pressable>
							<Pressable
								onPress={handleSubmit}
								disabled={sendDisabled}
								style={{
									width: 36,
									height: 36,
									borderRadius: 18,
									alignItems: "center",
									justifyContent: "center",
									backgroundColor: sendDisabled
										? isDark
											? "#404040"
											: "#d4d4d4"
										: colors.primary,
								}}
							>
								<ArrowUp
									size={20}
									strokeWidth={2.5}
									color={sendDisabled ? (isDark ? "#737373" : "#a3a3a3") : "#ffffff"}
								/>
							</Pressable>
						</View>
					</View>
				)}
			</View>

			<FactTypePicker
				visible={pickerOpen}
				onClose={() => setPickerOpen(false)}
				onSelect={(next) => setFactType(next)}
				current={factType}
			/>
		</>
	);
}
