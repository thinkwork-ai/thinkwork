import { Link } from "@tanstack/react-router";
import { ExternalLink, Save } from "lucide-react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@thinkwork/ui";
import type { JsonRenderPromotionStatus } from "../json-render/use-promote-json-render";

export interface PromoteGenUIButtonProps {
  disabled?: boolean;
  status: JsonRenderPromotionStatus;
  onPromote: () => void;
}

export function PromoteGenUIButton({
  disabled = false,
  status,
  onPromote,
}: PromoteGenUIButtonProps) {
  if (status.state === "promoted") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Open saved artifact"
              asChild
              className="size-8 bg-transparent p-0 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              size="icon"
              variant="ghost"
            >
              <Link
                aria-label="Open saved artifact"
                to="/artifacts/$id"
                params={{ id: status.artifactId }}
              >
                <ExternalLink className="size-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Open artifact</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={
                status.state === "submitting"
                  ? "Saving artifact"
                  : "Save as artifact"
              }
              className="size-8 bg-transparent p-0 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              disabled={disabled || status.state === "submitting"}
              onClick={onPromote}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Save className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{status.state === "submitting" ? "Saving" : "Save artifact"}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {status.state === "error" ? (
        <p className="max-w-72 text-right text-xs text-destructive">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
