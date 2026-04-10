import React, { useRef, useState, useCallback } from "react";
import { View, Pressable, Modal, Dimensions } from "react-native";
import { MoreHorizontal } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

interface MenuItem {
  label: string;
  icon?: React.ComponentType<{ size: number; color: string }>;
  onPress: () => void;
  destructive?: boolean;
  separator?: boolean;
}

interface HeaderContextMenuProps {
  items: MenuItem[];
  trigger?: React.ReactNode;
}

export function HeaderContextMenu({ items, trigger }: HeaderContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const triggerRef = useRef<View>(null);
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const open = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setVisible(true);
    });
  }, []);

  const screenWidth = Dimensions.get("window").width;
  const dropdownTop = anchor ? anchor.y + anchor.height + 6 : 0;
  const dropdownRight = anchor ? screenWidth - (anchor.x + anchor.width) : 16;

  return (
    <>
      <Pressable ref={triggerRef} onPress={open} className={trigger ? "" : "p-2"}>
        {trigger ?? <MoreHorizontal size={22} color={colors.foreground} />}
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable className="flex-1" onPress={() => setVisible(false)}>
          <View
            style={{
              position: "absolute",
              top: dropdownTop,
              right: dropdownRight,
              minWidth: 200,
              maxWidth: 280,
              backgroundColor: colorScheme === "dark" ? "#1c1c1e" : "#ffffff",
              borderRadius: 12,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: colorScheme === "dark" ? 0.5 : 0.15,
              shadowRadius: 12,
              elevation: 8,
              borderWidth: 1,
              borderColor: colorScheme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
            }}
          >
            {items.map((item, index) => {
              const isLast = index === items.length - 1;
              const Icon = item.icon;
              const itemColor = item.destructive ? "#ef4444" : colors.foreground;
              return (
                <Pressable
                  key={item.label}
                  onPress={() => {
                    setVisible(false);
                    item.onPress();
                  }}
                  className="flex-row items-center gap-3 px-4 py-2.5"
                  style={
                    item.separator
                      ? {
                          borderTopWidth: 0.5,
                          borderTopColor:
                            colorScheme === "dark"
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,0,0,0.06)",
                        }
                      : undefined
                  }
                >
                  {Icon && <Icon size={16} color={itemColor} />}
                  <Text style={{ color: itemColor }}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
