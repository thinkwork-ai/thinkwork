import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { Text } from "./typography";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

type ToastPayload = {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
	durationMs?: number;
	tone?: "default" | "error";
};

type ToastState = (ToastPayload & { id: number; startedAt: number }) | null;

type Subscriber = (state: ToastState) => void;

let current: ToastState = null;
let nextId = 1;
const subscribers = new Set<Subscriber>();

function emit() {
	for (const s of subscribers) s(current);
}

export const toast = {
	show(payload: ToastPayload) {
		current = { ...payload, id: nextId++, startedAt: Date.now() };
		emit();
	},
	dismiss() {
		current = null;
		emit();
	},
};

/**
 * Render once near the bottom of a screen. Absolutely positioned over
 * the content; sits above the footer via its own margin.
 */
export function ToastHost({ bottomOffset = 72 }: { bottomOffset?: number }) {
	const { colorScheme } = useColorScheme();
	const isDark = colorScheme === "dark";
	const colors = isDark ? COLORS.dark : COLORS.light;

	const [state, setState] = useState<ToastState>(current);
	const opacity = useRef(new Animated.Value(0)).current;
	const progress = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		const sub: Subscriber = (s) => setState(s);
		subscribers.add(sub);
		return () => {
			subscribers.delete(sub);
		};
	}, []);

	useEffect(() => {
		if (!state) {
			Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
			return;
		}
		const duration = state.durationMs ?? 4000;
		progress.setValue(0);
		Animated.parallel([
			Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
			Animated.timing(progress, {
				toValue: 1,
				duration,
				useNativeDriver: false,
			}),
		]).start();
		const timer = setTimeout(() => {
			if (current && current.id === state.id) toast.dismiss();
		}, duration);
		return () => clearTimeout(timer);
	}, [state, opacity, progress]);

	if (!state) return null;

	const bg = state.tone === "error" ? colors.destructive : isDark ? "#262626" : "#171717";
	const fg = "#fafafa";
	const progressWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ["100%", "0%"] });

	return (
		<Animated.View
			pointerEvents="box-none"
			style={{
				position: "absolute",
				left: 12,
				right: 12,
				bottom: bottomOffset,
				opacity,
			}}
		>
			<View
				style={{
					backgroundColor: bg,
					borderRadius: 14,
					paddingHorizontal: 14,
					paddingVertical: 12,
					flexDirection: "row",
					alignItems: "center",
					gap: 12,
					shadowColor: "#000",
					shadowOffset: { width: 0, height: 4 },
					shadowOpacity: 0.25,
					shadowRadius: 10,
					elevation: 6,
				}}
			>
				<Text style={{ color: fg, flex: 1, fontSize: 14 }} numberOfLines={2}>
					{state.message}
				</Text>
				{state.actionLabel ? (
					<Pressable
						onPress={() => {
							state.onAction?.();
							toast.dismiss();
						}}
						hitSlop={10}
					>
						<Text style={{ color: colors.primary, fontWeight: "600", fontSize: 14 }}>
							{state.actionLabel}
						</Text>
					</Pressable>
				) : null}
			</View>
			<Animated.View
				style={{
					marginTop: 4,
					height: 2,
					borderRadius: 2,
					backgroundColor: colors.mutedForeground,
					width: progressWidth,
					opacity: 0.6,
				}}
			/>
		</Animated.View>
	);
}
