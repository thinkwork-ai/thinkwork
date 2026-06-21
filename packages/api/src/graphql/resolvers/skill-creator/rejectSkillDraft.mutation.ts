import type { GraphQLContext } from "../../context.js";
import { db, eq, skillDrafts } from "../../utils.js";
import {
  appendSkillDraftEvent,
  failedPrecondition,
  loadDraftEvents,
  loadDraftForTenant,
  requireNonEmptyText,
  requireOperator,
  resolveReadTenant,
  toDraftPayload,
  toGraphqlDraft,
} from "./shared.js";

export async function rejectSkillDraft(
  _parent: unknown,
  args: { input: { id: string; rationale: string } },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveReadTenant(ctx);
  const { userId } = await requireOperator(ctx, tenantId);
  const draft = await loadDraftForTenant(tenantId, args.input.id);
  if (draft.status === "rejected") {
    const events = await loadDraftEvents(tenantId, draft.id);
    return toGraphqlDraft(toDraftPayload(draft, null, events));
  }
  if (draft.status === "draft") {
    throw failedPrecondition(
      "Only submitted or failed drafts can be rejected.",
    );
  }
  const rationale = requireNonEmptyText(args.input.rationale, "Rationale");
  const now = new Date();
  const [row] = await db
    .update(skillDrafts)
    .set({
      status: "rejected",
      rejected_by_user_id: userId,
      rejected_at: now,
      failure_message: rationale,
      updated_at: now,
    })
    .where(eq(skillDrafts.id, draft.id))
    .returning();

  await appendSkillDraftEvent({
    tenantId,
    draftId: draft.id,
    actorUserId: userId,
    eventType: "rejected",
    message: rationale,
  });

  const events = await loadDraftEvents(tenantId, draft.id);
  return toGraphqlDraft(toDraftPayload(row ?? draft, null, events));
}
