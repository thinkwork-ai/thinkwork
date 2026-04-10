import * as React from "react";
import { View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

/**
 * Separator ported from packages/admin/src/components/ui/separator.tsx
 * bg-border, horizontal/vertical orientation
 */

interface SeparatorProps extends ViewProps {
  orientation?: "horizontal" | "vertical";
}

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorProps) {
  return (
    <View
      className={cn(
        "bg-neutral-200 dark:bg-neutral-800 shrink-0",
        orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
        className
      )}
      {...props}
    />
  );
}

export { Separator };
