import { Send } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { DecisionPanel } from "./DecisionPanel";
import type { ThreadJsonRenderDurableActionDescriptor } from "../../json-render/validation";
import type { JsonRenderActionStatus } from "../../json-render/use-json-render-action";

export interface ActionFormField {
  id: string;
  label: string;
  type: "text" | "textarea" | "select";
  required?: boolean;
  options?: string[];
}

export interface ActionFormProps {
  title: string;
  description?: string;
  fields?: ActionFormField[];
  submitActionId?: string;
  actions?: ThreadJsonRenderDurableActionDescriptor[];
  actionsDisabled?: boolean;
  onAction?: (action: ThreadJsonRenderDurableActionDescriptor) => void;
  statusForAction?: (
    action: ThreadJsonRenderDurableActionDescriptor,
  ) => JsonRenderActionStatus;
}

export function ActionForm({
  title,
  description,
  fields = [],
  submitActionId,
  actions = [],
  actionsDisabled = true,
  onAction,
  statusForAction,
}: ActionFormProps) {
  const submitAction = actions.find((action) => action.id === submitActionId);
  const submitStatus = submitAction
    ? (statusForAction?.(submitAction) ?? { state: "idle" as const })
    : { state: "idle" as const };
  const submitDisabled =
    actionsDisabled ||
    submitAction?.disabled === true ||
    submitStatus.state === "submitting" ||
    submitStatus.state === "submitted";

  return (
    <section
      aria-label={title}
      className="grid gap-3 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
      data-testid="genui-action-form"
    >
      <header>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>
      <form className="grid gap-2" onSubmit={(event) => event.preventDefault()}>
        {fields.map((field) => (
          <label className="grid gap-1 text-sm" key={field.id}>
            <span className="text-xs font-medium text-muted-foreground">
              {field.label}
              {field.required ? <span aria-hidden="true"> *</span> : null}
            </span>
            {field.type === "textarea" ? (
              <textarea
                className="min-h-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-70"
                disabled
                name={field.id}
                required={field.required}
              />
            ) : field.type === "select" ? (
              <select
                className="min-h-9 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-70"
                disabled
                name={field.id}
                required={field.required}
              >
                <option value="">Select</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="min-h-9 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-70"
                disabled
                name={field.id}
                required={field.required}
                type="text"
              />
            )}
          </label>
        ))}
        {submitAction ? (
          <div className="grid justify-items-start gap-1">
            <Button
              aria-label={submitAction.label}
              className="min-h-9 gap-1.5"
              disabled={submitDisabled}
              onClick={() => onAction?.(submitAction)}
              size="sm"
              type="submit"
            >
              <Send className="size-3.5" />
              {submitStatus.state === "submitting"
                ? "Submitting..."
                : submitStatus.state === "submitted"
                  ? "Submitted"
                  : submitAction.label}
            </Button>
            {submitStatus.state === "error" ? (
              <p className="max-w-52 text-xs leading-4 text-destructive">
                {submitStatus.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
      <DecisionPanel
        actions={actions.filter((action) => action.id !== submitActionId)}
        disabled={actionsDisabled}
        onAction={onAction}
        statusForAction={statusForAction}
      />
    </section>
  );
}
