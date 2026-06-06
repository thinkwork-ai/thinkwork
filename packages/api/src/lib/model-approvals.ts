import { getDb, type Database } from "@thinkwork/database-pg";
import {
  agents,
  agentTemplates,
  modelCatalog,
  tenantSettings,
  userModelApprovals,
  users,
} from "@thinkwork/database-pg/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

type Db = Database;

const defaultDb = getDb();

export type ModelApprovalErrorCode =
  | "USER_NOT_FOUND"
  | "MODEL_NOT_AVAILABLE"
  | "MODEL_NOT_APPROVED";

export class ModelApprovalError extends Error {
  constructor(
    public readonly code: ModelApprovalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelApprovalError";
  }
}

export type ModelCatalogEntry = {
  id: string;
  modelId: string;
  provider: string;
  displayName: string;
  inputCostPerMillion: string | null;
  outputCostPerMillion: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean | null;
  supportsTools: boolean | null;
};

export type UserModelCatalogEntry = ModelCatalogEntry & {
  approved: boolean;
};

type ModelCatalogRow = typeof modelCatalog.$inferSelect;

function toModelCatalogEntry(row: ModelCatalogRow): ModelCatalogEntry {
  return {
    id: row.id,
    modelId: row.model_id,
    provider: row.provider,
    displayName: row.display_name,
    inputCostPerMillion: row.input_cost_per_million,
    outputCostPerMillion: row.output_cost_per_million,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    supportsVision: row.supports_vision,
    supportsTools: row.supports_tools,
  };
}

async function assertUserBelongsToTenant(
  db: Db,
  tenantId: string,
  userId: string,
) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant_id, tenantId)))
    .limit(1);

  if (!user) {
    throw new ModelApprovalError(
      "USER_NOT_FOUND",
      "User does not belong to this tenant.",
    );
  }
}

async function assertAvailableModel(db: Db, modelId: string) {
  const [model] = await db
    .select({ modelId: modelCatalog.model_id })
    .from(modelCatalog)
    .where(
      and(
        eq(modelCatalog.model_id, modelId),
        eq(modelCatalog.is_available, true),
      ),
    )
    .limit(1);

  if (!model) {
    throw new ModelApprovalError(
      "MODEL_NOT_AVAILABLE",
      "Model is not available in the catalog.",
    );
  }
}

