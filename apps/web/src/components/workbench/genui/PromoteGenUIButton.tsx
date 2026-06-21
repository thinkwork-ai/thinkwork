import { Link } from "@tanstack/react-router";
import { ExternalLink, Save } from "lucide-react";
import { Button } from "@thinkwork/ui";
import type { GenUIPromotionStatus } from "./use-promote-genui";

export interface PromoteGenUIButtonProps {
  disabled?: boolean;
  status: GenUIPromotionStatus;
  onPromote: () => void;
}

export function PromoteGenUIButton({
  disabled = false,
  status,
  onPromote,
}: PromoteGenUIButtonProps) {
  if (status.state === "promoted") {
    return (
      <Button asChild size="sm" variant="outline">
        <Link to="/artifacts/$id" params={{ id: status.artifactId }}>
          <ExternalLink className="mr-2 size-4" />
          Open artifact
        </Link>
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || status.state === "submitting"}
        onClick={onPromote}
      >
        <Save className="mr-2 size-4" />
        {status.state === "submitting" ? "Saving" : "Save artifact"}
      </Button>
      {status.state === "error" ? (
        <p className="max-w-72 text-right text-xs text-destructive">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
