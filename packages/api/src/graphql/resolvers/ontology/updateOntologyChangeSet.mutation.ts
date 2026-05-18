import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { updateOntologyChangeSet } from "../../../lib/ontology/repository.js";
import {
  changeSetStatusFromGraphQL,
  itemStatusFromGraphQL,
} from "./coercion.js";

interface UpdateOntologyChangeSetArgs {
  input: {
    tenantId: string;
    changeSetId: string;
    title?: string | null;
    summary?: string | null;
    status?: string | null;
    items?: Array<{
      id: string;
      status?: string | null;
      editedValue?: unknown;
    }> | null;
  };
}

export const updateOntologyChangeSetMutation = async (
  _parent: unknown,
  args: UpdateOntologyChangeSetArgs,
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.input.tenantId, "update_ontology_change_set");
  const actorUserId = await resolveCallerUserId(ctx);
  return updateOntologyChangeSet({
    actorUserId,
    input: {
      ...args.input,
      status: changeSetStatusFromGraphQL(args.input.status),
      items: args.input.items?.map((item) => ({
        ...item,
        status: itemStatusFromGraphQL(item.status),
      })),
    },
  });
};
