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
    enabled?: boolean | null;
  };
};

export async function updateTenantModelCatalogEntry(
  _parent: unknown,
  args: UpdateTenantModelCatalogEntryArgs,
  ctx: GraphQLContext,
) {
  const { tenantId, modelId, displayName, enabled } = args.input;
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

  if (
    enabled === true &&
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
    enabled,
  });
  if (!updated) {
    throw new GraphQLError("Model has not been imported for this tenant.", {
      extensions: { code: "TENANT_MODEL_NOT_FOUND" },
    });
  }

  return updated;
}
