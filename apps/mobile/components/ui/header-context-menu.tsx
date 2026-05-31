import React, { useRef, useState, useCallback } from "react";
import { View, Pressable, Modal, Dimensions } from "react-native";
import { MoreHorizontal } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import {
  FloatingMenuItem,
  FloatingMenuSurface,
} from "@/components/ui/floating-menu";

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
  const [anchor, setAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
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
      <Pressable
        ref={triggerRef}
        onPress={open}
        className={trigger ? "" : "p-2"}
      >
        {trigger ?? <MoreHorizontal size={22} color={colors.foreground} />}
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable className="flex-1" onPress={() => setVisible(false)}>
          <View
            style={{
              position: "absolute",
              top: dropdownTop,
              right: dropdownRight,
            }}
          >
            <FloatingMenuSurface style={{ minWidth: 200, maxWidth: 280 }}>
              {items.map((item) => (
                <FloatingMenuItem
                  key={item.label}
                  label={item.label}
                  icon={item.icon}
                  destructive={item.destructive}
                  separator={item.separator}
                  onPress={() => {
                    setVisible(false);
                    item.onPress();
                  }}
                />
              ))}
            </FloatingMenuSurface>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
