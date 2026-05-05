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
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Plus,
  Trash2,
} from "lucide-react";
import {
  RoutineCodeEditor,
  type RoutineCodeLanguage,
} from "./RoutineCodeEditor";

export type RoutineConfigField = {
  key: string;
  label: string;
  value?: unknown | null;
  inputType: string;
  control?: string | null;
  required: boolean;
  editable: boolean;
  options?: string[] | null;
  placeholder?: string | null;
  helpText?: string | null;
  min?: number | null;
  max?: number | null;
  pattern?: string | null;
};

export type RoutineConfigStep = {
  nodeId: string;
  recipeId: string;
  recipeName: string;
  label: string;
  args?: unknown;
  configFields: RoutineConfigField[];
};

export type RoutineCredentialOption = {
  id: string;
  slug?: string;
  displayName: string;
  kind: string;
  status?: string | null;
};

interface RoutineStepConfigEditorProps {
  steps: RoutineConfigStep[];
  fieldValues: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  onLabelChange?: (nodeId: string, value: string) => void;
  onMoveStep?: (nodeId: string, direction: "up" | "down") => void;
  onRemoveStep?: (nodeId: string) => void;
  fieldErrors?: Record<string, string>;
  selectedNodeId?: string | null;
  onSelectStep?: (nodeId: string) => void;
  layout?: "split" | "stacked";
  credentialOptions?: RoutineCredentialOption[];
}

