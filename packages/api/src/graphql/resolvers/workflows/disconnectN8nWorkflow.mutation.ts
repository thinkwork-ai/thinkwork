import { GraphQLError } from "graphql";
import {
  workflowEngineBindings,
  workflows,
} from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb, snakeToCamel } from "../../utils.js";
import { requirePluginTenantAdmin } from "../plugins/shared.js";
import { disconnectN8nWorkflow as disconnect } from "../../../lib/workflows/n8n-discovery.js";

export async function disconnectN8nWorkflow(
  _parent: unknown,
  args: {
    input: {
      workflowId?: string | null;
      bindingId?: string | null;
      idempotencyKey: string;
    };
  },
  ctx: GraphQLContext,
  deps: { db?: typeof defaultDb; disconnect?: typeof disconnect } = {},
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  if (!args.input.idempotencyKey.trim()) {
    throw new GraphQLError("idempotencyKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (!args.input.workflowId && !args.input.bindingId) {
    throw new GraphQLError("workflowId or bindingId is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const db = deps.db ?? defaultDb;
  const result = await (deps.disconnect ?? disconnect)(db, {
    tenantId,
    workflowId: args.input.workflowId,
    bindingId: args.input.bindingId,
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
    throw new GraphQLError("n8n workflow link could not be loaded", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  return {
    workflow: snakeToCamel(workflow),
    binding: snakeToCamel(binding),
  };
}
