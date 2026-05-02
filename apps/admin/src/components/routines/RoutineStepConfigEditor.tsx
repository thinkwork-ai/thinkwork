import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

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
  args?: unknown;
  configFields: RoutineConfigField[];
};

interface RoutineStepConfigEditorProps {
  steps: RoutineConfigStep[];
  fieldValues: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  onLabelChange?: (nodeId: string, value: string) => void;
  onMoveStep?: (nodeId: string, direction: "up" | "down") => void;
  onRemoveStep?: (nodeId: string) => void;
}

export function RoutineStepConfigEditor({
  steps,
  fieldValues,
  onFieldChange,
  onLabelChange,
  onMoveStep,
  onRemoveStep,
}: RoutineStepConfigEditorProps) {
  return (
    <div className="divide-y divide-border/70">
      {steps.map((step, index) => (
        <div
          key={step.nodeId}
          className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]"
        >
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                {onLabelChange ? (
                  <Input
                    aria-label={`${step.recipeName} step label`}
                    value={step.label}
                    onChange={(event) =>
                      onLabelChange(step.nodeId, event.target.value)
                    }
                    className="h-8 font-medium"
                  />
                ) : (
                  <div className="truncate text-sm font-medium">
                    {step.label}
                  </div>
                )}
                <div className="truncate text-xs text-muted-foreground">
                  {step.recipeName}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className={cn(
                  "font-mono",
                  step.recipeId === "email_send" &&
                    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                )}
              >
                {step.recipeId}
              </Badge>
              {onMoveStep && (
                <>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label={`Move ${step.label} up`}
                    disabled={index === 0}
                    onClick={() => onMoveStep(step.nodeId, "up")}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label={`Move ${step.label} down`}
                    disabled={index === steps.length - 1}
                    onClick={() => onMoveStep(step.nodeId, "down")}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              {onRemoveStep && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label={`Remove ${step.label}`}
                  onClick={() => onRemoveStep(step.nodeId)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {step.configFields.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground md:col-span-2">
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
  const multiline = shouldUseTextarea(field, value);
  const monospace = shouldUseMonospace(field);
  const fullWidth = multiline || field.inputType === "email_array";

  return (
    <label
      htmlFor={id}
      className={cn("block min-w-0", fullWidth && "md:col-span-2")}
    >
      <span className="mb-1.5 flex items-center gap-2 text-sm font-medium">
        <span>
          {field.label}
          {field.required && (
            <span className="ml-0.5 text-destructive" aria-label="required">
              *
            </span>
          )}
        </span>
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
      ) : multiline ? (
        <Textarea
          id={id}
          value={value}
          readOnly={readOnly}
          rows={textareaRows(field, value)}
          className={cn(
            "min-h-20 resize-y",
            monospace && "font-mono text-xs leading-5",
            readOnly && "text-muted-foreground",
          )}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={field.inputType === "number" ? "number" : "text"}
          value={value}
          readOnly={readOnly}
          className={cn(
            monospace && "font-mono text-xs",
            readOnly && "text-muted-foreground",
          )}
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
  if (Array.isArray(value)) return value.join("\n");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value, null, 2);
}

function fieldKey(nodeId: string, key: string): string {
  return `${nodeId}.${key}`;
}

function shouldUseTextarea(field: RoutineConfigField, value: string): boolean {
  if (
    field.inputType === "email_array" ||
    field.inputType === "string_array"
  ) {
    return true;
  }

  const key = field.key.toLowerCase();
  const label = field.label.toLowerCase();
  const longValue = value.includes("\n") || value.length > 96;
  if (longValue) return true;
  if (key.includes("path") || key.includes("source")) return false;

  return [
    "body",
    "code",
    "sql",
    "text",
    "message",
    "markdowncontext",
    "expression",
    "requestbody",
    "decisionschema",
    "environment",
  ].some((token) => key.includes(token) || label.includes(token));
}

function shouldUseMonospace(field: RoutineConfigField): boolean {
  const key = field.key.toLowerCase();
  const label = field.label.toLowerCase();
  return [
    "code",
    "sql",
    "expression",
    "json",
    "schema",
    "bodypath",
    "requestbody",
    "environment",
  ].some((token) => key.includes(token) || label.includes(token));
}

function textareaRows(field: RoutineConfigField, value: string): number {
  if (field.key.toLowerCase().includes("code")) return 8;
  if (field.key.toLowerCase().includes("sql")) return 6;
  if (value.includes("\n")) {
    return Math.min(10, Math.max(3, value.split("\n").length));
  }
  return field.inputType === "email_array" || field.inputType === "string_array"
    ? 3
    : 4;
}
