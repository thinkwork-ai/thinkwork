import { getDb, type Database } from "@thinkwork/database-pg";
import {
  modelCatalog,
  tenantModelCatalog,
} from "@thinkwork/database-pg/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

type Db = Database;

const defaultDb = getDb();

export type TenantModelCatalogEntry = {
  id: string;
  tenantId: string;
  modelId: string;
  provider: string;
  displayName: string;
  canonicalDisplayName: string;
  inputCostPerMillion: string | null;
  outputCostPerMillion: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean | null;
  supportsTools: boolean | null;
  enabled: boolean;
  pricingStatus: string;
  pricingSource: string | null;
  pricingDiagnostics: Record<string, unknown>;
  lastPricedAt: Date | null;
  importSource: string;
  importPayload: Record<string, unknown>;
  importedByUserId: string | null;
  importedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type TenantModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  source: "tenant_model_catalog";
};

export type UpdateTenantModelCatalogEntryInput = {
  tenantId: string;
  modelId: string;
  displayName?: string | null;
  inputCostPerMillion?: number | null;
  outputCostPerMillion?: number | null;
  enabled?: boolean | null;
};

type TenantModelCatalogRow = {
  id: string;
  tenantId: string;
  modelId: string;
  provider: string;
  displayName: string;
  canonicalDisplayName: string;
  inputCostPerMillion: string | null;
  outputCostPerMillion: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean | null;
  supportsTools: boolean | null;
  enabled: boolean;
  pricingStatus: string;
  pricingSource: string | null;
  pricingDiagnostics: Record<string, unknown> | null;
  lastPricedAt: Date | null;
  importSource: string;
  importPayload: Record<string, unknown> | null;
  importedByUserId: string | null;
  importedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function tenantCatalogSelect() {
  return {
    tenantId: tenantModelCatalog.tenant_id,
    id: modelCatalog.id,
    modelId: tenantModelCatalog.model_id,
    provider: modelCatalog.provider,
    displayName: tenantModelCatalog.display_name,
    canonicalDisplayName: modelCatalog.display_name,
    inputCostPerMillion: modelCatalog.input_cost_per_million,
    outputCostPerMillion: modelCatalog.output_cost_per_million,
    contextWindow: modelCatalog.context_window,
    maxOutputTokens: modelCatalog.max_output_tokens,
    supportsVision: modelCatalog.supports_vision,
    supportsTools: modelCatalog.supports_tools,
    enabled: tenantModelCatalog.enabled,
    pricingStatus: tenantModelCatalog.pricing_status,
    pricingSource: tenantModelCatalog.pricing_source,
    pricingDiagnostics: tenantModelCatalog.pricing_diagnostics,
    lastPricedAt: tenantModelCatalog.last_priced_at,
    importSource: tenantModelCatalog.import_source,
    importPayload: tenantModelCatalog.import_payload,
    importedByUserId: tenantModelCatalog.imported_by_user_id,
    importedAt: tenantModelCatalog.imported_at,
    createdAt: tenantModelCatalog.created_at,
    updatedAt: tenantModelCatalog.updated_at,
  };
}

function toTenantModelCatalogEntry(
  row: TenantModelCatalogRow,
): TenantModelCatalogEntry {
  return {
    ...row,
    pricingDiagnostics: row.pricingDiagnostics ?? {},
    importPayload: row.importPayload ?? {},
  };
}

function tenantCatalogWhere(input: {
  tenantId: string;
  includeDisabled?: boolean;
  modelIds?: readonly string[];
}) {
  const predicates = [
    eq(tenantModelCatalog.tenant_id, input.tenantId),
    eq(modelCatalog.is_available, true),
  ];
  if (!input.includeDisabled) {
    predicates.push(eq(tenantModelCatalog.enabled, true));
  }
  if (input.modelIds && input.modelIds.length > 0) {
    predicates.push(inArray(tenantModelCatalog.model_id, [...input.modelIds]));
  }
  return and(...predicates);
}

export async function listTenantModelCatalog(
  input: { tenantId: string; includeDisabled?: boolean },
  options: { db?: Db } = {},
): Promise<TenantModelCatalogEntry[]> {
  const db = options.db ?? defaultDb;
  const rows = await db
    .select(tenantCatalogSelect())
    .from(tenantModelCatalog)
    .innerJoin(
      modelCatalog,
      eq(modelCatalog.model_id, tenantModelCatalog.model_id),
    )
    .where(tenantCatalogWhere(input))
    .orderBy(asc(tenantModelCatalog.display_name));

  return (rows as TenantModelCatalogRow[]).map(toTenantModelCatalogEntry);
}

export async function listTenantModelCatalogByIds(
  input: {
    tenantId: string;
    modelIds: readonly string[];
    includeDisabled?: boolean;
  },
  options: { db?: Db } = {},
): Promise<TenantModelCatalogEntry[]> {
  if (input.modelIds.length === 0) return [];

  const db = options.db ?? defaultDb;
  const rows = await db
    .select(tenantCatalogSelect())
    .from(tenantModelCatalog)
    .innerJoin(
      modelCatalog,
      eq(modelCatalog.model_id, tenantModelCatalog.model_id),
    )
    .where(tenantCatalogWhere(input))
    .orderBy(asc(tenantModelCatalog.display_name));

  return (rows as TenantModelCatalogRow[]).map(toTenantModelCatalogEntry);
}

export async function getTenantModelCatalogEntry(
  input: { tenantId: string; modelId: string; includeDisabled?: boolean },
  options: { db?: Db } = {},
): Promise<TenantModelCatalogEntry | null> {
  const db = options.db ?? defaultDb;
  const rows = await db
    .select(tenantCatalogSelect())
    .from(tenantModelCatalog)
    .innerJoin(
      modelCatalog,
      eq(modelCatalog.model_id, tenantModelCatalog.model_id),
    )
    .where(
      and(
        tenantCatalogWhere({
          tenantId: input.tenantId,
          includeDisabled: input.includeDisabled,
        }),
        eq(tenantModelCatalog.model_id, input.modelId),
      ),
    )
    .limit(1);

  const [row] = rows as TenantModelCatalogRow[];
  return row ? toTenantModelCatalogEntry(row) : null;
}

export async function assertTenantModelAvailable(
  input: { tenantId: string; modelId: string },
  options: { db?: Db } = {},
): Promise<TenantModelCatalogEntry> {
  const row = await getTenantModelCatalogEntry(input, options);
  if (!row) {
    throw new Error("Model is not enabled in the tenant model catalog.");
  }
  return row;
}

export async function getTenantModelPricing(
  input: { tenantId: string; modelId: string | null },
  options: { db?: Db } = {},
): Promise<TenantModelPricing | null> {
  if (!input.modelId) return null;

  const row = await getTenantModelCatalogEntry(
    { tenantId: input.tenantId, modelId: input.modelId },
    options,
  );
  if (
    !row ||
    row.pricingStatus !== "resolved" ||
    !row.inputCostPerMillion ||
    !row.outputCostPerMillion
  ) {
    return null;
  }

  return {
    inputPerMillion: Number(row.inputCostPerMillion),
    outputPerMillion: Number(row.outputCostPerMillion),
    source: "tenant_model_catalog",
  };
}

export async function upsertTenantModelCatalogEntry(
  input: {
    tenantId: string;
    modelId: string;
    provider: string;
    canonicalDisplayName: string;
    displayName: string;
    inputCostPerMillion: string | null;
    outputCostPerMillion: string | null;
    contextWindow?: number | null;
    maxOutputTokens?: number | null;
    supportsVision?: boolean | null;
    supportsTools?: boolean | null;
    enabled: boolean;
    pricingStatus: "resolved" | "missing" | "ambiguous" | "error";
    pricingSource?: string | null;
    pricingDiagnostics?: Record<string, unknown>;
    importedByUserId?: string | null;
    importSource: string;
    importPayload?: Record<string, unknown>;
  },
  options: { db?: Db } = {},
): Promise<void> {
  const db = options.db ?? defaultDb;
  const now = new Date();

  await db
    .insert(modelCatalog)
    .values({
      model_id: input.modelId,
      provider: input.provider,
      display_name: input.canonicalDisplayName,
      input_cost_per_million: input.inputCostPerMillion,
      output_cost_per_million: input.outputCostPerMillion,
      context_window: input.contextWindow ?? null,
      max_output_tokens: input.maxOutputTokens ?? null,
      supports_vision: input.supportsVision ?? false,
      supports_tools: input.supportsTools ?? true,
      is_available: true,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: modelCatalog.model_id,
      set: {
        provider: sql`excluded.provider`,
        display_name: sql`excluded.display_name`,
        input_cost_per_million: sql`excluded.input_cost_per_million`,
        output_cost_per_million: sql`excluded.output_cost_per_million`,
        context_window: sql`excluded.context_window`,
        max_output_tokens: sql`excluded.max_output_tokens`,
        supports_vision: sql`excluded.supports_vision`,
        supports_tools: sql`excluded.supports_tools`,
        is_available: true,
        updated_at: now,
      },
    });

  await db
    .insert(tenantModelCatalog)
    .values({
      tenant_id: input.tenantId,
      model_id: input.modelId,
      display_name: input.displayName,
      enabled: input.enabled && input.pricingStatus === "resolved",
      pricing_status: input.pricingStatus,
      pricing_source: input.pricingSource ?? null,
      pricing_diagnostics: input.pricingDiagnostics ?? {},
      last_priced_at: input.pricingStatus === "resolved" ? now : null,
      import_source: input.importSource,
      import_payload: input.importPayload ?? {},
      imported_by_user_id: input.importedByUserId ?? null,
      imported_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [tenantModelCatalog.tenant_id, tenantModelCatalog.model_id],
      set: {
        display_name: sql`excluded.display_name`,
        enabled: sql`excluded.enabled`,
        pricing_status: sql`excluded.pricing_status`,
        pricing_source: sql`excluded.pricing_source`,
        pricing_diagnostics: sql`excluded.pricing_diagnostics`,
        last_priced_at: sql`excluded.last_priced_at`,
        import_source: sql`excluded.import_source`,
        import_payload: sql`excluded.import_payload`,
        imported_by_user_id: sql`excluded.imported_by_user_id`,
        imported_at: sql`excluded.imported_at`,
        updated_at: now,
      },
    });
}

export async function updateTenantModelCatalogEntry(
  input: UpdateTenantModelCatalogEntryInput,
  options: { db?: Db } = {},
): Promise<TenantModelCatalogEntry | null> {
  const db = options.db ?? defaultDb;
  const now = new Date();
  const current = await getTenantModelCatalogEntry(
    {
      tenantId: input.tenantId,
      modelId: input.modelId,
      includeDisabled: true,
    },
    { db },
  );
  if (!current) return null;

  const displayName =
    input.displayName === undefined || input.displayName === null
      ? undefined
      : input.displayName.trim();
  if (displayName !== undefined && displayName.length === 0) {
    throw new Error("Display name cannot be blank.");
  }

  const hasManualPricing =
    input.inputCostPerMillion !== undefined ||
    input.outputCostPerMillion !== undefined;
  let manualInputCost: string | null = null;
  let manualOutputCost: string | null = null;

  if (hasManualPricing) {
    if (
      input.inputCostPerMillion == null ||
      input.outputCostPerMillion == null
    ) {
      throw new Error("Input and output token prices are required together.");
    }
    if (
      !Number.isFinite(input.inputCostPerMillion) ||
      !Number.isFinite(input.outputCostPerMillion) ||
      input.inputCostPerMillion < 0 ||
      input.outputCostPerMillion < 0
    ) {
      throw new Error("Token prices must be non-negative numbers.");
    }
    manualInputCost = input.inputCostPerMillion.toFixed(4);
    manualOutputCost = input.outputCostPerMillion.toFixed(4);
  }

  if (
    input.enabled === true &&
    !hasManualPricing &&
    (current.pricingStatus !== "resolved" ||
      !current.inputCostPerMillion ||
      !current.outputCostPerMillion)
  ) {
    throw new Error("Cannot enable a model without resolved token pricing.");
  }

  const patch: Partial<typeof tenantModelCatalog.$inferInsert> = {
    updated_at: now,
  };
  if (displayName !== undefined) {
    patch.display_name = displayName;
  }
  if (hasManualPricing) {
    await db
      .update(modelCatalog)
      .set({
        input_cost_per_million: manualInputCost,
        output_cost_per_million: manualOutputCost,
        updated_at: now,
      })
      .where(eq(modelCatalog.model_id, input.modelId));

    patch.pricing_status = "resolved";
    patch.pricing_source = "manual";
    patch.pricing_diagnostics = { source: "operator_manual" };
    patch.last_priced_at = now;
  }
  if (input.enabled !== undefined && input.enabled !== null) {
    patch.enabled = input.enabled;
  }

  await db
    .update(tenantModelCatalog)
    .set(patch)
    .where(
      and(
        eq(tenantModelCatalog.tenant_id, input.tenantId),
        eq(tenantModelCatalog.model_id, input.modelId),
      ),
    );

  return getTenantModelCatalogEntry(
    {
      tenantId: input.tenantId,
      modelId: input.modelId,
      includeDisabled: true,
    },
    { db },
  );
}
