import type { GraphQLContext } from "../../context.js";
import { db, eq, skillDrafts } from "../../utils.js";
import {
  appendSkillDraftEvent,
  assertEditableDraft,
  loadDraftEvents,
  loadDraftForTenant,
  normalizeSlug,
  requireDraftAuthor,
  requireNonEmptyText,
  toDraftPayload,
  toGraphqlDraft,
  forbidden,
} from "./shared.js";

export async function updateSkillDraft(
  _parent: unknown,
  args: {
    input: {
      id: string;
      slug?: string | null;
      title?: string | null;
      displayName?: string | null;
      summary?: string | null;
      currentContentHash?: string | null;
    };
  },
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await requireDraftAuthor(ctx);
  const draft = await loadDraftForTenant(tenantId, args.input.id);
  if (draft.requested_by_user_id !== userId) {
    throw forbidden("Only the draft requester can edit this skill draft.");
  }
  assertEditableDraft(draft);

  const patch: Partial<typeof skillDrafts.$inferInsert> = {
    updated_at: new Date(),
  };
  if (args.input.slug !== undefined && args.input.slug !== null) {
    patch.slug = normalizeSlug(args.input.slug);
  }
  if (args.input.title !== undefined && args.input.title !== null) {
    patch.title = requireNonEmptyText(args.input.title, "Title");
  }
  if (args.input.displayName !== undefined) {
    patch.display_name = args.input.displayName?.trim() || null;
  }
  if (args.input.summary !== undefined) {
    patch.summary = args.input.summary?.trim() || null;
  }
  if (args.input.currentContentHash !== undefined) {
    patch.current_content_hash = args.input.currentContentHash?.trim() || null;
  }

  const [row] = await db
    .update(skillDrafts)
    .set(patch)
    .where(eq(skillDrafts.id, draft.id))
    .returning();

  await appendSkillDraftEvent({
    tenantId,
    draftId: draft.id,
    actorUserId: userId,
    eventType: "updated",
    message: "Skill draft metadata updated.",
    payload: {
      contentHashChanged:
        patch.current_content_hash !== undefined &&
        patch.current_content_hash !== draft.current_content_hash,
    },
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
