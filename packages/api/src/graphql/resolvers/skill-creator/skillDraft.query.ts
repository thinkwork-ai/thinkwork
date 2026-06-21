import type { GraphQLContext } from "../../context.js";
import {
  assertCanReadDraft,
  isTenantOperator,
  loadDraftEvents,
  loadDraftForTenant,
  loadRequesters,
  resolveReadTenant,
  toDraftPayload,
  toGraphqlDraft,
} from "./shared.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

export async function skillDraft(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveReadTenant(ctx);
  const draft = await loadDraftForTenant(tenantId, args.id);
  const [callerUserId, operator] = await Promise.all([
    resolveCallerUserId(ctx),
    isTenantOperator(ctx, tenantId),
  ]);
  assertCanReadDraft({ draft, callerUserId, operator });

  const [requesters, events] = await Promise.all([
    loadRequesters([draft]),
    loadDraftEvents(tenantId, draft.id),
  ]);
  return toGraphqlDraft(
    toDraftPayload(draft, requesters.get(draft.requested_by_user_id), events),
  );
}
