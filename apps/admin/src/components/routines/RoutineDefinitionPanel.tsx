import { useEffect, useMemo, useState } from "react";
import { Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RoutineDefinitionQuery,
  UpdateRoutineDefinitionMutation,
} from "@/lib/graphql-queries";
import { cn } from "@/lib/utils";

interface RoutineDefinitionPanelProps {
  routineId: string;
  onPublished?: () => void;
}

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
    setFieldValues(
      Object.fromEntries(
        definition.editableFields.map((field) => [
          field.key,
          field.value ?? "",
        ]),
      ),
    );
  }, [definition?.versionId]);

  const dirty = useMemo(() => {
    if (!definition) return false;
    return definition.editableFields.some(
      (field) => (field.value ?? "") !== (fieldValues[field.key] ?? ""),
    );
  }, [definition, fieldValues]);

  const save = async () => {
    if (!definition || !dirty) return;
    const res = await executeUpdate({
      input: {
        routineId,
        fields: definition.editableFields.map((field) => ({
          key: field.key,
          value: fieldValues[field.key] ?? "",
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
    if (message.includes('Cannot query field "routineDefinition"')) {
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

      <div className="grid gap-5 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="min-w-0">
          <div className="mb-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
            Steps
          </div>
          <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
            {definition.steps.map((step, index) => (
              <div
                key={step.nodeId}
                className="grid grid-cols-[2rem_minmax(0,1fr)_9rem] items-center gap-3 px-3 py-3 text-sm"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{step.label}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {step.nodeId}
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className={cn(
                    "justify-self-end font-mono",
                    step.recipeId === "email_send" &&
                      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {step.recipeId}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
            Editable Fields
          </div>
          <div className="space-y-3">
            {definition.editableFields.map((field) => (
              <label key={field.key} className="block min-w-0">
                <span className="mb-1 block text-sm font-medium">
                  {field.label}
                </span>
                <Input
                  type={field.inputType === "email" ? "email" : "text"}
                  value={fieldValues[field.key] ?? ""}
                  onChange={(event) =>
                    setFieldValues((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
