"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type ConfirmationProps = ComponentProps<"section">;

export const Confirmation = ({ className, ...props }: ConfirmationProps) => (
  <section
    className={cn(
      "not-prose grid w-full gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm",
      className,
    )}
    {...props}
  />
);

export type ConfirmationHeaderProps = ComponentProps<"div">;

export const ConfirmationHeader = ({
  className,
  ...props
}: ConfirmationHeaderProps) => (
  <div className={cn("grid min-w-0 gap-1.5", className)} {...props} />
);

export type ConfirmationTitleProps = ComponentProps<"h3">;

export const ConfirmationTitle = ({
  className,
  ...props
}: ConfirmationTitleProps) => (
  <h3
    className={cn(
      "text-pretty break-words font-semibold text-base leading-6",
      className,
    )}
    {...props}
  />
);

export type ConfirmationDescriptionProps = ComponentProps<"p">;

export const ConfirmationDescription = ({
  className,
  ...props
}: ConfirmationDescriptionProps) => (
  <p
    className={cn(
      "text-pretty break-words text-muted-foreground text-sm leading-6",
      className,
    )}
    {...props}
  />
);

export type ConfirmationContentProps = ComponentProps<"div">;

export const ConfirmationContent = ({
  className,
  ...props
}: ConfirmationContentProps) => (
  <div className={cn("grid min-w-0 gap-3", className)} {...props} />
);

export type ConfirmationActionsProps = ComponentProps<"div">;

export const ConfirmationActions = ({
  className,
  ...props
}: ConfirmationActionsProps) => (
  <div
    className={cn("flex flex-wrap items-center gap-2", className)}
    {...props}
  />
);
