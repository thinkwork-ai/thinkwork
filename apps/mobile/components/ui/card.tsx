import * as React from "react";
import { View, Text, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

/**
 * Card components with dark mode support
 */

interface CardProps extends ViewProps {
  size?: "default" | "sm";
}

const Card = React.forwardRef<View, CardProps>(
  ({ className, size = "default", ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "bg-white dark:bg-neutral-900 overflow-hidden rounded-xl",
        "border border-neutral-200 dark:border-neutral-800",
        size === "default" ? "gap-4 py-4" : "gap-3 py-3",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<View, ViewProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("gap-1 px-4", className)}
      {...props}
    />
  )
);
CardHeader.displayName = "CardHeader";

interface CardTitleProps extends ViewProps {
  children?: React.ReactNode;
}

const CardTitle = React.forwardRef<View, CardTitleProps>(
  ({ className, children, ...props }, ref) => (
    <View ref={ref} className={className} {...props}>
      {typeof children === "string" ? (
        <Text className="text-base font-medium leading-snug text-neutral-900 dark:text-neutral-100">
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  )
);
CardTitle.displayName = "CardTitle";

interface CardDescriptionProps extends ViewProps {
  children?: React.ReactNode;
}

const CardDescription = React.forwardRef<View, CardDescriptionProps>(
  ({ className, children, ...props }, ref) => (
    <View ref={ref} className={className} {...props}>
      {typeof children === "string" ? (
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">{children}</Text>
      ) : (
        children
      )}
    </View>
  )
);
CardDescription.displayName = "CardDescription";

const CardAction = React.forwardRef<View, ViewProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("self-start", className)}
      {...props}
    />
  )
);
CardAction.displayName = "CardAction";

const CardContent = React.forwardRef<View, ViewProps>(
  ({ className, ...props }, ref) => (
    <View ref={ref} className={cn("px-4", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<View, ViewProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "flex-row items-center bg-neutral-100 dark:bg-neutral-800/50",
        "border-t border-neutral-200 dark:border-neutral-800 rounded-b-xl p-4",
        className
      )}
      {...props}
    />
  )
);
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
