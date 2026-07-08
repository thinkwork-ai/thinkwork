"use client";

import * as React from "react";

import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.js";

type TooltipSide = React.ComponentProps<typeof TooltipContent>["side"];
type TooltipAlign = React.ComponentProps<typeof TooltipContent>["align"];

/**
 * A ghost icon button with a theme-aware hover popover tooltip — the canonical
 * pattern for page-header action icons. The tooltip surface uses `bg-popover` /
 * `text-popover-foreground` (not the default dark `bg-foreground`) so it reads
 * correctly in both light and dark themes, matching the memory header.
 *
 * `label` is both the tooltip text and the accessible name (`aria-label`),
 * unless `aria-label` is explicitly overridden.
 */
type TooltipIconButtonProps = React.ComponentProps<typeof Button> & {
  /** Tooltip text and default accessible name. */
  label: React.ReactNode;
  /** Which side the tooltip opens on. Defaults to `bottom` (header icons). */
  tooltipSide?: TooltipSide;
  /** How the tooltip aligns against the trigger. Defaults to Radix's `center`. */
  tooltipAlign?: TooltipAlign;
  /** Extra classes for the tooltip surface. */
  tooltipClassName?: string;
  /** Delay before the tooltip opens, in ms. */
  tooltipDelayDuration?: number;
};

function TooltipIconButton({
  label,
  tooltipSide = "bottom",
  tooltipAlign,
  tooltipClassName,
  tooltipDelayDuration,
  variant = "ghost",
  size = "icon-sm",
  className,
  children,
  "aria-label": ariaLabel,
  ...props
}: TooltipIconButtonProps) {
  const accessibleName =
    ariaLabel ?? (typeof label === "string" ? label : undefined);

  return (
    // Self-contained provider so the button works on any render path (and in
    // isolated component tests) without relying on an ancestor TooltipProvider.
    // Nested providers are safe in Radix — the innermost wins for its subtree.
    <TooltipProvider delayDuration={tooltipDelayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            aria-label={accessibleName}
            className={cn(
              "text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary",
              className,
            )}
            {...props}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side={tooltipSide}
          align={tooltipAlign}
          className={cn(
            "max-w-64 border border-border bg-popover text-popover-foreground shadow-md",
            tooltipClassName,
          )}
          arrowClassName="bg-popover fill-popover border-b border-r border-border"
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { TooltipIconButton, type TooltipIconButtonProps };
