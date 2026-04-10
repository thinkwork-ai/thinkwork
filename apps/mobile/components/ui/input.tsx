import * as React from "react";
import {
  TextInput,
  type TextInputProps,
  View,
  Text,
  Platform,
  useColorScheme,
} from "react-native";
import { cn } from "@/lib/utils";

/**
 * Input ported from packages/admin/src/components/ui/input.tsx
 * h-8, rounded-lg, dark:bg-input/30, focus ring styling
 */

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerClassName?: string;
  compact?: boolean;
}

const Input = React.forwardRef<TextInput, InputProps>(
  (
    { className, label, error, containerClassName, compact, onFocus, onBlur, ...props },
    ref
  ) => {
    const [isFocused, setIsFocused] = React.useState(false);
    const colorScheme = useColorScheme();

    const handleFocus = React.useCallback(
      (e: any) => {
        setIsFocused(true);
        onFocus?.(e);
      },
      [onFocus]
    );

    const handleBlur = React.useCallback(
      (e: any) => {
        setIsFocused(false);
        onBlur?.(e);
      },
      [onBlur]
    );

    // Use actual colors for placeholder (CSS vars don't work on native)
    const placeholderColor = colorScheme === "dark" ? "#a3a3a3" : "#737373";

    return (
      <View className={cn("w-full", containerClassName)}>
        {label && (
          <Text className={`${compact ? "mb-1.5 text-sm" : "mb-2 text-base"} font-medium leading-none text-neutral-900 dark:text-neutral-100`}>
            {label}
          </Text>
        )}
        <TextInput
          ref={ref}
          className={cn(
            "w-full rounded-xl border bg-transparent px-4 text-neutral-900 dark:text-neutral-100",
            isFocused ? "border-ring" : error ? "border-destructive" : "border-neutral-300 dark:border-neutral-700",
            Platform.OS === "web" && "outline-none",
            className
          )}
          style={[
            {
              height: compact ? 40 : 56,
              fontSize: compact ? 14 : 18,
              lineHeight: compact ? 18 : 22,
            },
            Platform.OS === "android" && { textAlignVertical: "center" as const },
            Platform.OS === "web" && isFocused
              ? ({
                  boxShadow:
                    "0 0 0 3px oklch(0.708 0 0 / 0.5)",
                } as any)
              : undefined,
          ].filter(Boolean)}
          placeholderTextColor={placeholderColor}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
        {error && (
          <Text className="mt-1 text-sm text-destructive">{error}</Text>
        )}
      </View>
    );
  }
);

Input.displayName = "Input";

export { Input };
