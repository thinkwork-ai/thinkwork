import { Check, ExternalLink, Send, X } from "lucide-react";
import { Button } from "@thinkwork/ui";
import type { ThreadGenUIActionDescriptor } from "@thinkwork/genui";
import type { GenUIActionStatus } from "../use-genui-action";

export interface DecisionPanelProps {
  actions?: ThreadGenUIActionDescriptor[];
  primaryActionId?: string;
  disabled?: boolean;
  pendingLabel?: string;
  onAction?: (action: ThreadGenUIActionDescriptor) => void;
  statusForAction?: (action: ThreadGenUIActionDescriptor) => GenUIActionStatus;
}

export function DecisionPanel({
  actions = [],
  primaryActionId,
  disabled = true,
  pendingLabel = "Pending",
  onAction,
  statusForAction,
}: DecisionPanelProps) {
  if (actions.length === 0) return null;

  return (
    <div
      className="flex min-w-0 flex-wrap gap-2"
      aria-label="Generated UI actions"
    >
      {actions.map((action) => {
        const Icon = iconForAction(action.kind);
        const variant =
          action.destructive || action.kind === "reject"
            ? "outline"
            : action.id === primaryActionId
              ? "default"
              : "secondary";
        const status = statusForAction?.(action) ?? { state: "idle" };
        const isSubmitted = status.state === "submitted";
        const isSubmitting = status.state === "submitting";
        const isDisabled =
          disabled || action.disabled === true || isSubmitting || isSubmitted;
        return (
          <div className="grid gap-1" key={action.id}>
            <Button
              aria-label={action.label}
              className="min-h-9 gap-1.5"
              disabled={isDisabled}
              onClick={() => onAction?.(action)}
              size="sm"
              type="button"
              variant={variant}
            >
              <Icon className="size-3.5" />
              <span>
                {isSubmitting
                  ? "Submitting..."
                  : isSubmitted
                    ? "Submitted"
                    : action.label}
              </span>
              {isDisabled && !isSubmitting && !isSubmitted ? (
                <span className="sr-only"> {pendingLabel}</span>
              ) : null}
            </Button>
            {status.state === "error" ? (
              <p className="max-w-52 text-xs leading-4 text-destructive">
                {status.message}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function iconForAction(kind: ThreadGenUIActionDescriptor["kind"]) {
  switch (kind) {
    case "approve":
      return Check;
    case "reject":
      return X;
    case "open":
      return ExternalLink;
    case "submit":
    default:
      return Send;
  }
}