export async function getTenantIdForUser(
  userId: string,
  options: { db?: Db } = {},
) {
  const db = options.db ?? defaultDb;
  const [user] = await db
    .select({ tenantId: users.tenant_id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.tenantId) {
    throw new ModelApprovalError("USER_NOT_FOUND", "User was not found.");
  }

  return user.tenantId;
}

export async function listUserModelCatalog(
  input: { tenantId: string; userId: string },
  options: { db?: Db } = {},
): Promise<UserModelCatalogEntry[]> {
  const db = options.db ?? defaultDb;
  await assertUserBelongsToTenant(db, input.tenantId, input.userId);

  const [catalogRows, approvalRows] = await Promise.all([
    db
      .select()
      .from(modelCatalog)
      .where(eq(modelCatalog.is_available, true))
      .orderBy(modelCatalog.display_name),
    db
      .select({ modelId: userModelApprovals.model_id })
      .from(userModelApprovals)
      .where(
        and(
          eq(userModelApprovals.tenant_id, input.tenantId),
          eq(userModelApprovals.user_id, input.userId),
        ),
      ),
  ]);

  const approved = new Set(approvalRows.map((row) => row.modelId));
  return catalogRows.map((row) => ({
    ...toModelCatalogEntry(row),
    approved: approved.has(row.model_id),
  }));
}

export async function listApprovedModelCatalog(
  input: { tenantId: string; userId: string },
  options: { db?: Db } = {},
): Promise<ModelCatalogEntry[]> {
  const db = options.db ?? defaultDb;
  await assertUserBelongsToTenant(db, input.tenantId, input.userId);

  const approvalRows = await db
    .select({ modelId: userModelApprovals.model_id })
    .from(userModelApprovals)
    .where(
      and(
        eq(userModelApprovals.tenant_id, input.tenantId),
        eq(userModelApprovals.user_id, input.userId),
      ),
    );

  const modelIds = approvalRows.map((row) => row.modelId);
  if (modelIds.length === 0) {
    return [];
  }

  const catalogRows = await db
    .select()
    .from(modelCatalog)
    .where(
      and(
        eq(modelCatalog.is_available, true),
        inArray(modelCatalog.model_id, modelIds),
      ),
    )
    .orderBy(modelCatalog.display_name);

  return catalogRows.map(toModelCatalogEntry);
}

export async function setUserModelApproval(
  input: {
    tenantId: string;
    userId: string;
    modelId: string;
    approved: boolean;
  },
  options: { db?: Db } = {},
) {
  const db = options.db ?? defaultDb;
  await assertUserBelongsToTenant(db, input.tenantId, input.userId);
  await assertAvailableModel(db, input.modelId);

  if (input.approved) {
    await db
      .insert(userModelApprovals)
      .values({
        tenant_id: input.tenantId,
        user_id: input.userId,
        model_id: input.modelId,
        updated_at: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [
          userModelApprovals.tenant_id,
          userModelApprovals.user_id,
          userModelApprovals.model_id,
        ],
        set: { updated_at: sql`now()` },
      });
  } else {
    await db
      .delete(userModelApprovals)
      .where(
        and(
          eq(userModelApprovals.tenant_id, input.tenantId),
          eq(userModelApprovals.user_id, input.userId),
          eq(userModelApprovals.model_id, input.modelId),
        ),
      );
  }
}

export async function assertUserModelApproved(
  input: { tenantId: string; userId: string; modelId: string },
  options: { db?: Db } = {},
) {
  const db = options.db ?? defaultDb;
  await assertAvailableModel(db, input.modelId);

  const [approval] = await db
    .select({ id: userModelApprovals.id })
    .from(userModelApprovals)
    .where(
      and(
        eq(userModelApprovals.tenant_id, input.tenantId),
        eq(userModelApprovals.user_id, input.userId),
        eq(userModelApprovals.model_id, input.modelId),
      ),
    )
    .limit(1);

  if (!approval) {
    throw new ModelApprovalError(
      "MODEL_NOT_APPROVED",
      "Model is not approved for this user.",
    );
  }
}

export async function ensureDefaultModelApprovalsForUser(
  input: { tenantId: string; userId: string },
  options: { db?: Db } = {},
) {
  const db = options.db ?? defaultDb;
  await assertUserBelongsToTenant(db, input.tenantId, input.userId);

  const defaultIds = new Set<string>();

  const [settings] = await db
    .select({ modelId: tenantSettings.default_model })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenant_id, input.tenantId))
    .limit(1);
  if (settings?.modelId) defaultIds.add(settings.modelId);

  const agentRows = await db
    .select({ modelId: agents.model })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, input.tenantId), ne(agents.status, "archived")),
    );
  for (const row of agentRows) {
    if (row.modelId) defaultIds.add(row.modelId);
  }

  const templateRows = await db
    .select({ modelId: agentTemplates.model })
    .from(agentTemplates)
    .where(eq(agentTemplates.tenant_id, input.tenantId));
  for (const row of templateRows) {
    if (row.modelId) defaultIds.add(row.modelId);
  }

  const candidateIds = [...defaultIds];
  if (candidateIds.length === 0) {
    return [];
  }

  const availableRows = await db
    .select({ modelId: modelCatalog.model_id })
    .from(modelCatalog)
    .where(
      and(
        eq(modelCatalog.is_available, true),
        inArray(modelCatalog.model_id, candidateIds),
      ),
    );

  const values = availableRows.map((row) => ({
    tenant_id: input.tenantId,
    user_id: input.userId,
    model_id: row.modelId,
    updated_at: sql`now()`,
  }));

  if (values.length > 0) {
    await db.insert(userModelApprovals).values(values).onConflictDoNothing();
  }

  return availableRows.map((row) => row.modelId);
}
