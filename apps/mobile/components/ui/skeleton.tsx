import * as React from "react";
import { View, type ViewProps, Animated, Platform } from "react-native";
import { cn } from "@/lib/utils";

/**
 * Skeleton ported from packages/admin/src/components/ui/skeleton.tsx
 * bg-muted rounded-md animate-pulse
 */

function Skeleton({ className, style, ...props }: ViewProps) {
  const opacity = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  // On web, use CSS animation; on native, use Animated
  if (Platform.OS === "web") {
    return (
      <View
        className={cn("bg-neutral-200 dark:bg-neutral-800 rounded-md animate-pulse", className)}
        style={style}
        {...props}
      />
    );
  }

  return (
    <Animated.View
      className={cn("bg-neutral-200 dark:bg-neutral-800 rounded-md", className)}
      style={[style, { opacity }]}
      {...props}
    />
  );
}

export { Skeleton };
