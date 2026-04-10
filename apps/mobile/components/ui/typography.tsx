import * as React from "react";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Typography components matching the admin dashboard's text styles
 * Based on Tailwind defaults + shadcn conventions
 */

const textVariants = cva("", {
  variants: {
    variant: {
      default: "text-neutral-900 dark:text-neutral-100",
      muted: "text-neutral-500 dark:text-neutral-400",
      destructive: "text-red-500",
      primary: "text-orange-500",
    },
    size: {
      xs: "text-xs", // 12px
      sm: "text-sm", // 14px
      base: "text-base", // 16px (RN default)
      lg: "text-lg", // 18px
      xl: "text-xl", // 20px
      "2xl": "text-2xl", // 24px
      "3xl": "text-3xl", // 30px
      "4xl": "text-4xl", // 36px
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
    },
    leading: {
      none: "leading-none",
      tight: "leading-tight",
      snug: "leading-snug",
      normal: "leading-normal",
      relaxed: "leading-relaxed",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "base",
    weight: "normal",
    leading: "normal",
  },
});

export interface TextProps
  extends RNTextProps,
    VariantProps<typeof textVariants> {
  className?: string;
}

const Text = React.forwardRef<RNText, TextProps>(
  ({ className, variant, size, weight, leading, ...props }, ref) => (
    <RNText
      ref={ref}
      className={cn(textVariants({ variant, size, weight, leading }), className)}
      {...props}
    />
  )
);
Text.displayName = "Text";

// Card/Section Title - matches CardTitle from packages/admin
const H1 = React.forwardRef<RNText, Omit<TextProps, "size" | "weight" | "leading">>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      size="4xl"
      weight="bold"
      leading="tight"
      className={cn("tracking-tight", className)}
      {...props}
    />
  )
);
H1.displayName = "H1";

const H2 = React.forwardRef<RNText, Omit<TextProps, "size" | "weight" | "leading">>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      size="3xl"
      weight="semibold"
      leading="tight"
      className={cn("tracking-tight", className)}
      {...props}
    />
  )
);
H2.displayName = "H2";

const H3 = React.forwardRef<RNText, Omit<TextProps, "size" | "weight" | "leading">>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      size="2xl"
      weight="semibold"
      leading="tight"
      className={cn("tracking-tight", className)}
      {...props}
    />
  )
);
H3.displayName = "H3";

// Matches packages/admin's CardTitle styling
const H4 = React.forwardRef<RNText, Omit<TextProps, "size" | "weight" | "leading">>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      size="base"
      weight="medium"
      leading="snug"
      className={className}
      {...props}
    />
  )
);
H4.displayName = "H4";

// Large muted text for descriptions
const Lead = React.forwardRef<RNText, Omit<TextProps, "size" | "variant">>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      size="xl"
      variant="muted"
      className={className}
      {...props}
    />
  )
);
Lead.displayName = "Lead";

// Small muted text - matches CardDescription styling
const Muted = React.forwardRef<RNText, Omit<TextProps, "variant" | "size">>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      variant="muted"
      size="sm"
      className={className}
      {...props}
    />
  )
);
Muted.displayName = "Muted";

// Small medium text
const Small = React.forwardRef<RNText, Omit<TextProps, "size" | "weight" | "leading">>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      size="sm"
      weight="medium"
      leading="none"
      className={className}
      {...props}
    />
  )
);
Small.displayName = "Small";

export { Text, textVariants, H1, H2, H3, H4, Lead, Muted, Small };
