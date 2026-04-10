import { View, Platform } from "react-native";

/**
 * Constrains content to max 768px width on web.
 * Use inside ScrollView/FlatList so the scrollbar stays at the page edge.
 * Header stays full-width (don't wrap it in this).
 */
export function WebContent({ children, centered = true, bordered = false }: { children: React.ReactNode; centered?: boolean; bordered?: boolean }) {
  if (Platform.OS !== "web") {
    return <>{children}</>;
  }

  return (
    <View
      style={{
        maxWidth: 768,
        width: "100%",
        alignSelf: centered ? "center" : "flex-start",
        ...(bordered && {
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
          borderRadius: 16,
          marginTop: 24,
          overflow: "hidden",
        }),
      }}
    >
      {children}
    </View>
  );
}
