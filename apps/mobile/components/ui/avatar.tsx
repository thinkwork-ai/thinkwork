import * as React from "react";
import { View, Image, Text, type ViewProps, type ImageProps } from "react-native";
import { cn } from "@/lib/utils";

/**
 * Avatar ported from packages/admin/src/components/ui/avatar.tsx
 * Sizes: default=32px (h-8), sm=24px (h-6), lg=40px (h-10)
 */

interface AvatarProps extends ViewProps {
  size?: "default" | "sm" | "lg";
}

const AvatarContext = React.createContext<{ size: "default" | "sm" | "lg" }>({
  size: "default",
});

function Avatar({ className, size = "default", children, ...props }: AvatarProps) {
  const sizeClass = {
    default: "h-8 w-8",
    sm: "h-6 w-6",
    lg: "h-10 w-10",
  }[size];

  return (
    <AvatarContext.Provider value={{ size }}>
      <View
        className={cn(
          "rounded-full overflow-hidden relative shrink-0",
          sizeClass,
          className
        )}
        {...props}
      >
        {children}
      </View>
    </AvatarContext.Provider>
  );
}

interface AvatarImageProps extends Omit<ImageProps, "source"> {
  src?: string;
  source?: ImageProps["source"];
}

function AvatarImage({ className, src, source, ...props }: AvatarImageProps) {
  const imageSource = source || (src ? { uri: src } : undefined);

  if (!imageSource) return null;

  return (
    <Image
      className={cn("rounded-full aspect-square w-full h-full", className)}
      source={imageSource}
      {...props}
    />
  );
}

interface AvatarFallbackProps extends ViewProps {
  children?: React.ReactNode;
}

function AvatarFallback({ className, children, ...props }: AvatarFallbackProps) {
  const { size } = React.useContext(AvatarContext);
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  return (
    <View
      className={cn(
        "bg-muted rounded-full w-full h-full items-center justify-center",
        className
      )}
      {...props}
    >
      {typeof children === "string" ? (
        <Text className={cn("text-muted-foreground font-medium", textSize)}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

interface AvatarBadgeProps extends ViewProps {
  children?: React.ReactNode;
}

function AvatarBadge({ className, ...props }: AvatarBadgeProps) {
  return (
    <View
      className={cn(
        "bg-primary absolute right-0 bottom-0 rounded-full h-2.5 w-2.5 border-2 border-background",
        className
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback, AvatarBadge };
