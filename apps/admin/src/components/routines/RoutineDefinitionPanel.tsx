import { useEffect, useMemo, useState } from "react";
import { Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RoutineDefinitionQuery,
  UpdateRoutineDefinitionMutation,
} from "@/lib/graphql-queries";
import {
  RoutineStepConfigEditor,
  argsFromStepFields,
  changedSteps,
  valuesFromSteps,
} from "./RoutineStepConfigEditor";

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
    setFieldValues(valuesFromSteps(definition.steps));
  }, [definition?.versionId]);

  const dirtySteps = useMemo(() => {
    if (!definition) return [];
    return changedSteps(definition.steps, fieldValues);
  }, [definition, fieldValues]);

  const dirty = dirtySteps.length > 0;

  const save = async () => {
    if (!definition || !dirty) return;
    const res = await executeUpdate({
      input: {
        routineId,
        steps: dirtySteps.map((step) => ({
          nodeId: step.nodeId,
          args: argsFromStepFields(step, fieldValues),
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

      <RoutineStepConfigEditor
        steps={definition.steps}
        fieldValues={fieldValues}
        onFieldChange={(key, value) =>
          setFieldValues((current) => ({ ...current, [key]: value }))
        }
      />
    </section>
  );
}
