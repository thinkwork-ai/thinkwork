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
import { ArrowUp, Mic, Plus, Search, Tag } from "lucide-react-native";
import { useCaptureMobileMemory } from "@thinkwork/react-native-sdk";
import { Text } from "@/components/ui/typography";
import { toast } from "@/components/ui/toast";
import { VoiceDictationBar } from "@/components/input/VoiceDictationBar";
import type { COLORS } from "@/lib/theme";
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
	// FACT is the submission default, but we don't mark it "active" in the
	// picker unless the user has explicitly chosen a type. This keeps the
	// picker from showing a pre-selected blue row on first open.
	const [userPickedType, setUserPickedType] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [isDictating, setIsDictating] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const dictationUsedRef = useRef(false);
	const inputRef = useRef<TextInput>(null);
	const insets = useSafeAreaInsets();

	// When the keyboard is visible, the parent `KeyboardAvoidingView` already
	// slides the footer above the keyboard — the home-indicator inset would
	// then render as an empty dead zone between the input and the keyboard.
	// Collapse the inset to zero while the keyboard is up.
	const [keyboardVisible, setKeyboardVisible] = useState(false);
	useEffect(() => {
		const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
		const showSub = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
		const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
		return () => {
			showSub.remove();
			hideSub.remove();
		};
	}, []);
	const effectiveBottomInset = keyboardVisible ? 4 : insets.bottom || 4;

	const captureMobileMemory = useCaptureMobileMemory();

	// Search is no longer live — query is pushed to the parent only on
	// explicit submit (send tap or Enter key). Switching to add mode
	// always wipes the active query so results snap back to the recent
	// feed and don't leak across modes.
	useEffect(() => {
		if (mode === "add") onSearchQueryChange?.("");
	}, [mode, onSearchQueryChange]);

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
		const clipped = next.length > MAX_CHARS ? next.slice(0, MAX_CHARS) : next;
		setText(clipped);
		// Clearing the search input should snap back to the recent feed
		// immediately, without requiring another submit.
		if (mode === "search" && clipped.length === 0) {
			onSearchQueryChange?.("");
		}
	}, [mode, onSearchQueryChange]);

	const toggleMode = useCallback(() => {
		setMode((prev) => (prev === "search" ? "add" : "search"));
		requestAnimationFrame(() => inputRef.current?.focus());
	}, []);

	// Synchronous capture — sends to Hindsight now. No offline queue, no
	// client-side persistence. If the request fails, we surface an error
	// toast and keep the draft text so the user can retry.
	const handleCapture = useCallback(async () => {
		const trimmed = text.trim();
		if (!trimmed || submitting || atHardLimit) return;
		if (!agentId || !tenantId) {
			Alert.alert("No agent selected", "Choose an agent before capturing a memory.");
			return;
		}
		setSubmitting(true);
		try {
			const capturedVia: "text" | "dictation" = dictationUsedRef.current ? "dictation" : "text";
			const appVersion =
				Constants.expoConfig?.version ??
				((Constants as unknown as { nativeAppVersion?: string }).nativeAppVersion ?? "unknown");
			await captureMobileMemory({
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
			setUserPickedType(false);
			dictationUsedRef.current = false;
			Keyboard.dismiss();
			const label = agentName || "your agent";
			toast.show({
				message: `Saved to ${label}'s memory`,
				durationMs: 3000,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : "Try again in a moment.";
			toast.show({
				message: `Couldn't save: ${message}`,
				tone: "error",
				durationMs: 3000,
			});
		} finally {
			setSubmitting(false);
		}
	}, [text, submitting, atHardLimit, agentId, tenantId, factType, agentName, captureMobileMemory]);

	const handleSubmit = useCallback(() => {
		if (mode === "add") {
			void handleCapture();
			return;
		}
		onSearchQueryChange?.(text.trim());
		Keyboard.dismiss();
	}, [mode, handleCapture, text, onSearchQueryChange]);

	const handleMicPress = useCallback(() => {
		dictationUsedRef.current = true;
		setIsDictating(true);
	}, []);

	const placeholder = mode === "search" ? "Search wiki..." : "Add new memory...";
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
					paddingBottom: effectiveBottomInset,
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
							onClear={() => {
								setFactType("FACT");
								setUserPickedType(false);
							}}
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
						// Search is single-line so Enter fires onSubmitEditing
						// without flashing a newline first. Add stays multiline
						// so Enter inserts a line break as the user expects.
						multiline={mode === "add"}
						className="max-h-[120px]"
						style={{
							flex: 1,
							color: colors.foreground,
							fontSize: 18,
							lineHeight: 24,
							paddingTop: 4,
							paddingBottom: 4,
							paddingRight: text.length > 0 ? 40 : 0,
						}}
						returnKeyType={mode === "search" ? "search" : "default"}
						blurOnSubmit={mode === "search"}
						onSubmitEditing={mode === "search" ? handleSubmit : undefined}
					/>
					{text.length > 0 ? (
						<Pressable
							onPress={() => {
								setText("");
								if (mode === "search") onSearchQueryChange?.("");
							}}
							accessibilityLabel="Clear input"
							hitSlop={8}
							style={{ paddingTop: 6, paddingLeft: 8 }}
						>
							<Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Clear</Text>
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
							<Pressable
								onPress={() => {
									if (mode !== "add") return;
									Keyboard.dismiss();
									setPickerOpen(true);
								}}
								disabled={mode !== "add"}
								className="p-1 active:opacity-70"
								accessibilityLabel="Choose memory type"
								accessibilityState={{ disabled: mode !== "add" }}
								style={{ opacity: mode === "add" ? 1 : 0.35 }}
							>
								<Tag size={22} color={colors.mutedForeground} />
							</Pressable>
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
				onSelect={(next) => {
					setFactType(next);
					setUserPickedType(true);
				}}
				current={userPickedType ? factType : undefined}
			/>
		</>
	);
}
