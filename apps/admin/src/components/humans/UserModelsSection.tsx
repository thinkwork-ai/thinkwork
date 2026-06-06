import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import type { UserModelCatalogEntry } from "@/gql/graphql";
import {
  SetUserModelApprovalMutation,
  UserModelCatalogQuery,
} from "@/lib/graphql-queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

type ModelApprovalRow = Pick<
  UserModelCatalogEntry,
  | "approved"
  | "displayName"
  | "id"
  | "inputCostPerMillion"
  | "modelId"
  | "outputCostPerMillion"
  | "provider"
>;

type UserModelCatalogData = {
  userModelCatalog: ModelApprovalRow[];
};

type SetUserModelApprovalData = {
  setUserModelApproval: ModelApprovalRow[];
};

type SetUserModelApprovalVariables = {
  approved: boolean;
  modelId: string;
  userId: string;
};

export function formatProviderName(provider: string) {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatPerMillionCost(cost: number | null | undefined) {
  if (cost == null || !Number.isFinite(cost)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(cost);
}

export function formatModelCostLine(
  model: Pick<ModelApprovalRow, "inputCostPerMillion" | "outputCostPerMillion">,
) {
  return `${formatPerMillionCost(
    model.inputCostPerMillion,
  )} input / ${formatPerMillionCost(
    model.outputCostPerMillion,
  )} output per 1M tokens`;
}

export function applyModelApproval<
  T extends { approved: boolean; modelId: string },
>(models: T[], modelId: string, approved: boolean) {
  return models.map((model) =>
    model.modelId === modelId ? { ...model, approved } : model,
  );
}

export interface UserModelsSectionProps {
  userId: string;
}

export function UserModelsSection({ userId }: UserModelsSectionProps) {
  const [models, setModels] = useState<ModelApprovalRow[] | null>(null);
  const [savingModelId, setSavingModelId] = useState<string | null>(null);

  const [queryResult] = useQuery<UserModelCatalogData>({
    query: UserModelCatalogQuery,
    variables: { userId },
    requestPolicy: "cache-and-network",
  });
  const [, setUserModelApproval] = useMutation<
    SetUserModelApprovalData,
    SetUserModelApprovalVariables
  >(SetUserModelApprovalMutation);

  useEffect(() => {
    if (queryResult.data?.userModelCatalog) {
      setModels(queryResult.data.userModelCatalog);
    }
  }, [queryResult.data?.userModelCatalog]);

  const rows = useMemo(
    () => models ?? queryResult.data?.userModelCatalog ?? [],
    [models, queryResult.data?.userModelCatalog],
  );

  async function handleApprovalChange(modelId: string, approved: boolean) {
    const previousModels = rows;
    setSavingModelId(modelId);
    setModels(applyModelApproval(rows, modelId, approved));

    const result = await setUserModelApproval({
      approved,
      modelId,
      userId,
    });

    setSavingModelId(null);

    if (result.error) {
      setModels(previousModels);
      toast.error(
        result.error.graphQLErrors[0]?.message ??
          result.error.message ??
          "Could not update model approval.",
      );
      return;
    }

    setModels(result.data?.setUserModelApproval ?? previousModels);
    toast.success(approved ? "Model approved" : "Model removed");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Models</CardTitle>
        <CardDescription>
          Approved catalog models this person can select for agent turns.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {queryResult.error && rows.length === 0 ? (
          <p className="text-sm text-destructive">
            {queryResult.error.message}
          </p>
        ) : queryResult.fetching && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading models…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No catalog models are available.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {rows.map((model) => (
              <div
                key={model.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {model.displayName}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatProviderName(model.provider)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatModelCostLine(model)}
                  </p>
                </div>
                <Switch
                  aria-label={`Approve ${model.displayName}`}
                  checked={model.approved}
                  disabled={savingModelId === model.modelId}
                  onCheckedChange={(checked) =>
                    handleApprovalChange(model.modelId, checked)
                  }
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
