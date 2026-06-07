import { Check, Plus, Settings } from "lucide-react";
import {
  Badge,
  Button,
  Separator,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import type { CustomizeItem } from "./customize-filtering";

export interface CustomizeDetailSheetProps {
  item: CustomizeItem;
  /** Inert until U4-U6 wire mutations; kept here so consumers can pass a real handler later. */
  onAction?: (id: string, nextConnected: boolean) => void;
  pending?: boolean;
}

/**
 * Side sheet rendered when the user clicks a Customize table row. Shows
 * the item's identity, description, category / type metadata, the
 * primary enable/disable toggle, and a placeholder Configuration block
 * that real per-item config (per-skill model_override, per-MCP tool
 * gates, per-routine schedule) lands in once those plan units (U4-U6,
 * follow-on) ship.
 */
export function CustomizeDetailSheet({
  item,
  onAction,
  pending = false,
}: CustomizeDetailSheetProps) {
  const ActionIcon = item.connected ? Check : Plus;
  const actionLabel = item.connected ? "Disable" : "Connect";
  return (
    <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
      <SheetHeader className="space-y-3 pb-2">
        <div className="flex items-start gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted text-base font-medium uppercase"
            aria-hidden="true"
          >
            {item.iconUrl ? (
              <img
                src={item.iconUrl}
                alt=""
                className="h-12 w-12 rounded-md object-contain"
              />
            ) : (
              <span>{item.iconFallback ?? item.name.charAt(0)}</span>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <SheetTitle className="text-lg">{item.name}</SheetTitle>
            <div className="flex flex-wrap items-center gap-2">
              {item.typeBadge ? (
                <Badge variant="outline" className="uppercase tracking-wide">
                  {item.typeBadge}
                </Badge>
              ) : null}
              {item.category ? (
                <Badge variant="secondary" className="font-normal">
                  {item.category}
                </Badge>
              ) : null}
              {item.connected ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-green-500 font-normal text-green-500"
                >
                  <Check className="h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="font-normal text-muted-foreground"
                >
                  Available
                </Badge>
              )}
            </div>
          </div>
        </div>
        {item.description ? (
          <SheetDescription className="text-sm leading-relaxed">
            {item.description}
          </SheetDescription>
        ) : null}
      </SheetHeader>

      <Separator className="my-4" />

      <section className="flex flex-col gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Settings className="h-4 w-4 text-muted-foreground" />
          Configuration
        </div>
        <p className="text-sm text-muted-foreground">
          Per-item configuration (model overrides, scoped permissions, schedule,
          tool gates) will land here when the Customize mutation surface ships.
        </p>
      </section>

      <SheetFooter className="mt-auto px-4 pb-6 pt-4 sm:px-6">
        <Button
          type="button"
          variant={item.connected ? "secondary" : "default"}
          disabled={pending || !onAction}
          onClick={() => onAction?.(item.id, !item.connected)}
          data-testid="customize-detail-action"
        >
          <ActionIcon className="mr-1 h-4 w-4" aria-hidden="true" />
          {actionLabel}
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}
