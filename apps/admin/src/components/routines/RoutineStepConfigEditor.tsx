import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type RoutineConfigField = {
  key: string;
  label: string;
  value: unknown | null;
  inputType: string;
  required: boolean;
  editable: boolean;
  options?: string[] | null;
};

export type RoutineConfigStep = {
  nodeId: string;
  recipeId: string;
  recipeName: string;
  label: string;
  configFields: RoutineConfigField[];
};

interface RoutineStepConfigEditorProps {
  steps: RoutineConfigStep[];
  fieldValues: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
}

export function RoutineStepConfigEditor({
  steps,
  fieldValues,
  onFieldChange,
}: RoutineStepConfigEditorProps) {
  return (
    <div className="divide-y divide-border/70">
      {steps.map((step, index) => (
        <div
          key={step.nodeId}
          className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {step.label}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {step.recipeName}
                </div>
              </div>
            </div>
            <Badge
              variant="secondary"
              className={cn(
                "mt-3 font-mono",
                step.recipeId === "email_send" &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              )}
            >
              {step.recipeId}
            </Badge>
          </div>

          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {step.configFields.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No configurable fields.
              </div>
            ) : (
              step.configFields.map((field) => (
                <ConfigFieldInput
                  key={field.key}
                  step={step}
                  field={field}
                  value={fieldValues[fieldKey(step.nodeId, field.key)] ?? ""}
                  onChange={(value) =>
                    onFieldChange(fieldKey(step.nodeId, field.key), value)
                  }
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfigFieldInput({
  step,
  field,
  value,
  onChange,
}: {
  step: RoutineConfigStep;
  field: RoutineConfigField;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `${step.nodeId}-${field.key}`;
  const readOnly = !field.editable;

  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="mb-1 flex items-center gap-2 text-sm font-medium">
        {field.label}
        {readOnly && (
          <span className="text-xs font-normal text-muted-foreground">
            Read-only
          </span>
        )}
      </span>
      {field.inputType === "select" && field.options?.length ? (
        <Select value={value} onValueChange={onChange} disabled={readOnly}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={field.inputType === "number" ? "number" : "text"}
          value={value}
          readOnly={readOnly}
          className={cn(readOnly && "text-muted-foreground")}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

export function valuesFromSteps(
  steps: RoutineConfigStep[],
): Record<string, string> {
  return Object.fromEntries(
    steps.flatMap((step) =>
      step.configFields.map((field) => [
        fieldKey(step.nodeId, field.key),
        stringValue(field.value),
      ]),
    ),
  );
}

export function changedSteps(
  steps: RoutineConfigStep[],
  values: Record<string, string>,
): RoutineConfigStep[] {
  return steps.filter((step) =>
    step.configFields.some((field) => fieldChanged(step.nodeId, field, values)),
  );
}

export function argsFromStepFields(
  step: RoutineConfigStep,
  values: Record<string, string>,
): Record<string, unknown> {
  return Object.fromEntries(
    step.configFields.map((field) => [
      field.key,
      valueForMutation(field, values[fieldKey(step.nodeId, field.key)] ?? ""),
    ]),
  );
}

function fieldChanged(
  nodeId: string,
  field: RoutineConfigField,
  values: Record<string, string>,
): boolean {
  const key = fieldKey(nodeId, field.key);
  const next = valueForMutation(field, values[key] ?? "");
  return JSON.stringify(next) !== JSON.stringify(field.value ?? null);
}

function valueForMutation(field: RoutineConfigField, value: string): unknown {
  if (field.inputType === "email_array" || field.inputType === "string_array") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (field.inputType === "number") {
    return value.trim() ? Number(value) : null;
  }
  return value;
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

function fieldKey(nodeId: string, key: string): string {
  return `${nodeId}.${key}`;
}
