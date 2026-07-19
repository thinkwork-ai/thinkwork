import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { createOntologyChangeSet } from "../../../lib/ontology/repository.js";
import { changeItemTypeFromGraphQL, jsonValueFromGraphQL } from "./coercion.js";

interface CreateOntologyChangeSetArgs {
  input: {
    tenantId: string;
    title?: string | null;
    summary?: string | null;
    items: Array<{
      itemType: string;
      action?: string | null;
      slug: string;
      title?: string | null;
      description?: string | null;
      proposedValue: unknown;
      confidence?: number | null;
      evidence?: Array<{
        sourceKind: string;
        sourceRef?: string | null;
        sourceLabel?: string | null;
        quote: string;
        metadata?: unknown;
        observedAt?: string | null;
      }> | null;
    }>;
  };
}

/**
 * Manual authoring entry point (THINK-320 U2, KTD-5): stages items into the
 * caller's open manual draft with the R14 slug-collision check server-side.
 */
export const createOntologyChangeSetMutation = async (
  _parent: unknown,
  args: CreateOntologyChangeSetArgs,
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(
    ctx,
    args.input.tenantId,
    "create_ontology_change_set",
  );
  const actorUserId = await resolveCallerUserId(ctx);
  const result = await createOntologyChangeSet({
    tenantId: args.input.tenantId,
    actorUserId,
    title: args.input.title,
    summary: args.input.summary,
    items: args.input.items.map((item) => ({
      itemType: changeItemTypeFromGraphQL(item.itemType),
      action: (item.action?.toLowerCase() ?? "create") as
        | "create"
        | "update"
        | "deprecate"
        | "reject",
      slug: item.slug,
      title: item.title,
      description: item.description,
      proposedValue: jsonValueFromGraphQL(item.proposedValue) as Record<
        string,
        unknown
      > | null,
      confidence: item.confidence,
      evidence: item.evidence?.map((entry) => ({
        ...entry,
        metadata: jsonValueFromGraphQL(entry.metadata) as Record<
          string,
          unknown
        > | null,
      })),
    })),
  });
  return {
    changeSet: result.changeSet,
    mergedItemIds: result.mergedItemIds,
    conflicts: result.conflicts.map((conflict) => ({
      slug: conflict.slug,
      itemType: conflict.itemType.toUpperCase(),
      reason: conflict.reason,
    })),
  };
};
