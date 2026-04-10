import React, { forwardRef, useImperativeHandle, useState } from "react";
import { View, Pressable, ActivityIndicator, Modal } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Globe } from "lucide-react-native";
import { WebView } from "react-native-webview";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface WebViewSheetRef {
  open: (url: string) => void;
  close: () => void;
}

export const WebViewSheet = forwardRef<WebViewSheetRef>((_, ref) => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTitle, setCurrentTitle] = useState("");

  useImperativeHandle(ref, () => ({
    open: (newUrl: string) => {
      setUrl(newUrl);
      setLoading(true);
      setCurrentTitle("");
      setVisible(true);
    },
    close: () => {
      setVisible(false);
    },
  }));

  const handleClose = () => {
    setVisible(false);
    setUrl(null);
    setCurrentTitle("");
  };

  const displayHost = url ? (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })() : "";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: isDark ? "#1c1c1e" : "#ffffff", paddingTop: insets.top }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <View className="flex-row items-center gap-2 flex-1 mr-2">
            <Globe size={16} color={colors.mutedForeground} />
            <Text className="text-sm text-neutral-500 dark:text-neutral-400 flex-1" numberOfLines={1}>
              {currentTitle || displayHost}
            </Text>
          </View>
          <Pressable onPress={handleClose} className="p-1 active:opacity-70">
            <X size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* WebView */}
        <View style={{ flex: 1 }}>
          {loading && (
            <View className="absolute inset-0 items-center justify-center z-10">
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}
          {url && (
            <WebView
              source={{ uri: url }}
              style={{ flex: 1, backgroundColor: isDark ? "#000" : "#fff" }}
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={(navState) => {
                if (navState.title) setCurrentTitle(navState.title);
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
});
