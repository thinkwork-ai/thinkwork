import { View, Pressable, Modal, StyleSheet, Animated } from "react-native";
import { useRef, useEffect } from "react";
import { Text } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ActionItem {
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  actions: ActionItem[];
  title?: string;
}

export function ActionSheet({ visible, onClose, actions, title }: ActionSheetProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 1,
          damping: 20,
          stiffness: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      slideAnim.setValue(0);
      fadeAnim.setValue(0);
    }
  }, [visible]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const handleAction = (action: ActionItem) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      onClose();
      setTimeout(action.onPress, 50);
    });
  };

  if (!visible) return null;

  const bg = isDark ? "#2c2c2e" : "#f2f2f7";
  const itemBg = isDark ? "#3a3a3c" : "#ffffff";
  const separator = isDark ? "#48484a" : "#d1d1d6";
  const textColor = isDark ? "#ffffff" : "#007aff";
  const destructiveColor = "#ff3b30";
  const disabledColor = isDark ? "#6b7280" : "#9ca3af";

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <View style={StyleSheet.absoluteFill}>
        {/* Backdrop */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.4)", opacity: fadeAnim }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </Animated.View>

        {/* Sheet */}
        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [
                {
                  translateY: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [300, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Actions group */}
          <View style={[styles.group, { backgroundColor: bg }]}>
            {title && (
              <View style={[styles.titleRow, { borderBottomColor: separator }]}>
                <Text
                  style={{ color: isDark ? "#8e8e93" : "#8e8e93", fontSize: 13, textAlign: "center" }}
                >
                  {title}
                </Text>
              </View>
            )}
            {actions.map((action, i) => (
              <Pressable
                key={i}
                disabled={action.disabled}
                onPress={() => !action.disabled && handleAction(action)}
                style={({ pressed }) => [
                  styles.actionRow,
                  {
                    backgroundColor: action.disabled
                      ? itemBg
                      : pressed
                        ? (isDark ? "#48484a" : "#e5e5ea")
                        : itemBg,
                    opacity: action.disabled ? 0.5 : 1,
                  },
                  i < actions.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: separator,
                  },
                  i === 0 && styles.firstRow,
                  i === actions.length - 1 && styles.lastRow,
                ]}
              >
                {action.icon && <View style={styles.icon}>{action.icon}</View>}
                <Text
                  style={{
                    fontSize: 20,
                    color: action.disabled ? disabledColor : action.destructive ? destructiveColor : textColor,
                    fontWeight: "400",
                  }}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Cancel button */}
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [
              styles.cancelButton,
              {
                backgroundColor: pressed ? (isDark ? "#48484a" : "#e5e5ea") : itemBg,
              },
            ]}
          >
            <Text style={{ fontSize: 20, fontWeight: "600", color: textColor }}>
              Cancel
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 8,
  },
  group: {
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 8,
  },
  titleRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  firstRow: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  lastRow: {
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  icon: {
    marginRight: 10,
  },
  cancelButton: {
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
  },
});