export function RoutineStepConfigEditor({
  steps,
  fieldValues,
  onFieldChange,
  onLabelChange,
  onMoveStep,
  onRemoveStep,
  fieldErrors = {},
  selectedNodeId,
  onSelectStep,
  layout = "split",
  credentialOptions = [],
}: RoutineStepConfigEditorProps) {
  const stacked = layout === "stacked";

  return (
    <div className={cn("space-y-3", stacked ? "p-4" : "p-3")}>
      {steps.map((step, index) => {
        const stepErrors = step.configFields.filter(
          (field) => fieldErrors[fieldKey(step.nodeId, field.key)],
        ).length;
        const editableCount = step.configFields.filter(
          (field) => field.editable,
        ).length;
        const configuredCount = step.configFields.filter((field) =>
          (fieldValues[fieldKey(step.nodeId, field.key)] ?? "").trim(),
        ).length;
        const selected = selectedNodeId === step.nodeId;

        return (
          <article
            key={step.nodeId}
            className={cn(
              "rounded-lg border px-4 py-4 transition-colors",
              stacked
                ? "space-y-4"
                : "grid gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]",
              selected
                ? "border-ring bg-muted/35 shadow-sm"
                : "border-border/70 bg-background/40 hover:bg-muted/20",
            )}
            onFocusCapture={() => onSelectStep?.(step.nodeId)}
          >
            <div className={cn("min-w-0", stacked && "border-b pb-3")}>
              <div
                className={cn(
                  "flex gap-3",
                  stacked ? "items-center" : "items-start",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectStep?.(step.nodeId)}
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                  aria-label={`Select step ${index + 1}: ${step.label}`}
                >
                  {index + 1}
                </button>
                <div
                  className={cn(
                    "min-w-0 flex-1",
                    stacked && "flex items-center gap-2",
                  )}
                >
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
                  {!stacked && (
                    <div className="truncate text-xs text-muted-foreground">
                      {step.recipeName}
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex min-w-0 flex-wrap gap-1.5",
                      stacked ? "shrink-0" : "mt-2",
                    )}
                  >
                    {stepErrors > 0 ? (
                      <Badge className="border-transparent bg-destructive/10 text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        {stepErrors} {stepErrors === 1 ? "issue" : "issues"}
                      </Badge>
                    ) : editableCount > 0 ? (
                      <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        Configured
                      </Badge>
                    ) : (
                      <Badge variant="outline">No config</Badge>
                    )}
                    {editableCount > 0 && (
                      <Badge variant="outline">
                        {configuredCount}/{step.configFields.length} fields
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              {!stacked && (
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
              )}
            </div>

            <div
              className={cn(
                "grid min-w-0 gap-3",
                stacked ? "grid-cols-1" : "md:grid-cols-2",
              )}
            >
              {step.configFields.length === 0 ? (
                <div
                  className={cn(
                    "rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground",
                    !stacked && "md:col-span-2",
                  )}
                >
                  No configurable fields.
                </div>
              ) : (
                step.configFields.map((field) => (
                  <ConfigFieldInput
                    key={field.key}
                    step={step}
                    field={field}
                    value={fieldValues[fieldKey(step.nodeId, field.key)] ?? ""}
                    error={fieldErrors[fieldKey(step.nodeId, field.key)]}
                    changed={fieldChanged(step.nodeId, field, fieldValues)}
                    stacked={stacked}
                    credentialOptions={credentialOptions}
                    onChange={(value) =>
                      onFieldChange(fieldKey(step.nodeId, field.key), value)
                    }
                  />
                ))
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ConfigFieldInput({
  step,
  field,
  value,
  error,
  changed,
  stacked,
  credentialOptions,
  onChange,
}: {
  step: RoutineConfigStep;
  field: RoutineConfigField;
  value: string;
  error?: string;
  changed?: boolean;
  stacked?: boolean;
  credentialOptions?: RoutineCredentialOption[];
  onChange: (value: string) => void;
}) {
  const id = `${step.nodeId}-${field.key}`;
  const labelId = `${id}-label`;
  const readOnly = !field.editable;
  const control = controlForField(field, value);
  const multiline =
    control === "textarea" ||
    control === "email_list" ||
    control === "string_list";
  const fullWidth =
    multiline || control === "code" || control === "credential_bindings";

  return (
    <div
      className={cn("block min-w-0", !stacked && fullWidth && "md:col-span-2")}
    >
      <span
        id={labelId}
        className="mb-1.5 flex min-w-0 items-center gap-2 text-sm font-medium"
      >
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
        {changed && field.editable && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            Edited
          </Badge>
        )}
      </span>
      {control === "select" && field.options?.length ? (
        <Select value={value} onValueChange={onChange} disabled={readOnly}>
          <SelectTrigger
            id={id}
            className="w-full"
            aria-invalid={Boolean(error)}
            aria-labelledby={labelId}
          >
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
      ) : control === "credential_select" ? (
        (() => {
          const options = credentialOptionsForField(
            field,
            credentialOptions ?? [],
          );
          return (
            <Select
              value={selectedCredentialValue(value, options)}
              onValueChange={(next) =>
                onChange(next === "__none__" ? "" : next)
              }
              disabled={readOnly || options.length === 0}
            >
              <SelectTrigger
                id={id}
                className="w-full"
                aria-invalid={Boolean(error)}
                aria-labelledby={labelId}
              >
                <SelectValue
                  placeholder={
                    options.length
                      ? "Select credential"
                      : "No active credentials"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No credential</SelectItem>
                {optionForMissingCredentialHandle(value, options)}
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {credentialOptionLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })()
      ) : control === "code" ? (
        <RoutineCodeEditor
          id={id}
          value={value}
          readOnly={readOnly}
          error={Boolean(error)}
          stacked={stacked}
          labelledBy={labelId}
          language={codeLanguageForStep(step)}
          onChange={onChange}
        />
      ) : control === "credential_bindings" ? (
        <CredentialBindingsEditor
          value={value}
          readOnly={readOnly}
          credentialOptions={credentialOptionsForField(
            field,
            credentialOptions ?? [],
          )}
          error={Boolean(error)}
          onChange={onChange}
        />
      ) : multiline ? (
        <Textarea
          id={id}
          value={value}
          readOnly={readOnly}
          placeholder={field.placeholder ?? undefined}
          aria-invalid={Boolean(error)}
          aria-labelledby={labelId}
          rows={textareaRows(control, value)}
          className={cn(
            "min-h-20 resize-y",
            readOnly && "text-muted-foreground",
          )}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={control === "number" ? "number" : "text"}
          value={value}
          readOnly={readOnly}
          placeholder={field.placeholder ?? undefined}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          aria-invalid={Boolean(error)}
          aria-labelledby={labelId}
          className={cn(readOnly && "text-muted-foreground")}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {(error || field.helpText) && (
        <span
          className={cn(
            "mt-1 block text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ?? field.helpText}
        </span>
      )}
    </div>
  );
}

export function valuesFromSteps(
  steps: RoutineConfigStep[],
): Record<string, string> {
  return Object.fromEntries(
    steps.flatMap((step) =>
      step.configFields.map((field) => [
        fieldKey(step.nodeId, field.key),
        stringValueForField(field, field.value),
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
  try {
    const next = valueForMutation(field, values[key] ?? "");
    const original = valueForMutation(
      field,
      stringValueForField(field, field.value),
    );
    return JSON.stringify(next) !== JSON.stringify(original);
  } catch {
    return true;
  }
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
  if (field.inputType === "credential_bindings") {
    return parseCredentialBindings(value);
  }
  return value;
}

export function validationErrorsFromSteps(
  steps: RoutineConfigStep[],
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    steps
      .flatMap((step) =>
        step.configFields.map((field) => {
          const key = fieldKey(step.nodeId, field.key);
          const error = validateField(field, values[key] ?? "");
          return error ? ([key, error] as const) : null;
        }),
      )
      .filter((entry): entry is readonly [string, string] => Boolean(entry)),
  );
}

export function hasValidationErrors(errors: Record<string, string>): boolean {
  return Object.keys(errors).length > 0;
}

function stringValueForField(
  field: RoutineConfigField,
  value: unknown,
): string {
  if (field.inputType === "credential_bindings") {
    return stringifyCredentialBindings(Array.isArray(value) ? value : []);
  }
  return stringValue(value);
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

function validateField(
  field: RoutineConfigField,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (field.required && !trimmed) return `${field.label} is required.`;

  if (!trimmed) return null;

  if (field.inputType === "email_array" || field.control === "email_list") {
    const emails = listValues(value);
    if (field.required && emails.length === 0) {
      return `${field.label} needs at least one recipient.`;
    }
    const invalid = emails.find((email) => !isLikelyEmail(email));
    if (invalid) return `${invalid} is not a valid email address.`;
  }

  if (field.inputType === "number" || field.control === "number") {
    const numericValue = Number(trimmed);
    if (!Number.isFinite(numericValue))
      return `${field.label} must be a number.`;
    if (field.min != null && numericValue < field.min) {
      return `${field.label} must be at least ${field.min}.`;
    }
    if (field.max != null && numericValue > field.max) {
      return `${field.label} must be at most ${field.max}.`;
    }
  }

  if (field.inputType === "credential_bindings") {
    try {
      const bindings = parseCredentialBindings(value);
      const aliases = new Set<string>();
      for (const binding of bindings) {
        const alias = binding.alias;
        const credentialId = binding.credentialId;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
          return "Credential aliases must be safe code identifiers.";
        }
        if (aliases.has(alias)) {
          return `Credential alias ${alias} is duplicated.`;
        }
        aliases.add(alias);
        if (!credentialId.trim()) {
          return "Each credential binding needs a credential.";
        }
        const invalidRequiredField = (binding.requiredFields ?? []).find(
          (fieldName) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldName),
        );
        if (invalidRequiredField) {
          return "Required fields must be safe code identifiers.";
        }
      }
    } catch (err) {
      return `${field.label} must be valid JSON: ${(err as Error).message}`;
    }
  }

  if (field.inputType === "select" && field.options?.length) {
    if (!field.options.includes(value)) {
      return `${field.label} must be one of ${field.options.join(", ")}.`;
    }
  }

  if (field.pattern) {
    const regex = new RegExp(field.pattern);
    if (!regex.test(trimmed)) return `${field.label} has an invalid format.`;
  }

  return null;
}

function controlForField(field: RoutineConfigField, value: string): string {
  if (field.control && isKnownControl(field.control)) return field.control;
  if (field.inputType === "email_array") return "email_list";
  if (field.inputType === "string_array") return "string_list";
  if (field.inputType === "select") return "select";
  if (field.inputType === "number") return "number";
  if (value.includes("\n") || value.length > 96) return "textarea";
  return "text";
}

function listValues(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isKnownControl(value: string): boolean {
  return [
    "text",
    "textarea",
    "code",
    "select",
    "credential_select",
    "credential_bindings",
    "number",
    "email_list",
    "string_list",
  ].includes(value);
}

function textareaRows(control: string, value: string): number {
  if (value.includes("\n")) {
    return Math.min(10, Math.max(3, value.split("\n").length));
  }
  if (control === "email_list" || control === "string_list") {
    return 3;
  }
  return 4;
}

type CredentialBindingValue = {
  alias: string;
  credentialId: string;
  requiredFields?: string[];
};

export function codeLanguageForStep(
  step: Pick<RoutineConfigStep, "recipeId">,
): RoutineCodeLanguage {
  return step.recipeId === "typescript" ? "typescript" : "python";
}

export function parseCredentialBindings(
  value: string,
): CredentialBindingValue[] {
  if (!value.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Credential bindings must be a JSON array.");
  }
  return parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Credential binding entries must be JSON objects.");
    }
    const raw = item as {
      alias?: unknown;
      credentialId?: unknown;
      requiredFields?: unknown;
    };
    const requiredFields = Array.isArray(raw.requiredFields)
      ? raw.requiredFields.map((field) => String(field).trim()).filter(Boolean)
      : [];
    return {
      alias: String(raw.alias ?? "").trim(),
      credentialId: String(raw.credentialId ?? "").trim(),
      ...(requiredFields.length > 0 ? { requiredFields } : {}),
    };
  });
}

export function stringifyCredentialBindings(
  bindings: readonly CredentialBindingValue[],
): string {
  return JSON.stringify(bindings, null, 2);
}

function CredentialBindingsEditor({
  value,
  readOnly,
  credentialOptions,
  error,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  credentialOptions: RoutineCredentialOption[];
  error: boolean;
  onChange: (value: string) => void;
}) {
  let bindings: CredentialBindingValue[];
  try {
    bindings = parseCredentialBindings(value);
  } catch {
    return (
      <Textarea
        value={value}
        readOnly={readOnly}
        aria-invalid={error}
        rows={6}
        className="min-h-28 resize-y font-mono text-xs leading-5"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  const updateBinding = (
    index: number,
    patch: Partial<CredentialBindingValue>,
  ) => {
    const next = bindings.map((binding, candidateIndex) =>
      candidateIndex === index
        ? normalizeBinding({ ...binding, ...patch })
        : binding,
    );
    onChange(stringifyCredentialBindings(next));
  };

  const removeBinding = (index: number) => {
    onChange(
      stringifyCredentialBindings(
        bindings.filter((_, candidateIndex) => candidateIndex !== index),
      ),
    );
  };

  const addBinding = () => {
    const credential = credentialOptions[0];
    const alias = uniqueCredentialAlias(
      credential?.displayName
        ? aliasFromCredentialName(credential.displayName)
        : "credential",
      bindings,
    );
    onChange(
      stringifyCredentialBindings([
        ...bindings,
        normalizeBinding({
          alias,
          credentialId: credential?.id ?? "",
          requiredFields: [],
        }),
      ]),
    );
  };

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border p-2",
        error ? "border-destructive" : "border-input",
        readOnly && "opacity-80",
      )}
      aria-invalid={error}
    >
      {bindings.length === 0 ? (
        <div className="rounded border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
          No credential bindings.
        </div>
      ) : (
        bindings.map((binding, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-md border border-border/70 bg-background/60 p-2 sm:grid-cols-[minmax(92px,0.8fr)_minmax(160px,1.2fr)_minmax(140px,1fr)_auto]"
          >
            <Input
              value={binding.alias}
              readOnly={readOnly}
              aria-label={`Credential binding ${index + 1} alias`}
              placeholder="alias"
              className="h-8 font-mono text-xs"
              onChange={(event) =>
                updateBinding(index, { alias: event.target.value })
              }
            />
            <Select
              value={selectedCredentialValue(
                binding.credentialId,
                credentialOptions,
              )}
              disabled={readOnly || credentialOptions.length === 0}
              onValueChange={(next) =>
                updateBinding(index, {
                  credentialId: next === "__none__" ? "" : next,
                })
              }
            >
              <SelectTrigger
                className="h-8 w-full"
                aria-label={`Credential binding ${index + 1} credential`}
              >
                <SelectValue placeholder="Select credential" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No credential</SelectItem>
                {optionForMissingHandle(binding, credentialOptions)}
                {credentialOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {credentialOptionLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={(binding.requiredFields ?? []).join(", ")}
              readOnly={readOnly}
              aria-label={`Credential binding ${index + 1} required fields`}
              placeholder="required fields"
              className="h-8 font-mono text-xs"
              onChange={(event) =>
                updateBinding(index, {
                  requiredFields: listValues(event.target.value),
                })
              }
            />
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={readOnly}
              aria-label={`Remove credential binding ${index + 1}`}
              onClick={() => removeBinding(index)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={readOnly}
        onClick={addBinding}
      >
        <Plus className="h-3.5 w-3.5" />
        Add binding
      </Button>
    </div>
  );
}

function credentialOptionsForField(
  field: RoutineConfigField,
  credentialOptions: RoutineCredentialOption[],
): RoutineCredentialOption[] {
  if (credentialOptions.length > 0) {
    if (!field.options?.length) return credentialOptions;
    const handles = new Set(field.options);
    return credentialOptions.filter(
      (option) =>
        handles.has(option.id) ||
        Boolean(option.slug && handles.has(option.slug)),
    );
  }
  return (field.options ?? []).map((option) => ({
    id: option,
    displayName: option,
    kind: "credential",
  }));
}

function selectedCredentialValue(
  handle: string,
  options: RoutineCredentialOption[],
): string {
  if (!handle) return "__none__";
  const match = options.find(
    (option) => option.id === handle || option.slug === handle,
  );
  return match?.id ?? handle;
}

function credentialOptionLabel(option: RoutineCredentialOption): string {
  return option.kind
    ? `${option.displayName} (${option.kind})`
    : option.displayName;
}

function optionForMissingCredentialHandle(
  handle: string,
  options: RoutineCredentialOption[],
) {
  if (
    !handle ||
    options.some((option) => option.id === handle || option.slug === handle)
  ) {
    return null;
  }
  return <SelectItem value={handle}>{handle} (unavailable)</SelectItem>;
}

function optionForMissingHandle(
  binding: CredentialBindingValue,
  options: RoutineCredentialOption[],
) {
  if (
    !binding.credentialId ||
    options.some(
      (option) =>
        option.id === binding.credentialId ||
        option.slug === binding.credentialId,
    )
  ) {
    return null;
  }
  return (
    <SelectItem value={binding.credentialId}>
      {binding.credentialId} (unavailable)
    </SelectItem>
  );
}

function normalizeBinding(
  binding: CredentialBindingValue,
): CredentialBindingValue {
  const requiredFields = (binding.requiredFields ?? [])
    .map((field) => field.trim())
    .filter(Boolean);
  return {
    alias: binding.alias.trim(),
    credentialId: binding.credentialId.trim(),
    ...(requiredFields.length > 0 ? { requiredFields } : {}),
  };
}

function aliasFromCredentialName(name: string): string {
  const alias = name.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^(\d)/, "_$1");
  return alias.replace(/^_+$/, "") || "credential";
}

function uniqueCredentialAlias(
  baseAlias: string,
  bindings: readonly CredentialBindingValue[],
): string {
  const used = new Set(bindings.map((binding) => binding.alias));
  if (!used.has(baseAlias)) return baseAlias;
  let index = 2;
  let candidate = `${baseAlias}_${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${baseAlias}_${index}`;
  }
  return candidate;
}
