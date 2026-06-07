import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Switch } from "@thinkwork/ui";
import type { UserModelCatalogEntry } from "@/gql/graphql";
import {
  SetUserModelApprovalMutation,
  UserModelCatalogQuery,
} from "@/lib/graphql-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

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
    <SettingsSection label="Models">
      {queryResult.error && rows.length === 0 ? (
        <SettingsRow
          label="Model catalog unavailable"
          description={queryResult.error.message}
        />
      ) : queryResult.fetching && rows.length === 0 ? (
        <SettingsRow label="Loading models..." />
      ) : rows.length === 0 ? (
        <SettingsRow label="No catalog models are available." />
      ) : (
        rows.map((model) => (
          <SettingsRow
            key={model.id}
            label={
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{model.displayName}</span>
                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                  {formatProviderName(model.provider)}
                </span>
              </span>
            }
            description={formatModelCostLine(model)}
          >
            <Switch
              aria-label={`Approve ${model.displayName}`}
              checked={model.approved}
              disabled={savingModelId === model.modelId}
              onCheckedChange={(checked) =>
                handleApprovalChange(model.modelId, checked)
              }
            />
          </SettingsRow>
        ))
      )}
    </SettingsSection>
  );
}
