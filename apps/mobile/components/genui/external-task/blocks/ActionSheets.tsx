/**
 * Bottom-sheet modals fired by ExternalTaskCard's action bar buttons.
 *
 * Four sheets, one per action type:
 *   - StatusActionSheet   (detached, with filter) — external_task.update_status
 *   - AssignActionSheet   (detached, with filter) — external_task.assign
 *   - CommentActionSheet  (full-height)           — external_task.comment
 *   - EditFormActionSheet (full-height)           — external_task.edit_fields
 *
 * Each is conditionally mounted by the card based on `activeActionType`
 * state. On submit, they call the provided `submit` prop (the same
 * executeExternalTaskAction mutation that FormBlock uses), then close.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Check, Search } from "lucide-react-native";
import BottomSheet, {
	BottomSheetBackdrop,
	BottomSheetScrollView,
	BottomSheetTextInput,
	BottomSheetView,
} from "@gorhom/bottom-sheet";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import type {
	NormalizedTask,
	TaskActionType,
	TaskFormField,
	TaskOption,
} from "../types";

type SubmitFn = (args: {
	actionType: TaskActionType;
	params: Record<string, unknown>;
}) => Promise<{ error?: string }>;

type CommonProps = {
	visible: boolean;
	onClose: () => void;
	item: NormalizedTask;
	submit: SubmitFn;
};

// ---------------------------------------------------------------------------
// Shared backdrop
// ---------------------------------------------------------------------------

function useBackdrop() {
	return useCallback(
		(props: any) => (
			<BottomSheetBackdrop
				{...props}
				appearsOnIndex={0}
				disappearsOnIndex={-1}
				pressBehavior="close"
				opacity={0.5}
			/>
		),
		[],
	);
}

// ---------------------------------------------------------------------------
// Status picker — detached, filtered list
// ---------------------------------------------------------------------------

export function StatusActionSheet({ visible, onClose, item, submit }: CommonProps) {
	const { colorScheme } = useColorScheme();
	const isDark = colorScheme === "dark";
	const colors = isDark ? COLORS.dark : COLORS.light;
	const sheetRef = useRef<BottomSheet>(null);
	const backdrop = useBackdrop();
	const [filter, setFilter] = useState("");
	const [saving, setSaving] = useState(false);

	const snapPoints = useMemo(() => ["50%"], []);

	useEffect(() => {
		if (visible) sheetRef.current?.snapToIndex(0);
		else {
			sheetRef.current?.close();
			setFilter("");
		}
	}, [visible]);

	const options = useMemo<TaskOption[]>(() => {
		const field = item.fields.find((f) => f.key === "status");
		return field?.options ?? [];
	}, [item.fields]);

	const filtered = useMemo(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return options;
		return options.filter((o) => o.label.toLowerCase().includes(q));
	}, [options, filter]);

	const currentValue = item.core.status?.value;

	const handleSelect = async (value: string) => {
		if (value === currentValue || saving) return;
		setSaving(true);
		await submit({ actionType: "external_task.update_status", params: { status: value } });
		setSaving(false);
		onClose();
	};

	if (!visible) return null;

	return (
		<BottomSheet
			ref={sheetRef}
			index={-1}
			snapPoints={snapPoints}
			enablePanDownToClose
			onClose={onClose}
			backdropComponent={backdrop}
			backgroundStyle={{
				backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
				borderRadius: 20,
			}}
			handleIndicatorStyle={{
				backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)",
				width: 36,
			}}
			detached
			bottomInset={80}
			style={{ marginHorizontal: 20 }}
		>
			<View className="flex-row items-center justify-between px-4 pb-2">
				<Text className="text-base font-semibold">Change status</Text>
				<Pressable onPress={onClose} className="p-1 active:opacity-70">
					<X size={20} color={colors.mutedForeground} />
				</Pressable>
			</View>

			<View className="px-4 pb-2">
				<View
					className="flex-row items-center gap-2 rounded-lg px-3 py-2"
					style={{
						backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
					}}
				>
					<Search size={14} color={colors.mutedForeground} />
					<BottomSheetTextInput
						value={filter}
						onChangeText={setFilter}
						placeholder="Filter statuses…"
						placeholderTextColor={colors.mutedForeground}
						style={{
							flex: 1,
							color: colors.foreground,
							fontSize: 14,
							padding: 0,
						}}
					/>
				</View>
			</View>

			<BottomSheetScrollView contentContainerStyle={{ paddingBottom: 16 }}>
				{filtered.length === 0 ? (
					<Muted className="text-xs px-4 py-6 text-center">No matches</Muted>
				) : (
					filtered.map((opt) => {
						const isCurrent = opt.value === currentValue;
						return (
							<Pressable
								key={opt.value}
								onPress={() => handleSelect(opt.value)}
								disabled={saving}
								className="flex-row items-center justify-between px-4 py-3 active:opacity-60"
							>
								<Text className="text-sm">{opt.label}</Text>
								{isCurrent && <Check size={16} color={colors.primary} />}
							</Pressable>
						);
					})
				)}
			</BottomSheetScrollView>
		</BottomSheet>
	);
}

// ---------------------------------------------------------------------------
// Assign picker — detached, filter input + manual assignee entry
// ---------------------------------------------------------------------------

export function AssignActionSheet({ visible, onClose, item, submit }: CommonProps) {
	const { colorScheme } = useColorScheme();
	const isDark = colorScheme === "dark";
	const colors = isDark ? COLORS.dark : COLORS.light;
	const sheetRef = useRef<BottomSheet>(null);
	const backdrop = useBackdrop();
	const [value, setValue] = useState(item.core.assignee?.id ?? "");
	const [saving, setSaving] = useState(false);

	const snapPoints = useMemo(() => ["38%"], []);

	useEffect(() => {
		if (visible) {
			setValue(item.core.assignee?.id ?? "");
			sheetRef.current?.snapToIndex(0);
		} else sheetRef.current?.close();
	}, [visible, item.core.assignee?.id]);

	const handleSubmit = async () => {
		if (saving || !value.trim()) return;
		setSaving(true);
		await submit({ actionType: "external_task.assign", params: { assignee: value.trim() } });
		setSaving(false);
		onClose();
	};

	if (!visible) return null;

	return (
		<BottomSheet
			ref={sheetRef}
			index={-1}
			snapPoints={snapPoints}
			enablePanDownToClose
			keyboardBehavior="interactive"
			onClose={onClose}
			backdropComponent={backdrop}
			backgroundStyle={{
				backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
				borderRadius: 20,
			}}
			handleIndicatorStyle={{
				backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)",
				width: 36,
			}}
			detached
			bottomInset={80}
			style={{ marginHorizontal: 20 }}
		>
			<BottomSheetView style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
				<View className="flex-row items-center justify-between pb-2">
					<Text className="text-base font-semibold">Assign</Text>
					<Pressable onPress={onClose} className="p-1 active:opacity-70">
						<X size={20} color={colors.mutedForeground} />
					</Pressable>
				</View>

				<Muted className="text-xs mb-1.5 uppercase tracking-wide">Assignee (user id or email)</Muted>
				<BottomSheetTextInput
					value={value}
					onChangeText={setValue}
					placeholder="e.g. user_abc or person@example.com"
					placeholderTextColor={colors.mutedForeground}
					autoCapitalize="none"
					autoCorrect={false}
					style={{
						backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
						borderRadius: 8,
						padding: 12,
						color: colors.foreground,
						fontSize: 14,
					}}
				/>

				<Pressable
					onPress={handleSubmit}
					disabled={saving || !value.trim()}
					className="mt-3 rounded-lg py-3 items-center"
					style={{
						backgroundColor:
							saving || !value.trim()
								? isDark
									? "rgba(255,255,255,0.1)"
									: "rgba(0,0,0,0.08)"
								: colors.primary,
					}}
				>
					<Text
						className="text-sm font-medium"
						style={{
							color:
								saving || !value.trim()
									? colors.mutedForeground
									: isDark
										? "#000"
										: "#fff",
						}}
					>
						{saving ? "Assigning…" : "Assign"}
					</Text>
				</Pressable>
			</BottomSheetView>
		</BottomSheet>
	);
}

// ---------------------------------------------------------------------------
// Comment sheet — full height with textarea
// ---------------------------------------------------------------------------

export function CommentActionSheet({ visible, onClose, submit }: Omit<CommonProps, "item"> & { item: NormalizedTask }) {
	const { colorScheme } = useColorScheme();
	const isDark = colorScheme === "dark";
	const colors = isDark ? COLORS.dark : COLORS.light;
	const insets = useSafeAreaInsets();
	const sheetRef = useRef<BottomSheet>(null);
	const backdrop = useBackdrop();
	const [content, setContent] = useState("");
	const [saving, setSaving] = useState(false);

	const snapPoints = useMemo(() => ["60%"], []);

	useEffect(() => {
		if (visible) {
			setContent("");
			sheetRef.current?.snapToIndex(0);
		} else sheetRef.current?.close();
	}, [visible]);

	const handleSubmit = async () => {
		if (saving || !content.trim()) return;
		setSaving(true);
		await submit({ actionType: "external_task.comment", params: { content: content.trim() } });
		setSaving(false);
		onClose();
	};

	if (!visible) return null;

	return (
		<BottomSheet
			ref={sheetRef}
			index={-1}
			snapPoints={snapPoints}
			enablePanDownToClose
			keyboardBehavior="interactive"
			keyboardBlurBehavior="restore"
			android_keyboardInputMode="adjustResize"
			onClose={onClose}
			backdropComponent={backdrop}
			backgroundStyle={{
				backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
				borderTopLeftRadius: 16,
				borderTopRightRadius: 16,
			}}
			handleIndicatorStyle={{
				backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)",
				width: 36,
			}}
		>
			<View className="flex-row items-center justify-between px-4 pb-3">
				<Text className="text-base font-semibold">Add comment</Text>
				<View className="flex-row items-center gap-2">
					<Pressable
						onPress={handleSubmit}
						disabled={saving || !content.trim()}
						className="p-1 active:opacity-70"
					>
						<Check
							size={22}
							color={saving || !content.trim() ? colors.mutedForeground : colors.primary}
						/>
					</Pressable>
					<Pressable onPress={onClose} className="p-1 active:opacity-70">
						<X size={20} color={colors.mutedForeground} />
					</Pressable>
				</View>
			</View>

			<BottomSheetScrollView
				contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}
			>
				<BottomSheetTextInput
					value={content}
					onChangeText={setContent}
					placeholder="Write a comment…"
					placeholderTextColor={colors.mutedForeground}
					multiline
					textAlignVertical="top"
					style={{
						backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
						borderRadius: 10,
						padding: 12,
						color: colors.foreground,
						fontSize: 14,
						minHeight: 140,
					}}
				/>
			</BottomSheetScrollView>
		</BottomSheet>
	);
}

// ---------------------------------------------------------------------------
// Edit form sheet — full form with all fields
// ---------------------------------------------------------------------------

function FormFieldInput({
	field,
	value,
	onChange,
	isDark,
	colors,
}: {
	field: TaskFormField;
	value: unknown;
	onChange: (v: unknown) => void;
	isDark: boolean;
	colors: typeof COLORS.dark;
}) {
	if (field.type === "select") {
		const opts = field.options ?? [];
		return (
			<View className="flex-row flex-wrap gap-2">
				{opts.map((o) => {
					const active = value === o.value;
					return (
						<Pressable
							key={o.value}
							onPress={() => onChange(o.value)}
							className="rounded-full px-3 py-1.5 active:opacity-70"
							style={{
								backgroundColor: active
									? colors.primary
									: isDark
										? "rgba(255,255,255,0.08)"
										: "rgba(0,0,0,0.04)",
							}}
						>
							<Text
								className="text-xs font-medium"
								style={{
									color: active ? (isDark ? "#000" : "#fff") : colors.foreground,
								}}
							>
								{o.label}
							</Text>
						</Pressable>
					);
				})}
			</View>
		);
	}
	if (field.type === "textarea") {
		return (
			<BottomSheetTextInput
				value={typeof value === "string" ? value : ""}
				onChangeText={onChange}
				placeholder={field.placeholder}
				placeholderTextColor={colors.mutedForeground}
				multiline
				textAlignVertical="top"
				style={{
					backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
					borderRadius: 8,
					padding: 10,
					color: colors.foreground,
					fontSize: 14,
					minHeight: 80,
				}}
			/>
		);
	}
	// text / user / date / boolean / hidden / chips → plain text input fallback
	return (
		<BottomSheetTextInput
			value={typeof value === "string" ? value : ""}
			onChangeText={onChange}
			placeholder={field.placeholder}
			placeholderTextColor={colors.mutedForeground}
			autoCapitalize="none"
			autoCorrect={false}
			style={{
				backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
				borderRadius: 8,
				padding: 10,
				color: colors.foreground,
				fontSize: 14,
			}}
		/>
	);
}

export function EditFormActionSheet({ visible, onClose, item, submit }: CommonProps) {
	const { colorScheme } = useColorScheme();
	const isDark = colorScheme === "dark";
	const colors = isDark ? COLORS.dark : COLORS.light;
	const insets = useSafeAreaInsets();
	const sheetRef = useRef<BottomSheet>(null);
	const backdrop = useBackdrop();
	const [formValues, setFormValues] = useState<Record<string, unknown>>({});
	const [saving, setSaving] = useState(false);

	const form = item.forms?.edit;
	const snapPoints = useMemo(() => ["85%"], []);

	useEffect(() => {
		if (visible && form) {
			const initial: Record<string, unknown> = {};
			for (const f of form.fields) {
				if (f.defaultValue !== undefined) initial[f.key] = f.defaultValue;
			}
			setFormValues(initial);
			sheetRef.current?.snapToIndex(0);
		} else {
			sheetRef.current?.close();
		}
	}, [visible, form]);

	const handleSubmit = async () => {
		if (!form || saving) return;
		setSaving(true);
		await submit({ actionType: form.actionType, params: formValues });
		setSaving(false);
		onClose();
	};

	if (!visible || !form) return null;

	return (
		<BottomSheet
			ref={sheetRef}
			index={-1}
			snapPoints={snapPoints}
			enablePanDownToClose
			keyboardBehavior="interactive"
			keyboardBlurBehavior="restore"
			android_keyboardInputMode="adjustResize"
			onClose={onClose}
			backdropComponent={backdrop}
			backgroundStyle={{
				backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
				borderTopLeftRadius: 16,
				borderTopRightRadius: 16,
			}}
			handleIndicatorStyle={{
				backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)",
				width: 36,
			}}
		>
			<View className="flex-row items-center justify-between px-4 pb-3">
				<View className="flex-1 min-w-0 mr-3">
					<Text className="text-base font-semibold" numberOfLines={1}>
						{form.title}
					</Text>
					{form.description && (
						<Muted className="text-xs" numberOfLines={1}>
							{form.description}
						</Muted>
					)}
				</View>
				<View className="flex-row items-center gap-2">
					<Pressable
						onPress={handleSubmit}
						disabled={saving}
						className="px-3 py-1.5 rounded-full active:opacity-70"
						style={{ backgroundColor: colors.primary }}
					>
						<Text
							className="text-xs font-semibold"
							style={{ color: isDark ? "#000" : "#fff" }}
						>
							{saving ? "Saving…" : form.submitLabel}
						</Text>
					</Pressable>
					<Pressable onPress={onClose} className="p-1 active:opacity-70">
						<X size={20} color={colors.mutedForeground} />
					</Pressable>
				</View>
			</View>

			<BottomSheetScrollView
				contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}
			>
				{form.fields.map((field) => (
					<View key={field.key} className="mb-4">
						<Muted className="text-xs mb-1.5 uppercase tracking-wide">{field.label}</Muted>
						<FormFieldInput
							field={field}
							value={formValues[field.key]}
							onChange={(v) => setFormValues((prev) => ({ ...prev, [field.key]: v }))}
							isDark={isDark}
							colors={colors}
						/>
						{field.helpText && (
							<Muted className="text-xs mt-1">{field.helpText}</Muted>
						)}
					</View>
				))}
			</BottomSheetScrollView>
		</BottomSheet>
	);
}
