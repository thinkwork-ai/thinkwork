import type { GraphQLContext } from "../../context.js";
import { db, eq, skillDrafts } from "../../utils.js";
import {
  appendSkillDraftEvent,
  assertEditableDraft,
  failedPrecondition,
  forbidden,
  loadDraftEvents,
  loadDraftForTenant,
  requireDraftAuthor,
  toDraftPayload,
  toGraphqlDraft,
} from "./shared.js";

export async function submitSkillDraft(
  _parent: unknown,
  args: { input: { id: string } },
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await requireDraftAuthor(ctx);
  const draft = await loadDraftForTenant(tenantId, args.input.id);
  if (draft.requested_by_user_id !== userId) {
    throw forbidden("Only the draft requester can submit this skill draft.");
  }
  assertEditableDraft(draft);
  if (!draft.current_content_hash) {
    throw failedPrecondition("Skill draft has no current content hash.");
  }

  const now = new Date();
  const [row] = await db
    .update(skillDrafts)
    .set({ status: "submitted", submitted_at: now, updated_at: now })
    .where(eq(skillDrafts.id, draft.id))
    .returning();

  await appendSkillDraftEvent({
    tenantId,
    draftId: draft.id,
    actorUserId: userId,
    eventType: "submitted",
    message: "Skill draft submitted for review.",
    payload: { currentContentHash: draft.current_content_hash },
  });

  const events = await loadDraftEvents(tenantId, draft.id);
  return toGraphqlDraft(
    toDraftPayload(
      row ?? draft,
      { id: userId, name: null, email: null },
      events,
    ),
  );
}
