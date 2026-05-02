import { useEffect, useMemo, useState } from "react";
import { Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RoutineDefinitionQuery,
  UpdateRoutineDefinitionMutation,
} from "@/lib/graphql-queries";
import { cn } from "@/lib/utils";

interface RoutineDefinitionPanelProps {
  routineId: string;
  onPublished?: () => void;
}

type ConfigField = {
  key: string;
  label: string;
  value: unknown | null;
  inputType: string;
  required: boolean;
  editable: boolean;
  options?: string[] | null;
};

type DefinitionStep = {
  nodeId: string;
  recipeId: string;
  recipeName: string;
  label: string;
  configFields: ConfigField[];
};

export function RoutineDefinitionPanel({
  routineId,
  onPublished,
}: RoutineDefinitionPanelProps) {
  const [queryResult, refetch] = useQuery({
    query: RoutineDefinitionQuery,
    variables: { routineId },
    requestPolicy: "cache-and-network",
  });
  const [updateState, executeUpdate] = useMutation(
    UpdateRoutineDefinitionMutation,
  );
  const definition = queryResult.data?.routineDefinition;
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!definition) return;
    setFieldValues(valuesFromSteps(definition.steps));
  }, [definition?.versionId]);

  const dirtySteps = useMemo(() => {
    if (!definition) return [];
    return definition.steps.filter((step) =>
      step.configFields.some((field) =>
        fieldChanged(step.nodeId, field, fieldValues),
      ),
    );
  }, [definition, fieldValues]);

  const dirty = dirtySteps.length > 0;

  const save = async () => {
    if (!definition || !dirty) return;
    const res = await executeUpdate({
      input: {
        routineId,
        steps: dirtySteps.map((step) => ({
          nodeId: step.nodeId,
          args: Object.fromEntries(
            step.configFields.map((field) => [
              field.key,
              valueForMutation(
                field,
                fieldValues[fieldKey(step.nodeId, field.key)],
              ),
            ]),
          ),
        })),
      },
    });

    if (res.error) {
      toast.error(res.error.message.replace(/^\[GraphQL\]\s*/, ""));
      return;
    }

    const version = res.data?.updateRoutineDefinition.currentVersion;
    toast.success(version ? `Published version ${version}.` : "Published.");
    refetch({ requestPolicy: "network-only" });
    onPublished?.();
  };

  if (queryResult.fetching && !definition) {
    return (
      <section className="mb-5 rounded-lg border border-border/70 bg-card/40 p-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-20 animate-pulse rounded bg-muted/70" />
      </section>
    );
  }

  if (queryResult.error) {
    const message = queryResult.error.message.replace(/^\[GraphQL\]\s*/, "");
    if (
      message.includes('Cannot query field "routineDefinition"') ||
      message.includes('Cannot query field "configFields"') ||
      message.includes('Cannot query field "recipeName"')
    ) {
      return null;
    }
    return (
      <section className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {message}
      </section>
    );
  }

  if (!definition) return null;

  return (
    <section className="mb-5 rounded-lg border border-border/70 bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Definition</h2>
            {definition.currentVersion && (
              <Badge variant="outline">v{definition.currentVersion}</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {definition.description}
          </p>
        </div>
        <Button
          size="sm"
          onClick={save}
          disabled={!dirty || updateState.fetching}
        >
          <Save className="h-3.5 w-3.5" />
          {updateState.fetching ? "Saving..." : "Save"}
        </Button>
      </div>

      <div className="divide-y divide-border/70">
        {definition.steps.map((step, index) => (
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
                      setFieldValues((current) => ({
                        ...current,
                        [fieldKey(step.nodeId, field.key)]: value,
                      }))
                    }
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConfigFieldInput({
  step,
  field,
  value,
  onChange,
}: {
  step: DefinitionStep;
  field: ConfigField;
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

function valuesFromSteps(steps: DefinitionStep[]): Record<string, string> {
  return Object.fromEntries(
    steps.flatMap((step) =>
      step.configFields.map((field) => [
        fieldKey(step.nodeId, field.key),
        stringValue(field.value),
      ]),
    ),
  );
}

function fieldChanged(
  nodeId: string,
  field: ConfigField,
  values: Record<string, string>,
): boolean {
  const key = fieldKey(nodeId, field.key);
  const next = valueForMutation(field, values[key] ?? "");
  return JSON.stringify(next) !== JSON.stringify(field.value ?? null);
}

function valueForMutation(field: ConfigField, value: string): unknown {
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
