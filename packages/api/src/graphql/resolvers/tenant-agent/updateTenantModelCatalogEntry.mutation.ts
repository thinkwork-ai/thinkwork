import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import {
  getTenantModelCatalogEntry,
  updateTenantModelCatalogEntry as updateTenantCatalogEntry,
} from "../../../lib/model-catalog/tenant-catalog.js";
import { requireTenantAdmin } from "../core/authz.js";

type UpdateTenantModelCatalogEntryArgs = {
  input: {
    tenantId: string;
    modelId: string;
    displayName?: string | null;
    inputCostPerMillion?: number | null;
    outputCostPerMillion?: number | null;
    enabled?: boolean | null;
  };
};

function hasValidManualPricing(
  inputCostPerMillion: number | null | undefined,
  outputCostPerMillion: number | null | undefined,
) {
  return (
    inputCostPerMillion != null &&
    outputCostPerMillion != null &&
    Number.isFinite(inputCostPerMillion) &&
    Number.isFinite(outputCostPerMillion) &&
    inputCostPerMillion >= 0 &&
    outputCostPerMillion >= 0
  );
}

export async function updateTenantModelCatalogEntry(
  _parent: unknown,
  args: UpdateTenantModelCatalogEntryArgs,
  ctx: GraphQLContext,
) {
  const {
    tenantId,
    modelId,
    displayName,
    enabled,
    inputCostPerMillion,
    outputCostPerMillion,
  } = args.input;
  await requireTenantAdmin(ctx, tenantId);

  const current = await getTenantModelCatalogEntry({
    tenantId,
    modelId,
    includeDisabled: true,
  });
  if (!current) {
    throw new GraphQLError("Model has not been imported for this tenant.", {
      extensions: { code: "TENANT_MODEL_NOT_FOUND" },
    });
  }

  const trimmedDisplayName = displayName?.trim();
  if (displayName !== undefined && trimmedDisplayName?.length === 0) {
    throw new GraphQLError("Display name cannot be blank.", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const updatingPricing =
    inputCostPerMillion !== undefined || outputCostPerMillion !== undefined;
  if (updatingPricing) {
    if (!hasValidManualPricing(inputCostPerMillion, outputCostPerMillion)) {
      throw new GraphQLError(
        "Input and output token prices must be non-negative numbers.",
        {
          extensions: { code: "BAD_USER_INPUT" },
        },
      );
    }
  }

  if (
    enabled === true &&
    !updatingPricing &&
    (current.pricingStatus !== "resolved" ||
      !current.inputCostPerMillion ||
      !current.outputCostPerMillion)
  ) {
    throw new GraphQLError(
      "Resolve token pricing before enabling this model.",
      {
        extensions: { code: "MODEL_PRICING_UNRESOLVED" },
      },
    );
  }

  const updated = await updateTenantCatalogEntry({
    tenantId,
    modelId,
    displayName: trimmedDisplayName,
    inputCostPerMillion,
    outputCostPerMillion,
    enabled,
  });
  if (!updated) {
    throw new GraphQLError("Model has not been imported for this tenant.", {
      extensions: { code: "TENANT_MODEL_NOT_FOUND" },
    });
  }

  return updated;
}
