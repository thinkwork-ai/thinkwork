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
import { listTenantModelCatalog } from "../../../lib/model-catalog/tenant-catalog.js";
import { requireTenantAdmin } from "../core/authz.js";

type CandidateRow = {
  provider: string;
  providerName: string;
  modelName: string;
  modelId: string;
  displayName: string;
  inputModalities: string[];
  outputModalities: string[];
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  customizationsSupported: string[];
  inferenceTypesSupported: string[];
  lifecycleStatus: string | null;
  inputCostPerMillion: string | null;
  outputCostPerMillion: string | null;
  pricingStatus: string;
  pricingSource: string | null;
  pricingDiagnostics: Record<string, unknown>;
  alreadyImported: boolean;
  enabled: boolean;
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

function toCandidate(
  model: BedrockCatalogModel,
  pricing: BedrockPricingResolution,
  current: { displayName: string; enabled: boolean } | undefined,
): CandidateRow {
  return {
    provider: model.provider,
    providerName: model.providerName,
    modelName: model.modelName,
    modelId: model.modelId,
    displayName: current?.displayName ?? model.modelName,
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    supportsStreaming: model.supportsStreaming,
    supportsVision: model.supportsVision,
    supportsTools: model.supportsTools,
    customizationsSupported: model.customizationsSupported,
    inferenceTypesSupported: model.inferenceTypesSupported,
    lifecycleStatus: model.lifecycleStatus,
    inputCostPerMillion: pricing.inputCostPerMillion,
    outputCostPerMillion: pricing.outputCostPerMillion,
    pricingStatus: pricing.status,
    pricingSource: pricing.pricingSource,
    pricingDiagnostics: pricing.diagnostics,
    alreadyImported: current !== undefined,
    enabled: current?.enabled ?? false,
  };
}

export async function bedrockModelImportCandidates(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) {
  await requireTenantAdmin(ctx, args.tenantId);

  let models: BedrockCatalogModel[];
  try {
    models = await listBedrockCatalogModels();
  } catch (error) {
    throw new GraphQLError("Unable to load AWS Bedrock model catalog.", {
      extensions: {
        code: "AWS_BEDROCK_CATALOG_UNAVAILABLE",
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const currentRows = await listTenantModelCatalog({
    tenantId: args.tenantId,
    includeDisabled: true,
  });
  const currentByModelId = new Map(
    currentRows.map((row) => [
      row.modelId,
      { displayName: row.displayName, enabled: row.enabled },
    ]),
  );

  let priceList: string[] | null = null;
  let pricingFailure: unknown = null;
  try {
    priceList = await fetchBedrockPriceList();
  } catch (error) {
    pricingFailure = error;
  }

  return models.map((model) => {
    const pricing =
      priceList === null
        ? pricingError(model, pricingFailure)
        : resolveBedrockPricingFromPriceList(priceList, {
            modelId: model.modelId,
            modelName: model.modelName,
            providerName: model.providerName,
          });
    return toCandidate(model, pricing, currentByModelId.get(model.modelId));
  });
}
