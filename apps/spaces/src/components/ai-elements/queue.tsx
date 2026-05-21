"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type QueueProps = ComponentProps<"section">;

export const Queue = ({ className, ...props }: QueueProps) => (
  <section
    className={cn(
      "not-prose grid w-full gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm",
      className,
    )}
    {...props}
  />
);

export type QueueHeaderProps = ComponentProps<"div">;

export const QueueHeader = ({ className, ...props }: QueueHeaderProps) => (
  <div className={cn("grid min-w-0 gap-1.5", className)} {...props} />
);

export type QueueTitleProps = ComponentProps<"h3">;

export const QueueTitle = ({ className, ...props }: QueueTitleProps) => (
  <h3
    className={cn(
      "text-pretty break-words font-semibold text-base leading-6",
      className,
    )}
    {...props}
  />
);

export type QueueDescriptionProps = ComponentProps<"p">;

export const QueueDescription = ({
  className,
  ...props
}: QueueDescriptionProps) => (
  <p
    className={cn(
      "text-pretty break-words text-muted-foreground text-sm leading-6",
      className,
    )}
    {...props}
  />
);

export type QueueListProps = ComponentProps<"div">;

export const QueueList = ({ className, ...props }: QueueListProps) => (
  <div className={cn("grid min-w-0 gap-4", className)} {...props} />
);

export type QueueGroupProps = ComponentProps<"section">;

export const QueueGroup = ({ className, ...props }: QueueGroupProps) => (
  <section className={cn("grid min-w-0 gap-2", className)} {...props} />
);

export type QueueGroupTitleProps = ComponentProps<"h4">;

export const QueueGroupTitle = ({
  className,
  ...props
}: QueueGroupTitleProps) => (
  <h4
    className={cn(
      "text-pretty break-words font-medium text-foreground text-sm leading-5",
      className,
    )}
    {...props}
  />
);

export type QueueItemProps = ComponentProps<"div">;

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
  <div
    className={cn(
      "grid min-w-0 grid-cols-[1rem_1fr_auto] items-start gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2.5",
      className,
    )}
    {...props}
  />
);
