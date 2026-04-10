import * as React from "react";
import {
  Pressable,
  Text,
  ActivityIndicator,
  type PressableProps,
} from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button variants ported from packages/admin/src/components/ui/button.tsx
 * Adapted for React Native (no :hover pseudo-classes, use active: instead)
 */
const buttonVariants = cva(
  "rounded-xl items-center justify-center flex-row active:opacity-90 disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary",
        outline: "border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 active:bg-neutral-100 dark:active:bg-neutral-800",
        secondary: "bg-secondary active:bg-secondary/80",
        ghost: "active:bg-muted",
        destructive: "bg-destructive/10 active:bg-destructive/20",
        link: "",
      },
      size: {
        default: "h-14 gap-2 px-5",
        xs: "h-8 gap-1 rounded-md px-2.5",
        sm: "h-10 gap-1.5 rounded-lg px-3",
        lg: "h-16 gap-2 px-6",
        icon: "h-14 w-14",
        "icon-xs": "h-8 w-8 rounded-md",
        "icon-sm": "h-10 w-10 rounded-lg",
        "icon-lg": "h-16 w-16",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const buttonTextVariants = cva("font-semibold", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      outline: "text-foreground",
      secondary: "text-secondary-foreground",
      ghost: "text-foreground",
      destructive: "text-destructive",
      link: "text-primary underline",
    },
    size: {
      default: "text-base",
      xs: "text-xs",
      sm: "text-sm",
      lg: "text-lg",
      icon: "text-base",
      "icon-xs": "text-xs",
      "icon-sm": "text-sm",
      "icon-lg": "text-lg",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps
  extends Omit<PressableProps, "children">,
    VariantProps<typeof buttonVariants> {
  className?: string;
  textClassName?: string;
  loading?: boolean;
  children?: React.ReactNode;
}

const Button = React.forwardRef<React.ElementRef<typeof Pressable>, ButtonProps>(
  (
    {
      className,
      textClassName,
      variant,
      size,
      disabled,
      loading,
      children,
      ...props
    },
    ref
  ) => {
    const getIndicatorColor = () => {
      if (variant === "default") return "var(--primary-foreground)";
      if (variant === "destructive") return "var(--destructive)";
      return "var(--foreground)";
    };

    return (
      <Pressable
        ref={ref}
        className={cn(
          buttonVariants({ variant, size }),
          disabled && "opacity-50",
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <ActivityIndicator size="small" color={getIndicatorColor()} />
        ) : typeof children === "string" ? (
          <Text className={cn(buttonTextVariants({ variant, size }), textClassName)}>
            {children}
          </Text>
        ) : (
          children
        )}
      </Pressable>
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants, buttonTextVariants };
