import { Check, ExternalLink, Send, X } from "lucide-react";
import { Button } from "@thinkwork/ui";
import type { ThreadGenUIActionDescriptor } from "@thinkwork/genui";

export interface DecisionPanelProps {
  actions?: ThreadGenUIActionDescriptor[];
  primaryActionId?: string;
  disabled?: boolean;
  pendingLabel?: string;
}

export function DecisionPanel({
  actions = [],
  primaryActionId,
  disabled = true,
  pendingLabel = "Pending",
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
        const isDisabled = disabled || action.disabled === true;
        return (
          <Button
            aria-label={action.label}
            className="min-h-9 gap-1.5"
            disabled={isDisabled}
            key={action.id}
            size="sm"
            type="button"
            variant={variant}
          >
            <Icon className="size-3.5" />
            <span>{action.label}</span>
            {isDisabled ? (
              <span className="sr-only"> {pendingLabel}</span>
            ) : null}
          </Button>
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
