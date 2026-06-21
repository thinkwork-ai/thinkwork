import { GraphQLError } from "graphql";
import {
  workflowEngineBindings,
  workflows,
} from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb, snakeToCamel } from "../../utils.js";
import { requirePluginTenantAdmin } from "../plugins/shared.js";
import { connectN8nWorkflow as connect } from "../../../lib/workflows/n8n-discovery.js";

export async function connectN8nWorkflow(
  _parent: unknown,
  args: {
    input: {
      installId: string;
      externalWorkflowId: string;
      externalWorkflowName: string;
      active?: boolean | null;
      triggerTypes?: string[] | null;
      lastModifiedAt?: string | null;
      idempotencyKey: string;
    };
  },
  ctx: GraphQLContext,
  deps: { db?: typeof defaultDb; connect?: typeof connect } = {},
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  if (!args.input.idempotencyKey.trim()) {
    throw new GraphQLError("idempotencyKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const db = deps.db ?? defaultDb;
  const result = await (deps.connect ?? connect)(db, {
    tenantId,
    installId: args.input.installId,
    externalWorkflowId: args.input.externalWorkflowId,
    externalWorkflowName: args.input.externalWorkflowName,
    active: args.input.active,
    triggerTypes: args.input.triggerTypes,
    lastModifiedAt: args.input.lastModifiedAt,
  });
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, result.workflowId))
    .limit(1);
  const [binding] = await db
    .select()
    .from(workflowEngineBindings)
    .where(eq(workflowEngineBindings.id, result.bindingId))
    .limit(1);
  if (!workflow || !binding) {
    throw new GraphQLError("n8n workflow connection could not be loaded", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  return {
    workflow: snakeToCamel(workflow),
    binding: snakeToCamel(binding),
    created: result.created,
  };
}
