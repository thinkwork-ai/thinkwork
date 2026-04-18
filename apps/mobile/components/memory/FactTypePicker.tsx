import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
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
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
			<Pressable onPress={onClose} style={styles.backdrop}>
				{/* Anchor the sheet to the bottom and make it full-width via
				    left/right: 0. Using justifyContent on the backdrop was
				    letting the inner sheet size to its content on iOS, which
				    in turn collapsed the row flex direction. */}
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
						<Text style={[styles.title, { color: colors.foreground }]}>Memory type</Text>
						<Muted style={styles.subtitle}>Pick how this memory should be retrieved later.</Muted>
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
								style={({ pressed }) => [
									styles.row,
									{ backgroundColor: pressed ? colors.secondary : "transparent" },
								]}
							>
								<View style={styles.iconCol}>
									<Icon size={22} color={active ? colors.primary : colors.foreground} />
								</View>
								<Text
									numberOfLines={1}
									style={{
										color: colors.foreground,
										fontSize: 16,
										fontWeight: active ? "600" : "500",
									}}
								>
									{FACT_TYPE_LABELS[type]}
								</Text>
							</Pressable>
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
		paddingBottom: 8,
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
		alignItems: "flex-start",
		justifyContent: "center",
		marginRight: 10,
	},
});
