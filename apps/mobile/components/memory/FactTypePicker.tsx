import React from "react";
import {
	Modal,
	Pressable,
	StyleSheet,
	Text as RNText,
	TouchableOpacity,
	View,
} from "react-native";
import { Lightbulb, CheckCircle2, Sparkles, MessageSquare } from "lucide-react-native";
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

	// Fully custom sheet rendered via raw RN primitives. Prior attempts
	// using the nativewind-wrapped Text inside a Pressable row kept
	// collapsing flexDirection: row into a vertical stack — this version
	// uses RNText + TouchableOpacity + StyleSheet.create to take
	// className-driven styling out of the picture entirely.
	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
			<Pressable onPress={onClose} style={styles.backdrop}>
				<View
					style={[
						styles.sheet,
						{
							backgroundColor: colors.card,
							paddingBottom: Math.max(insets.bottom, 16),
						},
					]}
					onStartShouldSetResponder={() => true}
				>
					<View style={styles.handleRow}>
						<View style={[styles.handle, { backgroundColor: colors.border }]} />
					</View>
					<View style={styles.titleBlock}>
						<RNText style={[styles.title, { color: colors.foreground }]}>Memory type</RNText>
						<RNText style={[styles.subtitle, { color: colors.mutedForeground }]}>
							Pick how this memory should be retrieved later.
						</RNText>
					</View>
					{ORDER.map((type) => {
						const Icon = ICONS[type];
						const active = current === type;
						return (
							<TouchableOpacity
								key={type}
								activeOpacity={0.6}
								onPress={() => {
									onSelect(type);
									onClose();
								}}
								style={styles.row}
							>
								<View style={styles.iconCol}>
									<Icon size={22} color={active ? colors.primary : colors.foreground} />
								</View>
								<RNText
									numberOfLines={1}
									style={[
										styles.label,
										{
											color: colors.foreground,
											fontWeight: active ? "600" : "500",
										},
									]}
								>
									{FACT_TYPE_LABELS[type]}
								</RNText>
							</TouchableOpacity>
						);
					})}
				</View>
			</Pressable>
		</Modal>
	);
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		backgroundColor: "rgba(0,0,0,0.45)",
	},
	sheet: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		paddingTop: 12,
	},
	handleRow: {
		alignItems: "center",
		paddingVertical: 8,
	},
	handle: {
		width: 40,
		height: 4,
		borderRadius: 2,
	},
	titleBlock: {
		paddingHorizontal: 20,
		paddingBottom: 12,
	},
	title: {
		fontSize: 17,
		fontWeight: "600",
	},
	subtitle: {
		fontSize: 13,
		marginTop: 2,
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		paddingVertical: 14,
		paddingHorizontal: 20,
	},
	iconCol: {
		width: 32,
		marginRight: 12,
		alignItems: "flex-start",
		justifyContent: "center",
	},
	label: {
		fontSize: 16,
		flexShrink: 1,
	},
});
