import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import {
  type BedrockCatalogModel,
  listBedrockCatalogModels,
} from "../../../lib/model-catalog/aws-bedrock-catalog.js";
import {
  fetchBedrockPriceList,
  resolveBedrockPricingFromPriceList,
  type BedrockPricingResolution,
} from "../../../lib/model-catalog/aws-price-list.js";
import {
  listTenantModelCatalogByIds,
  upsertTenantModelCatalogEntry,
} from "../../../lib/model-catalog/tenant-catalog.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

type ImportTenantBedrockModelInput = {
  modelId: string;
  displayName?: string | null;
  enabled?: boolean | null;
};

type ImportTenantBedrockModelsArgs = {
  input: {
    tenantId: string;
    models: ImportTenantBedrockModelInput[];
  };
};

function pricingError(
  model: BedrockCatalogModel,
  error: unknown,
): BedrockPricingResolution {
  return {
    status: "error",
    inputCostPerMillion: null,
    outputCostPerMillion: null,
    pricingSource: "aws-price-list",
    diagnostics: {
      reason: "price_list_request_failed",
      modelId: model.modelId,
      error: error instanceof Error ? error.message : String(error),
    },
  };
}

function displayNameFor(
  model: BedrockCatalogModel,
  input: ImportTenantBedrockModelInput,
): string {
  const displayName = input.displayName?.trim();
  return displayName && displayName.length > 0 ? displayName : model.modelName;
}

function dedupeModels(
  models: readonly ImportTenantBedrockModelInput[],
): ImportTenantBedrockModelInput[] {
  const seen = new Set<string>();
  const deduped: ImportTenantBedrockModelInput[] = [];
  for (const model of models) {
    if (seen.has(model.modelId)) continue;
    seen.add(model.modelId);
    deduped.push(model);
  }
  return deduped;
}

export async function importTenantBedrockModels(
  _parent: unknown,
  args: ImportTenantBedrockModelsArgs,
  ctx: GraphQLContext,
) {
  const { tenantId } = args.input;
  await requireTenantAdmin(ctx, tenantId);

  const selectedModels = dedupeModels(args.input.models);
  if (selectedModels.length === 0) {
    throw new GraphQLError("Select at least one Bedrock model to import.", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  let catalogModels: BedrockCatalogModel[];
  try {
    catalogModels = await listBedrockCatalogModels();
  } catch (error) {
    throw new GraphQLError("Unable to load AWS Bedrock model catalog.", {
      extensions: {
        code: "AWS_BEDROCK_CATALOG_UNAVAILABLE",
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const modelById = new Map(
    catalogModels.map((model) => [model.modelId, model]),
  );

  let priceList: string[] | null = null;
  let pricingFailure: unknown = null;
  try {
    priceList = await fetchBedrockPriceList();
  } catch (error) {
    pricingFailure = error;
  }

  const caller = await resolveCaller(ctx);
  const importedModelIds: string[] = [];
  for (const input of selectedModels) {
    const model = modelById.get(input.modelId);
    if (!model) {
      throw new GraphQLError("Bedrock model is not available for import.", {
        extensions: {
          code: "BEDROCK_MODEL_NOT_FOUND",
          modelId: input.modelId,
        },
      });
    }

    const pricing =
      priceList === null
        ? pricingError(model, pricingFailure)
        : resolveBedrockPricingFromPriceList(priceList, {
            modelId: model.modelId,
            modelName: model.modelName,
            providerName: model.providerName,
          });

    await upsertTenantModelCatalogEntry({
      tenantId,
      modelId: model.modelId,
      provider: model.provider,
      canonicalDisplayName: model.modelName,
      displayName: displayNameFor(model, input),
      inputCostPerMillion: pricing.inputCostPerMillion,
      outputCostPerMillion: pricing.outputCostPerMillion,
      contextWindow: null,
      maxOutputTokens: null,
      supportsVision: model.supportsVision,
      supportsTools: model.supportsTools,
      enabled: Boolean(input.enabled) && pricing.status === "resolved",
      pricingStatus: pricing.status,
      pricingSource: pricing.pricingSource,
      pricingDiagnostics: pricing.diagnostics,
      importedByUserId: caller.userId ?? null,
      importSource: "aws-bedrock-catalog",
      importPayload: {
        providerName: model.providerName,
        modelName: model.modelName,
        inputModalities: model.inputModalities,
        outputModalities: model.outputModalities,
        supportsStreaming: model.supportsStreaming,
        customizationsSupported: model.customizationsSupported,
        inferenceTypesSupported: model.inferenceTypesSupported,
        lifecycleStatus: model.lifecycleStatus,
      },
    });
    importedModelIds.push(model.modelId);
  }

  return listTenantModelCatalogByIds({
    tenantId,
    modelIds: importedModelIds,
    includeDisabled: true,
  });
}
