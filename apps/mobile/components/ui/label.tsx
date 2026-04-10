import * as React from "react";
import { Text, View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

/**
 * Label ported from packages/admin/src/components/ui/label.tsx
 * text-sm font-medium leading-none
 */

interface LabelProps extends ViewProps {
  children?: React.ReactNode;
  disabled?: boolean;
}

function Label({ className, children, disabled, ...props }: LabelProps) {
  return (
    <View
      className={cn(
        "gap-2 flex-row items-center",
        disabled && "opacity-50",
        className
      )}
      {...props}
    >
      {typeof children === "string" ? (
        <Text className="text-sm font-medium leading-none text-foreground">
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

export { Label };
