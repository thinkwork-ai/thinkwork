import React, { useRef, useState, useCallback } from "react";
import { View, Pressable, FlatList, Modal, Dimensions } from "react-native";
import { Text } from "@/components/ui/typography";
import { Check } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

interface Agent {
  _id: string;
  name: string;
  role?: string;
  connectionStatus?: string;
}

interface AgentPickerProps {
  agents: Agent[];
  selectedId: string;
  onSelect: (agent: Agent) => void;
  children: React.ReactElement;
  /** Which edge of the trigger to align the dropdown to. Default: "start" (left). */
  anchor?: "start" | "end";
}

export function AgentPicker({ agents, selectedId, onSelect, children, anchor: anchorSide = "start" }: AgentPickerProps) {
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

  return (
    <>
      <Pressable ref={triggerRef} onPress={open}>
        {children}
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable className="flex-1" onPress={() => setVisible(false)}>
          <View
            style={{
              position: "absolute",
              top: dropdownTop,
              ...(anchorSide === "end"
                ? { right: anchor ? screenWidth - (anchor.x + anchor.width) : 16 }
                : { left: anchor ? anchor.x : 16 }),
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
            <FlatList
              data={agents}
              keyExtractor={(item) => item._id}
              scrollEnabled={agents.length > 5}
              style={{ maxHeight: 300 }}
              renderItem={({ item, index }) => {
                const isSelected = item._id === selectedId;
                const isLast = index === agents.length - 1;
                return (
                  <Pressable
                    onPress={() => {
                      onSelect(item);
                      setVisible(false);
                    }}
                    className="flex-row items-center justify-between px-3.5 py-3"
                    style={!isLast ? {
                      borderBottomWidth: 0.5,
                      borderBottomColor: colorScheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                    } : undefined}
                  >
                    <View className="flex-row items-center flex-1">
                      <Text size="sm" weight={isSelected ? "semibold" : "regular"} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                    {isSelected && <Check size={16} color={colors.primary} />}
                  </Pressable>
                );
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
