import React from "react";
import { View } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { Text } from "./typography";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "flex-row items-center self-start rounded-full px-2.5 py-0.5",
  {
    variants: {
      variant: {
        default: "bg-sky-500",
        secondary: "bg-neutral-100 dark:bg-neutral-800",
        destructive: "bg-red-100 dark:bg-red-900/30 border border-red-500/50",
        outline: "border border-neutral-300 dark:border-neutral-700 bg-transparent",
        success: "bg-green-100 dark:bg-green-900/30 border border-green-500/50",
        warning: "bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-500/50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const badgeTextVariants = cva("text-xs font-medium", {
  variants: {
    variant: {
      default: "text-white",
      secondary: "text-neutral-700 dark:text-neutral-300",
      destructive: "text-red-600 dark:text-red-400",
      outline: "text-neutral-700 dark:text-neutral-300",
      success: "text-green-700 dark:text-green-400",
      warning: "text-yellow-700 dark:text-yellow-400",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: React.ReactNode;
  className?: string;
  textClassName?: string;
  icon?: React.ReactNode;
}

export function Badge({
  variant,
  children,
  className,
  textClassName,
  icon,
}: BadgeProps) {
  return (
    <View className={cn(badgeVariants({ variant }), className)}>
      {icon && <View className="mr-1">{icon}</View>}
      <Text className={cn(badgeTextVariants({ variant }), textClassName)} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

// Pre-styled status badges
export function StatusBadge({
  status,
  className,
}: {
  status: "online" | "offline" | "unknown" | "revoked" | "pending" | "starting" | "updating" | "stopped";
  className?: string;
}) {
  const config = {
    online: { variant: "success" as const, label: "Online", dotColor: "bg-green-600" },
    offline: { variant: "outline" as const, label: "Offline", dotColor: "bg-neutral-400 dark:bg-neutral-500" },
    unknown: { variant: "outline" as const, label: "Unknown", dotColor: "bg-neutral-400 dark:bg-neutral-500" },
    revoked: { variant: "destructive" as const, label: "Revoked", dotColor: "bg-red-500" },
    pending: { variant: "warning" as const, label: "Pending", dotColor: "bg-yellow-600" },
    starting: { variant: "warning" as const, label: "Starting", dotColor: "bg-sky-500" },
    updating: { variant: "warning" as const, label: "Updating", dotColor: "bg-sky-500" },
    stopped: { variant: "outline" as const, label: "Stopped", dotColor: "bg-neutral-400 dark:bg-neutral-500" },
  };

  const { variant, label, dotColor } = config[status];

  return (
    <View className={cn(badgeVariants({ variant }), "gap-1", className)}>
      <View className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
      <Text className={badgeTextVariants({ variant })}>{label}</Text>
    </View>
  );
}
