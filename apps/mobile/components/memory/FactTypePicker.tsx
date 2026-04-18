import React from "react";
import { Modal, Pressable, View } from "react-native";
import { Lightbulb, CheckCircle2, Sparkles, MessageSquare } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/lib/theme";
import { FACT_TYPE_LABELS, type FactType } from "./FactTypeChip";

interface FactTypePickerProps {
	visible: boolean;
	onClose: () => void;
	onSelect: (type: FactType) => void;
	current?: FactType;
}

const ORDER: FactType[] = ["FACT", "PREFERENCE", "EXPERIENCE", "OBSERVATION"];

const ICONS: Record<FactType, React.ComponentType<{ size?: number; color?: string }>> = {
	FACT: MessageSquare,
	PREFERENCE: CheckCircle2,
	EXPERIENCE: Sparkles,
	OBSERVATION: Lightbulb,
};

export function FactTypePicker({ visible, onClose, onSelect, current }: FactTypePickerProps) {
	const { colorScheme } = useColorScheme();
	const isDark = colorScheme === "dark";
	const colors = isDark ? COLORS.dark : COLORS.light;
	const insets = useSafeAreaInsets();

	return (
		<Modal
			visible={visible}
			transparent
			animationType="slide"
			onRequestClose={onClose}
		>
			<Pressable
				onPress={onClose}
				style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
			>
				<Pressable
					onPress={() => {}}
					style={{
						backgroundColor: colors.card,
						borderTopLeftRadius: 20,
						borderTopRightRadius: 20,
						paddingTop: 12,
						paddingBottom: Math.max(insets.bottom, 16),
					}}
				>
					<View style={{ alignItems: "center", paddingVertical: 8 }}>
						<View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
					</View>
					<View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
						<Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground }}>
							Memory type
						</Text>
						<Muted style={{ fontSize: 13, marginTop: 2 }}>
							Pick how this memory should be retrieved later.
						</Muted>
					</View>
					{ORDER.map((type) => {
						const Icon = ICONS[type];
						const active = current === type;
						return (
							<Pressable
								key={type}
								onPress={() => {
									onSelect(type);
									onClose();
								}}
								style={({ pressed }) => ({
									backgroundColor: pressed ? colors.secondary : "transparent",
								})}
							>
								<View
									style={{
										flexDirection: "row",
										alignItems: "center",
										paddingVertical: 14,
										paddingHorizontal: 20,
										gap: 14,
									}}
								>
									<View
										style={{
											width: 28,
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										<Icon
											size={22}
											color={active ? colors.primary : colors.foreground}
										/>
									</View>
									<Text
										style={{
											color: colors.foreground,
											fontWeight: active ? "600" : "500",
											fontSize: 16,
										}}
									>
										{FACT_TYPE_LABELS[type]}
									</Text>
								</View>
							</Pressable>
						);
					})}
				</Pressable>
			</Pressable>
		</Modal>
	);
}
