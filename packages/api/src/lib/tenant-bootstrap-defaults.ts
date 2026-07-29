import { and, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@thinkwork/database-pg";
import {
  agents,
  modelCatalog,
  tenantSettings,
} from "@thinkwork/database-pg/schema";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import { ensureDefaultModelApprovalsForUser } from "./model-approvals.js";

type Db = Database;

const defaultDb = getDb();

export const DEFAULT_BOOTSTRAP_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

const MODEL_CATALOG_SEEDS = [
  {
    model_id: DEFAULT_BOOTSTRAP_MODEL_ID,
    provider: "anthropic",
    display_name: "Claude Sonnet 4.6",
    input_cost_per_million: "3.0000",
    output_cost_per_million: "15.0000",
    context_window: 200000,
    max_output_tokens: 64000,
    supports_vision: true,
    supports_tools: true,
    is_available: true,
  },
  {
    model_id: "us.anthropic.claude-opus-4-6-v1",
    provider: "anthropic",
    display_name: "Claude Opus 4.6",
    input_cost_per_million: "15.0000",
    output_cost_per_million: "75.0000",
    context_window: 200000,
    max_output_tokens: 32000,
    supports_vision: true,
    supports_tools: true,
    is_available: true,
  },
  {
    model_id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    provider: "anthropic",
    display_name: "Claude Haiku 4.5",
    input_cost_per_million: "0.8000",
    output_cost_per_million: "4.0000",
    context_window: 200000,
    max_output_tokens: 64000,
    supports_vision: true,
    supports_tools: true,
    is_available: true,
  },
];

export async function ensureTenantBootstrapDefaults(
  input: { tenantId: string; userId?: string | null },
  options: { db?: Db } = {},
) {
  const db = options.db ?? defaultDb;
  await ensureBootstrapModelCatalog(db);
  await ensureTenantDefaultModel(db, input.tenantId);
  await ensureTenantPlatformAgent(db, input.tenantId);
  if (input.userId) {
    await ensureDefaultModelApprovalsForUser(
      { tenantId: input.tenantId, userId: input.userId },
      { db },
    );
  }
}

async function ensureBootstrapModelCatalog(db: Db) {
  await db
    .insert(modelCatalog)
    .values(MODEL_CATALOG_SEEDS)
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
        is_available: sql`excluded.is_available`,
        updated_at: sql`now()`,
      },
    });
}

async function ensureTenantDefaultModel(db: Db, tenantId: string) {
  await db
    .insert(tenantSettings)
    .values({
      tenant_id: tenantId,
      default_model: DEFAULT_BOOTSTRAP_MODEL_ID,
    })
    .onConflictDoUpdate({
      target: tenantSettings.tenant_id,
      set: {
        default_model: sql`COALESCE(${tenantSettings.default_model}, ${DEFAULT_BOOTSTRAP_MODEL_ID})`,
        updated_at: sql`now()`,
      },
    });
}

async function ensureTenantPlatformAgent(db: Db, tenantId: string) {
  const [existing] = await db
    .select({
      id: agents.id,
      model: agents.model,
    })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, tenantId), eq(agents.is_platform_default, true)),
    )
    .limit(1);

  if (existing) {
    if (!existing.model) {
      await db
        .update(agents)
        .set({
          model: DEFAULT_BOOTSTRAP_MODEL_ID,
          updated_at: sql`now()`,
        })
        .where(eq(agents.id, existing.id));
    }
    return;
  }

  const existingFolders = await db
    .select({
      slug: agents.slug,
      workspaceFolderName: agents.workspace_folder_name,
    })
    .from(agents)
    .where(eq(agents.tenant_id, tenantId));

  await db.insert(agents).values({
    tenant_id: tenantId,
    name: "ThinkWork Agent",
    slug: generateSlug(),
    workspace_folder_name: workspaceFolderName(
      "ThinkWork Agent",
      existingFolders.map((row) => row.workspaceFolderName ?? row.slug),
      "agent",
    ),
    source: "system",
    runtime: "pi",
    status: "idle",
    system_prompt:
      "You are ThinkWork Agent, the default assistant for this workspace.",
    model: DEFAULT_BOOTSTRAP_MODEL_ID,
    is_platform_default: true,
  });
}
