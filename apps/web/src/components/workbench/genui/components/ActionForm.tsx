import { Send } from "lucide-react";
import { Button } from "@thinkwork/ui";
import type { ThreadGenUIActionDescriptor } from "@thinkwork/genui";
import { DecisionPanel } from "./DecisionPanel";

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
  actions?: ThreadGenUIActionDescriptor[];
  actionsDisabled?: boolean;
}

export function ActionForm({
  title,
  description,
  fields = [],
  submitActionId,
  actions = [],
  actionsDisabled = true,
}: ActionFormProps) {
  const submitAction = actions.find((action) => action.id === submitActionId);

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
          <Button
            aria-label={submitAction.label}
            className="min-h-9 justify-self-start gap-1.5"
            disabled={actionsDisabled || submitAction.disabled === true}
            size="sm"
            type="submit"
          >
            <Send className="size-3.5" />
            {submitAction.label}
          </Button>
        ) : null}
      </form>
      <DecisionPanel
        actions={actions.filter((action) => action.id !== submitActionId)}
        disabled={actionsDisabled}
      />
    </section>
  );
}
